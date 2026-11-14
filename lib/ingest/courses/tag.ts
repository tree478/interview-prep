// SERVER-ONLY. Tags courses with canonical skills via Gemini (GAP-2a).
// Every response goes through callGeminiJSON (zod + one retry); tags not on data/skills.json are dropped.
import { z } from 'zod';
import rawSkills from '../../../data/skills.json';
import { callGeminiJSON } from '../../ai/gemini';
import { canonicalize } from '../../match/skills';
import type { ParsedCourse } from './parse';

export const BATCH_SIZE = 20;
export const BATCH_GAP_MS = 4_000; // free tier is about 15 requests/min
export const RATE_LIMIT_WAIT_MS = 30_000;
const DESCRIPTION_CHARS = 1_500;
const DEADLINE_MARGIN_MS = 10_000; // do not start a Gemini call this close to the deadline

const CANONICAL_NAMES = (rawSkills as { canonical_name: string }[]).map((s) => s.canonical_name);

export const tagResponseSchema = z.object({
  courses: z.array(z.object({ code: z.string(), skills: z.array(z.string()) })),
});

/** Filled in by tagCourses so callers can log what happened. */
export interface TagReport {
  errors: string[];
  /** Courses still at 0 skills after a solo retry (some, like seminars, may legitimately have none). */
  skillless: string[];
  geminiCalls: number;
}

export interface TagDeps {
  gemini?: typeof callGeminiJSON;
  sleep?: (ms: number) => Promise<void>;
  /** Epoch ms. No new Gemini call is started near it; the rest are reported as errors. */
  deadline?: number;
  report?: TagReport;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function redact(text: string): string {
  let out = text.replace(/([?&]key=)[^&\s"']+/gi, '$1[redacted]');
  const k = process.env.GEMINI_API_KEY?.trim();
  if (k) out = out.split(k).join('[redacted]');
  return out.slice(0, 200);
}

const errText = (e: unknown) => redact(e instanceof Error && e.message ? e.message : 'Gemini request failed');
const isRateLimit = (e: unknown) =>
  /429|rate.?limit|quota|resource_exhausted|too many requests/i.test(e instanceof Error ? e.message : '');

export function buildPrompt(courses: ParsedCourse[]): string {
  const list = CANONICAL_NAMES.map((n) => `- ${n}`).join('\n');
  const body = courses
    .map((c) => `[${c.code}] ${c.title}\n${c.description.slice(0, DESCRIPTION_CHARS)}`)
    .join('\n\n');
  return `You tag UMass Amherst CICS courses with skills.

Allowed skills (exact names):
${list}

Return only skills from the list that this course actually teaches or requires students to use. Use the exact names from the list. Never add skills that aren't listed. If none apply, return an empty list for that course. Return one entry per course, using the course code in square brackets as "code".

Courses:

${body}`;
}

export async function tagCourses(
  courses: ParsedCourse[],
  deps: TagDeps = {},
): Promise<Map<string, string[]>> {
  const gemini = deps.gemini ?? callGeminiJSON;
  const sleep = deps.sleep ?? realSleep;
  const report = deps.report ?? { errors: [], skillless: [], geminiCalls: 0 };
  const result = new Map<string, string[]>();
  let calls = 0;

  const outOfTime = () => deps.deadline !== undefined && Date.now() > deps.deadline - DEADLINE_MARGIN_MS;

  /** One paced Gemini call. Returns canonical skills per code, only for codes in the batch. */
  async function callOnce(batch: ParsedCourse[]): Promise<Map<string, string[]>> {
    if (calls > 0) await sleep(BATCH_GAP_MS);
    calls++;
    report.geminiCalls++;
    const res = await gemini(tagResponseSchema, buildPrompt(batch), { timeoutMs: 30_000 });
    const inBatch = new Set(batch.map((c) => c.code));
    const out = new Map<string, string[]>();
    for (const row of res.courses) {
      if (!inBatch.has(row.code)) continue; // the model never adds courses
      out.set(row.code, canonicalize(row.skills).canonical); // off-list tags are dropped
    }
    return out;
  }

  /** callOnce, retried once. Rate limits wait 30 s first. */
  async function callWithRetry(batch: ParsedCourse[]): Promise<Map<string, string[]>> {
    try {
      return await callOnce(batch);
    } catch (first) {
      const wait = isRateLimit(first) ? RATE_LIMIT_WAIT_MS : 0;
      if (outOfTime() || (deps.deadline !== undefined && Date.now() + wait > deps.deadline - DEADLINE_MARGIN_MS)) {
        throw first;
      }
      if (wait) await sleep(wait);
      return await callOnce(batch);
    }
  }

  for (let i = 0; i < courses.length; i += BATCH_SIZE) {
    const batch = courses.slice(i, i + BATCH_SIZE);
    if (outOfTime()) {
      const left = courses.length - i;
      report.errors.push(`Ran out of time before tagging ${left} courses; they will be retried on the next run`);
      break;
    }
    try {
      const tagged = await callWithRetry(batch);
      // A course the model skipped counts as 0 skills and gets the solo retry below.
      for (const c of batch) result.set(c.code, tagged.get(c.code) ?? []);
    } catch (e) {
      report.errors.push(
        `Gemini tagging failed for ${batch.length} courses (${batch[0].code} to ${batch[batch.length - 1].code}): ${errText(e)}`,
      );
    }
  }

  // Solo retry for anything that came back with no skills.
  for (const c of courses) {
    if (result.get(c.code)?.length !== 0) continue;
    if (outOfTime()) {
      result.delete(c.code); // unknown, not "no skills": the caller retries it next run
      continue;
    }
    try {
      const again = (await callWithRetry([c])).get(c.code) ?? [];
      result.set(c.code, again);
      if (again.length === 0) report.skillless.push(c.code);
    } catch (e) {
      result.delete(c.code);
      report.errors.push(`Gemini retry failed for ${c.code}: ${errText(e)}`);
    }
  }

  return result;
}
