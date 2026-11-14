// SERVER-ONLY. Syncs the CICS course page into umass_resources (GAP-2a, 2b, 2c).
// Uses the service-role client passed in by the route/script. Never deletes rows.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { callGeminiJSON } from '../../ai/gemini';
import { PAGE_URL, SEMESTER, USER_AGENT, parseCoursePage, type ParsedCourse } from './parse';
import { tagCourses, type TagReport } from './tag';

// TODO(types): ingest-only; matches BotRun.courseStats in lib/types.ts.
export interface CourseStats {
  found: number;
  added: number;
  changed: number;
  removed: number;
  unchanged: boolean;
}

export interface SyncResult {
  stats: CourseStats;
  errors: string[];
  /** false when the page sync was blocked or a write failed (the bot_runs row ends 'failed'). */
  ok: boolean;
  geminiCalls: number;
  /** Courses that still have 0 skills after the solo retry. */
  skillless: string[];
  usedSeed: boolean;
}

export interface SyncDeps {
  fetchPage?: () => Promise<string>;
  gemini?: typeof callGeminiJSON;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** Epoch ms; tagging stops near it (route only, the script has no limit). */
  deadline?: number;
  seedPath?: string;
  warn?: (message: string) => void;
}

interface ExistingRow {
  id: string;
  name: string;
  skills: string[];
  content_hash: string | null;
  active: boolean;
  meta: Record<string, unknown> | null;
}

const FETCH_TIMEOUT_MS = 20_000;
const MIN_FRACTION = 0.5;
const CHUNK = 50;
const MAX_ERRORS = 20;
const DEFAULT_SEED = join(process.cwd(), 'data/umass_resources.json');

export async function fetchCoursePage(): Promise<string> {
  const res = await fetch(PAGE_URL, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export function courseHash(c: ParsedCourse): string {
  return createHash('sha256')
    .update([c.code, c.title, c.instructors.join(', '), c.description].join('|'))
    .digest('hex');
}

/** name = title, but courses that share a title get "Title (CODE)" so (type, name) stays unique. */
export function courseNames(courses: ParsedCourse[]): Map<string, string> {
  const count = new Map<string, number>();
  for (const c of courses) count.set(c.title, (count.get(c.title) ?? 0) + 1);
  return new Map(courses.map((c) => [c.code, count.get(c.title)! > 1 ? `${c.title} (${c.code})` : c.title]));
}

function toRow(c: ParsedCourse, name: string, nowIso: string) {
  return {
    type: 'course' as const,
    name,
    url: c.url,
    description: c.description,
    source_url: PAGE_URL,
    meta: {
      code: c.code,
      instructors: c.instructors,
      prereqs: c.prereqs,
      level: c.level,
      credits: c.credits,
      semester: SEMESTER,
    },
    content_hash: courseHash(c) as string | null,
    active: true,
    last_checked_at: nowIso,
  };
}
type CourseRow = ReturnType<typeof toRow> & { skills?: string[] };

const msg = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e)).slice(0, 200);

const seedRowSchema = z.object({
  type: z.enum(['course', 'lab']),
  name: z.string().min(1),
  url: z.string().min(1),
  skills: z.array(z.string()).optional(),
  description: z.string().nullish(),
  meta: z.record(z.string(), z.unknown()).optional(),
  source_url: z.string().nullish(),
});

/** Seed fallback (GAP-2c): only used when the table has no course rows at all. */
async function loadSeed(db: SupabaseClient, path: string, nowIso: string, errors: string[]): Promise<boolean> {
  if (!existsSync(path)) {
    errors.push('No seed file (data/umass_resources.json) to fall back to');
    return false;
  }
  try {
    const rows = z.array(seedRowSchema).parse(JSON.parse(readFileSync(path, 'utf8')));
    const payload = rows.map((r) => ({
      type: r.type,
      name: r.name,
      url: r.url,
      skills: r.skills ?? [],
      description: r.description ?? null,
      meta: r.meta ?? {},
      source_url: r.source_url ?? null,
      active: true,
      last_checked_at: nowIso,
    }));
    for (let i = 0; i < payload.length; i += CHUNK) {
      const { error } = await db
        .from('umass_resources')
        .upsert(payload.slice(i, i + CHUNK), { onConflict: 'type,name' });
      if (error) throw new Error(error.message);
    }
    errors.push(`Loaded ${payload.length} resources from the bundled seed file`);
    return true;
  } catch (e) {
    errors.push(`Could not load the seed file: ${msg(e)}`);
    return false;
  }
}

export async function syncCourses(
  db: SupabaseClient,
  runId: string | null,
  deps: SyncDeps = {},
): Promise<SyncResult> {
  let result: SyncResult;
  try {
    result = await run(db, deps);
  } catch (e) {
    result = {
      stats: { found: 0, added: 0, changed: 0, removed: 0, unchanged: true },
      errors: [`Course sync failed: ${msg(e)}`],
      ok: false,
      geminiCalls: 0,
      skillless: [],
      usedSeed: false,
    };
  }
  if (runId) await finishRun(db, runId, result, deps.now ?? (() => new Date()));
  return result;
}

async function finishRun(db: SupabaseClient, runId: string, r: SyncResult, now: () => Date) {
  try {
    const { error } = await db
      .from('bot_runs')
      .update({
        status: r.ok ? 'done' : 'failed',
        finished_at: now().toISOString(),
        course_stats: r.stats,
        errors: r.errors.slice(0, MAX_ERRORS),
      })
      .eq('id', runId);
    if (error) console.error(`bot_runs update failed: ${error.message}`);
  } catch (e) {
    console.error(`bot_runs update threw: ${msg(e)}`);
  }
}

async function run(db: SupabaseClient, deps: SyncDeps): Promise<SyncResult> {
  const nowIso = (deps.now ?? (() => new Date()))().toISOString();
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  const errors: string[] = [];
  const report: TagReport = { errors: [], skillless: [], geminiCalls: 0 };

  // a. fetch + parse
  let parsed: ParsedCourse[] = [];
  let fetchFailed = false;
  try {
    parsed = parseCoursePage(await (deps.fetchPage ?? fetchCoursePage)(), warn);
  } catch (e) {
    fetchFailed = true;
    errors.push(`Could not fetch or parse the course page: ${msg(e)}`);
  }

  const existingRes = await db
    .from('umass_resources')
    .select('id,name,skills,content_hash,active,meta')
    .eq('type', 'course');
  if (existingRes.error) throw new Error(`Could not read umass_resources: ${existingRes.error.message}`);
  const existing = (existingRes.data ?? []) as ExistingRow[];
  const activeCount = existing.filter((r) => r.active).length;

  // b. sanity check: never touch existing rows on a bad fetch or a suspiciously small page
  const tooFew = parsed.length < activeCount * MIN_FRACTION;
  if (fetchFailed || parsed.length === 0 || tooFew) {
    if (!fetchFailed) {
      errors.push(
        parsed.length === 0
          ? 'The course page parsed to 0 courses; kept the existing data'
          : `The course page has ${parsed.length} courses but ${activeCount} are active; kept the existing data`,
      );
    }
    const usedSeed =
      existing.length === 0 ? await loadSeed(db, deps.seedPath ?? DEFAULT_SEED, nowIso, errors) : false;
    return {
      stats: { found: parsed.length, added: 0, changed: 0, removed: 0, unchanged: true },
      errors,
      ok: false,
      geminiCalls: 0,
      skillless: [],
      usedSeed,
    };
  }

  // c. compare with existing rows by meta.code
  const codeOf = (r: ExistingRow) => (typeof r.meta?.code === 'string' ? r.meta.code : null);
  const byCode = new Map<string, ExistingRow>();
  for (const r of existing) {
    const code = codeOf(r);
    if (code && !byCode.has(code)) byCode.set(code, r);
  }
  const onPage = new Set(parsed.map((c) => c.code));
  const names = courseNames(parsed);

  const added: ParsedCourse[] = [];
  const changed: ParsedCourse[] = [];
  const unchangedIds: string[] = [];
  let reactivated = 0;
  for (const c of parsed) {
    const ex = byCode.get(c.code);
    if (!ex) added.push(c);
    else if (ex.content_hash !== courseHash(c)) changed.push(c);
    else {
      unchangedIds.push(ex.id);
      if (!ex.active) reactivated++;
    }
  }
  const removedIds = existing
    .filter((r) => r.active && codeOf(r) && !onPage.has(codeOf(r)!))
    .map((r) => r.id);

  let writeFailed = false;
  const write = async (label: string, op: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await op;
    if (error) {
      writeFailed = true;
      errors.push(`${label} failed: ${error.message.slice(0, 200)}`);
    }
  };

  // d. tag only added + changed
  const toTag = [...added, ...changed];
  const tags =
    toTag.length > 0
      ? await tagCourses(toTag, { gemini: deps.gemini, sleep: deps.sleep, deadline: deps.deadline, report })
      : new Map<string, string[]>();

  // e. upsert added/changed. Courses that could not be tagged get content_hash null (and keep their
  // old skills, or the default [] when new) so the next run treats them as changed and retries.
  const renames: { id: string; row: CourseRow }[] = [];
  const withSkills: CourseRow[] = [];
  const withoutSkills: CourseRow[] = [];
  for (const c of toTag) {
    const name = names.get(c.code)!;
    const row: CourseRow = toRow(c, name, nowIso);
    const skills = tags.get(c.code);
    if (skills) row.skills = skills;
    else row.content_hash = null;

    const ex = byCode.get(c.code);
    if (ex && ex.name !== name) renames.push({ id: ex.id, row }); // (type, name) would not match this row
    else (skills ? withSkills : withoutSkills).push(row);
  }
  for (const rows of [withSkills, withoutSkills]) {
    for (let i = 0; i < rows.length; i += CHUNK) {
      await write(
        'Upsert of courses',
        db.from('umass_resources').upsert(rows.slice(i, i + CHUNK), { onConflict: 'type,name' }),
      );
    }
  }
  for (const { id, row } of renames) {
    await write(`Update of ${row.meta.code}`, db.from('umass_resources').update(row).eq('id', id));
  }

  // unchanged rows: refresh last_checked_at and make sure they are active
  for (let i = 0; i < unchangedIds.length; i += CHUNK) {
    await write(
      'Refresh of unchanged courses',
      db
        .from('umass_resources')
        .update({ last_checked_at: nowIso, active: true })
        .in('id', unchangedIds.slice(i, i + CHUNK)),
    );
  }
  // vanished courses become inactive, never deleted
  for (let i = 0; i < removedIds.length; i += CHUNK) {
    await write(
      'Deactivating removed courses',
      db.from('umass_resources').update({ active: false }).in('id', removedIds.slice(i, i + CHUNK)),
    );
  }

  // f. stats
  const stats: CourseStats = {
    found: parsed.length,
    added: added.length,
    changed: changed.length + reactivated,
    removed: removedIds.length,
    unchanged: false,
  };
  stats.unchanged = stats.added + stats.changed + stats.removed === 0;

  return {
    stats,
    errors: [...errors, ...report.errors],
    ok: !writeFailed,
    geminiCalls: report.geminiCalls,
    skillless: report.skillless,
    usedSeed: false,
  };
}
