// Extracts pending/failed jobs with extractPosting (MATCH-1a) until none are left, --max extractions
// are reached, or --target jobs are 'done'. Prints a summary incl. the top dropped_skills.
// Uses the service-role key and GEMINI_API_KEY from .env.local; neither is ever printed.
// Usage: npx tsx scripts/backfill-extraction.ts [--target N] [--max N]
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { extractor, extractPending } from '../lib/ingest/extract';

const LOOP_LIMIT = 20;
const BATCH_SIZE = 5;
const PAUSE_MS = 2_000;
const BACKOFF_MS = [30_000, 60_000];
const MAX_BACKOFFS = 5;
const TOP_SKILLS = 25;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function intArg(name: string): number | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const n = Number(process.argv[i + 1]);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`${name} needs a positive integer`);
    process.exit(1);
  }
  return n;
}

/** Error text for printing: strip the Gemini key and any key=... query values. */
function safe(text: string): string {
  let out = text.replace(/([?&]key=)[^&\s"']+/gi, '$1[redacted]');
  const k = process.env.GEMINI_API_KEY?.trim();
  if (k) out = out.split(k).join('[redacted]');
  return out;
}

async function count(db: SupabaseClient, status: 'done' | 'pending' | 'failed'): Promise<number> {
  const { count: n, error } = await db
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('extraction_status', status);
  if (error) throw new Error(`count ${status}: ${error.message}`);
  return n ?? 0;
}

async function main() {
  const target = intArg('--target');
  const max = intArg('--max');

  process.loadEnvFile('.env.local');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
  }
  const missing = ['GEMINI_API_KEY', 'GEMINI_MODEL'].filter((n) => !process.env[n]?.trim());
  if (missing.length) {
    console.error(`Missing ${missing.join(' and ')} in .env.local`);
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  const t0 = Date.now();
  const errors: string[] = [];
  let processed = 0;
  let backoffs = 0;
  let stop = 'no pending or retryable jobs left';

  for (let loop = 1; ; loop++) {
    if (target !== undefined && (await count(db, 'done')) >= target) {
      stop = `target of ${target} done reached`;
      break;
    }
    if (max !== undefined && processed >= max) {
      stop = `--max ${max} extractions reached`;
      break;
    }
    const limit = max === undefined ? LOOP_LIMIT : Math.min(LOOP_LIMIT, max - processed);
    const res = await extractPending(db, null, { extractor, limit, batchSize: BATCH_SIZE });
    processed += res.extracted + res.failed;
    errors.push(...res.errors.map(safe));

    const [done, pending, failed] = await Promise.all([count(db, 'done'), count(db, 'pending'), count(db, 'failed')]);
    const elapsed = Math.round((Date.now() - t0) / 1000);
    console.log(
      `loop ${loop}: +${res.extracted} done, +${res.failed} failed${res.rateLimited ? ', RATE LIMITED' : ''} | ` +
        `total done ${done}, pending ${pending}, failed ${failed} | ${elapsed}s`,
    );

    if (res.rateLimited) {
      backoffs++;
      if (backoffs >= MAX_BACKOFFS) {
        stop = `gave up after ${MAX_BACKOFFS} rate-limit back-offs in a row`;
        break;
      }
      const wait = BACKOFF_MS[Math.min(backoffs - 1, BACKOFF_MS.length - 1)];
      console.log(`  rate limited, backing off ${wait / 1000}s (${backoffs}/${MAX_BACKOFFS})`);
      await sleep(wait);
      continue;
    }
    backoffs = 0;
    if (res.extracted + res.failed === 0) {
      if (res.errors.length) stop = `stopped, extraction reported: ${safe(res.errors[0])}`;
      break;
    }
    await sleep(PAUSE_MS);
  }

  // ---- summary ----
  console.log(`\n=== Summary (${stop}; ${Math.round((Date.now() - t0) / 1000)}s, ${processed} extractions this run) ===`);

  const rows: { id: string; company: string; role_type: string | null; dropped_skills: string[] }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('jobs')
      .select('id, company, role_type, dropped_skills')
      .eq('extraction_status', 'done')
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`read done jobs: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const failedCount = await count(db, 'failed');
  const pendingCount = await count(db, 'pending');

  const companies = new Set(rows.map((r) => r.company));
  console.log(`done: ${rows.length}`);
  console.log(`companies with >=1 done job: ${companies.size}`);
  console.log(`pending: ${pendingCount}`);
  console.log(`failed: ${failedCount}`);
  if (errors.length) {
    console.log(`first ${Math.min(5, errors.length)} error messages this run:`);
    for (const e of errors.slice(0, 5)) console.log(`  - ${e.slice(0, 300)}`);
  }

  const roleCounts = new Map<string, number>();
  for (const r of rows) roleCounts.set(r.role_type ?? 'null', (roleCounts.get(r.role_type ?? 'null') ?? 0) + 1);
  console.log(`role_type counts: ${[...roleCounts].map(([k, v]) => `${k}=${v}`).join(', ') || '(none)'}`);

  const skillCounts = new Map<string, number>();
  for (const r of rows) for (const s of r.dropped_skills ?? []) skillCounts.set(s, (skillCounts.get(s) ?? 0) + 1);
  const top = [...skillCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP_SKILLS);
  console.log(`\ntop ${TOP_SKILLS} dropped_skills (of ${skillCounts.size} distinct):`);
  for (const [s, n] of top) console.log(`  ${String(n).padStart(4)}  ${s}`);

  // one done job to check by eye: prefer a Stripe/Palantir internship
  const pick = await db
    .from('jobs')
    .select('title, company, location, extracted_json, dropped_skills')
    .eq('extraction_status', 'done')
    .or('company.ilike.%stripe%,company.ilike.%palantir%')
    .ilike('title', '%intern%')
    .limit(1);
  const sample =
    pick.data?.[0] ??
    (await db.from('jobs').select('title, company, location, extracted_json, dropped_skills').eq('extraction_status', 'done').limit(1)).data?.[0];
  if (sample) {
    console.log(`\nsample: ${sample.company} | ${sample.title} | ${sample.location ?? '-'}`);
    console.log(JSON.stringify(sample.extracted_json, null, 2));
    console.log(`dropped_skills: ${JSON.stringify(sample.dropped_skills)}`);
  }
}

main().catch((e) => {
  console.error(safe(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
