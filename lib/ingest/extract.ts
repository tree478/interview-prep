// SERVER-ONLY. Extraction adapter for MATCH-1a: fills extracted_json for pending jobs.
import type { SupabaseClient } from '@supabase/supabase-js';
import { extractPosting } from '../ai/extractPosting';
import type { RoleType } from '../types';

export type Extractor = (job: {
  title: string;
  company: string;
  location: string | null;
  description: string;
}) => Promise<{ extracted: unknown; dropped: string[]; roleType?: RoleType }>;

// Adapter around Miranda's extractPosting (B-3). It already zod-validates and retries once;
// errors throw. Only the validated extraction is ever saved.
export const extractor: Extractor | null = async (job) => {
  const { extraction, dropped } = await extractPosting(job);
  return { extracted: extraction, dropped, roleType: extraction.roleType };
};

export const SKIP_MESSAGE = 'Extraction skipped: no extractor configured';
const MAX_ATTEMPTS = 2;

interface JobRow {
  id: string;
  title: string;
  company: string;
  location: string | null;
  description: string | null;
}

/** One batch can take ~25 s (extractPosting timeout), so stop starting batches this long before the deadline. */
export const BATCH_HEADROOM_MS = 15_000;

/** True for HTTP 429 / RESOURCE_EXHAUSTED / quota / rate-limit style errors (also looks at `cause`). */
export function isRateLimitError(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e != null && depth < 3; depth++) {
    if (typeof e === 'object') {
      const { status, code } = e as { status?: unknown; code?: unknown };
      if (status === 429 || code === 429) return true;
    }
    const text = e instanceof Error ? e.message : String(e);
    if (/\b429\b|RESOURCE_EXHAUSTED|quota|\brate\b/i.test(text)) return true;
    e = e instanceof Error ? e.cause : undefined;
  }
  return false;
}

export interface ExtractPendingResult {
  extracted: number;
  failed: number;
  errors: string[];
  /** A job hit a rate limit: it was left as it was (no attempt counted) and no more batches were started. */
  rateLimited: boolean;
}

export async function extractPending(
  db: SupabaseClient,
  /** Not used by extraction (ingested_by_run_id is never touched); null for scripts. */
  runId: string | null,
  opts: {
    extractor: Extractor | null;
    limit?: number;
    batchSize?: number;
    /** epoch ms; no batch starts within BATCH_HEADROOM_MS of this */
    deadline?: number;
  },
): Promise<ExtractPendingResult> {
  void runId;
  if (!opts.extractor) return { extracted: 0, failed: 0, errors: [SKIP_MESSAGE], rateLimited: false };
  const run = opts.extractor;
  const limit = opts.limit ?? 40;
  const batchSize = opts.batchSize ?? 5;
  const cols = 'id, title, company, location, description, extraction_attempts';
  const errors: string[] = [];

  // retries first (failed, fewer than 2 attempts), then pending oldest first
  const retry = await db
    .from('jobs')
    .select(cols)
    .eq('extraction_status', 'failed')
    .lt('extraction_attempts', MAX_ATTEMPTS)
    .order('id', { ascending: true })
    .limit(limit);
  if (retry.error) {
    return { extracted: 0, failed: 0, errors: [`extract: ${retry.error.message}`], rateLimited: false };
  }
  let jobs = (retry.data ?? []) as (JobRow & { extraction_attempts: number })[];
  if (jobs.length < limit) {
    const pending = await db
      .from('jobs')
      .select(cols)
      .eq('extraction_status', 'pending')
      .order('posted_at', { ascending: true, nullsFirst: true })
      .limit(limit - jobs.length);
    if (pending.error) errors.push(`extract: ${pending.error.message}`);
    jobs = jobs.concat((pending.data ?? []) as (JobRow & { extraction_attempts: number })[]);
  }

  let extracted = 0;
  let failed = 0;
  let rateLimited = false;
  for (let i = 0; i < jobs.length; i += batchSize) {
    if (rateLimited) break;
    if (opts.deadline !== undefined && Date.now() > opts.deadline - BATCH_HEADROOM_MS) {
      errors.push(`Extraction stopped at time budget: ${jobs.length - i} left pending`);
      break;
    }
    const batch = jobs.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((j) =>
        run({ title: j.title, company: j.company, location: j.location, description: j.description ?? '' }),
      ),
    );
    await Promise.all(
      results.map(async (res, k) => {
        const j = batch[k];
        const attempts = j.extraction_attempts + 1;
        if (res.status === 'fulfilled') {
          const { error } = await db
            .from('jobs')
            .update({
              extracted_json: res.value.extracted,
              dropped_skills: res.value.dropped,
              ...(res.value.roleType ? { role_type: res.value.roleType } : {}),
              extraction_status: 'done',
              extraction_attempts: attempts,
            })
            .eq('id', j.id);
          if (error) {
            failed++;
            errors.push(`job ${j.id}: save failed: ${error.message}`);
          } else extracted++;
        } else if (isRateLimitError(res.reason)) {
          // not the job's fault: leave it as it was, count no attempt
          rateLimited = true;
        } else {
          failed++;
          const msg = res.reason instanceof Error ? res.reason.message : String(res.reason);
          errors.push(`job ${j.id}: ${msg}`);
          await db
            .from('jobs')
            .update({ extraction_status: 'failed', extraction_attempts: attempts })
            .eq('id', j.id);
        }
      }),
    );
  }
  return { extracted, failed, errors, rateLimited };
}
