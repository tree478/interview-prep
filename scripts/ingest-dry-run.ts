// Fetches Greenhouse/Lever postings for every active company, keeps early-career titles, and
// de-dupes against the jobs table and the batch. DRY RUN by default; --write inserts new rows.
// Usage: npx tsx scripts/ingest-dry-run.ts [--write] [--company <slug>]
import { createClient } from '@supabase/supabase-js';
import { dedupe, loadExistingKeys } from '../lib/ingest/dedupe';
import { fetchGreenhouse } from '../lib/ingest/greenhouse';
import { isEarlyCareer } from '../lib/ingest/keywordFilter';
import { fetchLever } from '../lib/ingest/lever';
import type { CompanyRef, RawPosting, Source } from '../lib/ingest/types';

const DELAY_MS = 300;
const CHUNK = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row {
  company: string;
  source: Source;
  fetched: number;
  earlyCareer: number;
  new: number;
  duplicate: number;
  error: string;
}

async function main() {
  const write = process.argv.includes('--write');
  const ci = process.argv.indexOf('--company');
  const onlySlug = ci >= 0 ? process.argv[ci + 1] : undefined;
  if (ci >= 0 && !onlySlug) {
    console.error('--company needs a slug');
    process.exit(1);
  }

  process.loadEnvFile('.env.local');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  let q = db.from('companies').select('id, name, source, slug').eq('active', true).order('name');
  if (onlySlug) q = q.eq('slug', onlySlug);
  const { data: companies, error: cErr } = await q;
  if (cErr) {
    console.error(`Could not read companies: ${cErr.message}`);
    process.exit(1);
  }
  if (!companies || companies.length === 0) {
    console.error(onlySlug ? `No active company with slug "${onlySlug}"` : 'No active companies');
    process.exit(1);
  }

  const existing = await loadExistingKeys(db);
  console.log(`${companies.length} companies, ${existing.ids.size} jobs already in the DB\n`);

  const rows: Row[] = [];
  const toInsert: RawPosting[] = [];

  for (let i = 0; i < companies.length; i++) {
    const c = companies[i] as CompanyRef;
    const row: Row = { company: c.name, source: c.source, fetched: 0, earlyCareer: 0, new: 0, duplicate: 0, error: '' };
    try {
      const postings = c.source === 'greenhouse' ? await fetchGreenhouse(c) : await fetchLever(c);
      row.fetched = postings.length;
      const early = postings.filter((p) => isEarlyCareer(p.title));
      row.earlyCareer = early.length;
      const { fresh, duplicates } = dedupe(early, existing);
      row.new = fresh.length;
      row.duplicate = duplicates;
      toInsert.push(...fresh);
    } catch (e) {
      row.error = e instanceof Error ? e.message : String(e);
      console.error(`ERROR ${c.name}: ${row.error}`);
    }
    rows.push(row);
    if (i < companies.length - 1) await sleep(DELAY_MS);
  }

  console.log();
  console.table(
    rows.map((r) => ({
      company: r.company,
      source: r.source,
      fetched: r.fetched,
      'early-career': r.earlyCareer,
      new: r.new,
      duplicate: r.duplicate,
      error: r.error.slice(0, 60),
    })),
  );
  const sum = (f: (r: Row) => number) => rows.reduce((n, r) => n + f(r), 0);
  console.log(
    `Totals: fetched ${sum((r) => r.fetched)}, early-career ${sum((r) => r.earlyCareer)}, ` +
      `new ${sum((r) => r.new)}, duplicate ${sum((r) => r.duplicate)}, errors ${rows.filter((r) => r.error).length}`,
  );

  if (!write) {
    console.log('\ndry run, nothing written');
    return;
  }

  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK).map((p) => ({
      source: p.source,
      external_id: p.external_id,
      company: p.company,
      title: p.title,
      location: p.location,
      url: p.url,
      description: p.description,
      posted_at: p.posted_at,
      extraction_status: 'pending',
    }));
    const { error } = await db.from('jobs').insert(chunk);
    if (error) {
      console.error(`Insert failed at rows ${i}-${i + chunk.length}: ${error.message} (inserted so far: ${inserted})`);
      process.exit(1);
    }
    inserted += chunk.length;
  }
  console.log(`\ninserted ${inserted} jobs (extraction_status 'pending')`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
