// Runs the CICS course sync (GAP-2a..2c) with no time limit and logs it as a bot_runs row
// (kind 'courses', trigger 'manual') so it shows in the activity panel.
// Uses the service-role key and GEMINI_API_KEY from .env.local; neither is ever printed.
// Usage: npx tsx scripts/sync-courses.ts
import { createAdminClient } from '../lib/ingest/admin';
import { syncCourses } from '../lib/ingest/courses/sync';

const SAMPLES = 5;

async function main() {
  process.loadEnvFile('.env.local');
  const missing = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'GEMINI_API_KEY',
    'GEMINI_MODEL',
  ].filter((n) => !process.env[n]?.trim());
  if (missing.length) {
    console.error(`Missing ${missing.join(', ')} in .env.local`);
    process.exit(1);
  }

  const db = createAdminClient();
  const ins = await db
    .from('bot_runs')
    .insert({ kind: 'courses', trigger: 'manual', status: 'running', companies_selected: [], errors: [] })
    .select('id')
    .single();
  if (ins.error) {
    console.error(`Could not create the bot_runs row: ${ins.error.message}`);
    process.exit(1);
  }
  const runId = ins.data.id as string;

  const started = Date.now();
  const result = await syncCourses(db, runId, {}); // no deadline
  console.log(`run ${runId}: ${result.ok ? 'done' : 'failed'} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log('stats:', result.stats);
  console.log(`gemini calls: ${result.geminiCalls}${result.usedSeed ? ' (loaded the seed file)' : ''}`);
  if (result.errors.length) {
    console.log(`errors (${result.errors.length}):`);
    for (const e of result.errors) console.log(`  - ${e}`);
  }

  const rows = await db
    .from('umass_resources')
    .select('name,skills,meta,active')
    .eq('type', 'course')
    .order('name');
  if (rows.error) {
    console.error(`Could not read umass_resources: ${rows.error.message}`);
    process.exit(1);
  }
  const code = (r: { meta: unknown }) => String((r.meta as { code?: string } | null)?.code ?? '?');
  const active = (rows.data ?? []).filter((r) => r.active);
  console.log(`course rows: ${rows.data?.length ?? 0} (${active.length} active)`);

  const none = active.filter((r) => !(r.skills as string[]).length);
  console.log(`courses with 0 skills (${none.length}):`);
  for (const r of none) console.log(`  ${code(r)}: ${r.name}`);

  console.log('sample rows:');
  for (const r of active.slice(0, SAMPLES)) {
    console.log(`  ${code(r)} | ${r.name} | ${(r.skills as string[]).join(', ')}`);
  }

  if (!result.ok) process.exit(1);
}

main().catch((e) => {
  console.error('sync-courses failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
