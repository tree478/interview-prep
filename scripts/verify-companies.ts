// Verifies each company's public job board returns postings. No DB.
// Usage: npx tsx scripts/verify-companies.ts [path/to/companies.json]
import { readFileSync } from 'node:fs';

import type { CompanyRow } from '../lib/types';

type CompanySeed = Pick<CompanyRow, 'name' | 'source' | 'slug'>;

const EARLY = /\b(intern|internship|co-?op|new grad|graduate|entry[- ]level|university|early career|junior)\b/i;
const file = process.argv[2] ?? 'data/companies.json';
const companies: CompanySeed[] = JSON.parse(readFileSync(file, 'utf8'));

async function check(c: CompanySeed) {
  const url =
    c.source === 'greenhouse'
      ? `https://boards-api.greenhouse.io/v1/boards/${c.slug}/jobs`
      : `https://api.lever.co/v0/postings/${c.slug}?mode=json`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { status: String(res.status), total: 0, early: 0, result: 'ERROR' };
    const body: unknown = await res.json();
    const titles: string[] =
      c.source === 'greenhouse'
        ? ((body as { jobs?: { title: string }[] }).jobs ?? []).map((j) => j.title)
        : Array.isArray(body)
          ? (body as { text: string }[]).map((j) => j.text)
          : [];
    if (c.source === 'lever' && !Array.isArray(body)) return { status: String(res.status), total: 0, early: 0, result: 'ERROR' };
    const early = titles.filter((t) => EARLY.test(t)).length;
    return { status: String(res.status), total: titles.length, early, result: titles.length ? 'OK' : 'EMPTY' };
  } catch {
    return { status: 'ERR', total: 0, early: 0, result: 'ERROR' };
  }
}

async function main() {
  let total = 0, early = 0, ok = 0, bad = 0;
  console.log('name'.padEnd(18), 'source'.padEnd(11), 'slug'.padEnd(20), 'http'.padEnd(5), 'total'.padStart(6), 'early'.padStart(6), 'result');
  for (const c of companies) {
    const r = await check(c);
    console.log(c.name.padEnd(18), c.source.padEnd(11), c.slug.padEnd(20), r.status.padEnd(5), String(r.total).padStart(6), String(r.early).padStart(6), r.result);
    total += r.total; early += r.early;
    if (r.result === 'OK') ok++; else bad++;
    await new Promise((s) => setTimeout(s, 300));
  }
  console.log(`\ncompanies: ${companies.length}  OK: ${ok}  EMPTY/ERROR: ${bad}  postings: ${total}  early-career: ${early}`);
  if (bad > 0) process.exit(1);
}
main();
