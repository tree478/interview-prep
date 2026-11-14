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

export async function extractPending(
  db: SupabaseClient,
  runId: string,
  opts: { extractor: Extractor | null; limit?: number; batchSize?: number },
): Promise<{ extracted: number; failed: number; errors: string[] }> {
  void runId;
  if (!opts.extractor) return { extracted: 0, failed: 0, errors: [SKIP_MESSAGE] };
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
  if (retry.error) return { extracted: 0, failed: 0, errors: [`extract: ${retry.error.message}`] };
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
  for (let i = 0; i < jobs.length; i += batchSize) {
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
  return { extracted, failed, errors };
}
