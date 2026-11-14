// Loads data/companies.json into the `companies` table (service-role client; scripts only).
// Usage: npx tsx scripts/seed-companies.ts [--deactivate-missing]
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { CompanyRow } from '../lib/types';

const CompanySeedSchema = z.object({
  name: z.string().min(1),
  source: z.enum(['greenhouse', 'lever']),
  slug: z.string().min(1),
});
type CompanySeed = Pick<CompanyRow, 'name' | 'source' | 'slug'>;

const MISSING = 'companies table not found: wait for B-1 (Miranda) to merge the migration';

function isMissingTable(e: { code?: string; message?: string } | null): boolean {
  if (!e) return false;
  return (
    e.code === 'PGRST205' ||
    e.code === '42P01' ||
    /schema cache|does not exist|relation/i.test(e.message ?? '')
  );
}

async function main() {
  process.loadEnvFile('.env.local');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
  }

  const companies: CompanySeed[] = z
    .array(CompanySeedSchema)
    .min(1)
    .parse(JSON.parse(readFileSync('data/companies.json', 'utf8')));
  const keys = companies.map((c) => `${c.source}:${c.slug}`);
  if (new Set(keys).size !== keys.length) {
    console.error('Duplicate (source, slug) in data/companies.json');
    process.exit(1);
  }

  const db = createClient(url, key, { auth: { persistSession: false } });
  let inserted = 0, updated = 0, deactivated = 0;

  function fail(e: { code?: string; message?: string }): never {
    console.error(isMissingTable(e) ? MISSING : `Supabase error: ${e.message}`);
    process.exit(1);
  }

  for (const c of companies) {
    const { data, error } = await db
      .from('companies')
      .select('id')
      .eq('source', c.source)
      .eq('slug', c.slug);
    if (error) fail(error);
    if (data.length > 0) {
      const { error: uErr } = await db
        .from('companies')
        .update({ name: c.name, active: true })
        .eq('source', c.source)
        .eq('slug', c.slug);
      if (uErr) fail(uErr);
      updated++;
    } else {
      const { error: iErr } = await db
        .from('companies')
        .insert({ name: c.name, source: c.source, slug: c.slug, active: true });
      if (iErr) fail(iErr);
      inserted++;
    }
  }

  if (process.argv.includes('--deactivate-missing')) {
    const { data, error } = await db.from('companies').select('id, source, slug, active');
    if (error) fail(error);
    const keep = new Set(keys);
    const stale = data.filter((r) => r.active && !keep.has(`${r.source}:${r.slug}`));
    for (const r of stale) {
      const { error: dErr } = await db.from('companies').update({ active: false }).eq('id', r.id);
      if (dErr) fail(dErr);
      deactivated++;
    }
  }

  console.log(`inserted: ${inserted}, updated: ${updated}, deactivated: ${deactivated}`);
}

main();
