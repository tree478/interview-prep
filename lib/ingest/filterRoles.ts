// SERVER-ONLY (imports the Grok client). Grok sees only index, title and location.
import { z } from 'zod';
import { roleTypeSchema, type RoleType } from '../types';
import { callGrokJSON } from './grok';
import { classifyByKeyword } from './keywordFilter';

const CHUNK = 100;

const labelsSchema = z.object({
  labels: z.array(z.object({ i: z.number().int().nonnegative(), role_type: roleTypeSchema })),
});

const SYSTEM =
  'Label each job posting by title as "internship" (internship, co-op), "new_grad" ' +
  '(new graduate, entry-level, early career), or "other". Recruiting, talent acquisition and ' +
  'sourcer jobs are "other" even if the title says "University". Return one label per index.';

export async function filterRoles(
  postings: { title: string; location: string | null }[],
  opts: { grok?: typeof callGrokJSON } = {},
): Promise<{ roleTypes: RoleType[]; usedFallback: boolean; errors: string[] }> {
  const grok = opts.grok ?? callGrokJSON;
  const roleTypes: RoleType[] = new Array(postings.length);
  const errors: string[] = [];
  let usedFallback = false;

  for (let start = 0; start < postings.length; start += CHUNK) {
    const chunk = postings.slice(start, start + CHUNK);
    try {
      const res = await grok(labelsSchema, {
        system: SYSTEM,
        user: JSON.stringify(chunk.map((p, i) => ({ i, title: p.title, location: p.location }))),
        name: 'role_labels',
      });
      const seen = new Map<number, RoleType>();
      const dup = new Set<number>();
      for (const l of res.labels) {
        if (l.i >= chunk.length) continue;
        if (seen.has(l.i)) dup.add(l.i);
        else seen.set(l.i, l.role_type);
      }
      chunk.forEach((p, i) => {
        const label = seen.get(i);
        roleTypes[start + i] = label && !dup.has(i) ? label : classifyByKeyword(p.title);
      });
    } catch (e) {
      usedFallback = true;
      errors.push(e instanceof Error ? e.message : String(e));
      chunk.forEach((p, i) => (roleTypes[start + i] = classifyByKeyword(p.title)));
    }
  }
  return { roleTypes, usedFallback, errors };
}
