// Manual check: Grok company selection + role filter against the real DB. Writes nothing.
// Usage: npx tsx scripts/try-grok.ts   (uses XAI_API_KEY if set, else prints fallbacks)
import { createClient } from '@supabase/supabase-js';
import { filterRoles } from '../lib/ingest/filterRoles';
import { selectCompanies } from '../lib/ingest/selectCompanies';

async function main() {
  process.loadEnvFile('.env.local');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  const sel = await selectCompanies(db);
  console.log(`\nSelected ${sel.selected.length} companies:`);
  for (const s of sel.selected) console.log(`  ${s.company} | ${s.reason} | fallback=${s.fallback}`);
  console.log('Errors:', sel.errors.length ? sel.errors : 'none');

  const { data, error } = await db.from('jobs').select('title, location').limit(30);
  if (error) {
    console.error('jobs query failed:', error.message);
    process.exit(1);
  }
  const jobs = data ?? [];
  const r = await filterRoles(jobs);
  const counts: Record<string, number> = {};
  for (const t of r.roleTypes) counts[t] = (counts[t] ?? 0) + 1;
  console.log(`\nRole labels for ${jobs.length} jobs:`, counts, `usedFallback=${r.usedFallback}`);
  jobs.slice(0, 10).forEach((j, i) => console.log(`  ${r.roleTypes[i]} | ${j.title}`));
  console.log('Errors:', r.errors.length ? r.errors : 'none');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
