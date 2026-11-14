// SERVER-ONLY (imports the Grok client). Grok sees only index, title and location.
import { z } from 'zod';
import { roleTypeSchema, type RoleType } from '../types';
import { callGrokJSON } from './grok';
import { classifyByKeyword } from './keywordFilter';

const CHUNK = 100;
const CONCURRENCY = 5;
/** Live Grok calls take about 10 s; don't start one that would land after the deadline. */
export const FILTER_HEADROOM_MS = 10_000;
export const FILTER_TIMEOUT_ERROR =
  'Role filter ran out of time; remaining titles used the keyword filter';

const labelsSchema = z.object({
  labels: z.array(z.object({ i: z.number().int().nonnegative(), role_type: roleTypeSchema })),
});

const SYSTEM =
  'Label each job posting by title as "internship" (internship, co-op), "new_grad" ' +
  '(new graduate, entry-level, early career), or "other". Recruiting, talent acquisition and ' +
  'sourcer jobs are "other" even if the title says "University". Return one label per index.';

type Posting = { title: string; location: string | null };

export async function filterRoles(
  postings: Posting[],
  opts: { grok?: typeof callGrokJSON; deadline?: number } = {},
): Promise<{ roleTypes: RoleType[]; usedFallback: boolean; errors: string[] }> {
  const grok = opts.grok ?? callGrokJSON;
  const roleTypes: RoleType[] = new Array(postings.length);
  const errors: string[] = [];
  let usedFallback = false;
  let reportedTimeout = false;
  const chunkCount = Math.ceil(postings.length / CHUNK);
  const outOfTime = () =>
    opts.deadline !== undefined && Date.now() > opts.deadline - FILTER_HEADROOM_MS;

  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= chunkCount) return;
      const start = index * CHUNK;
      const chunk = postings.slice(start, start + CHUNK);

      if (outOfTime()) {
        usedFallback = true;
        if (!reportedTimeout) {
          reportedTimeout = true;
          errors.push(FILTER_TIMEOUT_ERROR);
        }
        chunk.forEach((p, i) => {
          roleTypes[start + i] = classifyByKeyword(p.title);
        });
        continue;
      }

      // Keyword "other" skips Grok. Internship and new-grad titles still go.
      const pending: (Posting & { i: number })[] = [];
      chunk.forEach((p, i) => {
        if (classifyByKeyword(p.title) === 'other') roleTypes[start + i] = 'other';
        else pending.push({ i, title: p.title, location: p.location });
      });
      if (pending.length === 0) continue;

      try {
        const res = await grok(labelsSchema, {
          system: SYSTEM,
          user: JSON.stringify(pending.map((p, i) => ({ i, title: p.title, location: p.location }))),
          name: 'role_labels',
        });
        const seen = new Map<number, RoleType>();
        const dup = new Set<number>();
        for (const l of res.labels) {
          if (l.i >= pending.length) continue;
          if (seen.has(l.i)) dup.add(l.i);
          else seen.set(l.i, l.role_type);
        }
        pending.forEach((p, i) => {
          const label = seen.get(i);
          roleTypes[start + p.i] = label && !dup.has(i) ? label : classifyByKeyword(p.title);
        });
      } catch (e) {
        usedFallback = true;
        errors.push(e instanceof Error ? e.message : String(e));
        pending.forEach((p) => {
          roleTypes[start + p.i] = classifyByKeyword(p.title);
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunkCount) }, () => worker()));
  return { roleTypes, usedFallback, errors };
}
