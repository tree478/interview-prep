/* eslint-disable @typescript-eslint/no-explicit-any, prefer-const */
import { describe, expect, it, vi } from 'vitest';
import { botRunSchema } from '../types';
import { secretAuth } from './auth';
import { toBotRun } from './botRuns';
import { extractPending, isRateLimitError, type Extractor } from './extract';
import { runScout, type ScoutDeps } from './runScout';

// Minimal in-memory fake of the supabase query builder used by the pipeline.
type Row = Record<string, any>;
function fakeDb(tables: Record<string, Row[]>) {
  const log: { table: string; op: string; payload?: any }[] = [];
  function from(table: string) {
    const rows = (tables[table] ??= []);
    let filters: ((r: Row) => boolean)[] = [];
    let op = 'select';
    let payload: any;
    let lim = Infinity;
    let order: { col: string; asc: boolean } | null = null;
    let ignoreDup = false;
    const run = () => {
      let out = rows.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') {
        out.forEach((r) => Object.assign(r, payload));
        log.push({ table, op, payload });
      } else if (op === 'upsert') {
        out = [];
        for (const p of payload as Row[]) {
          if (ignoreDup && rows.some((r) => r.source === p.source && r.external_id === p.external_id)) continue;
          const row = { id: `j${rows.length + 1}`, extraction_attempts: 0, ...p };
          rows.push(row);
          out.push(row);
        }
        log.push({ table, op });
      } else {
        if (order) out = [...out].sort((a, b) => (a[order!.col] > b[order!.col] ? 1 : -1) * (order!.asc ? 1 : -1));
        out = out.slice(0, lim);
      }
      return { data: out, error: null };
    };
    const b: any = {
      select: () => b,
      update: (p: Row) => ((op = 'update'), (payload = p), b),
      upsert: (p: Row[], o: any) => ((op = 'upsert'), (payload = p), (ignoreDup = !!o?.ignoreDuplicates), b),
      eq: (c: string, v: any) => (filters.push((r) => r[c] === v), b),
      lt: (c: string, v: any) => (filters.push((r) => r[c] < v), b),
      in: (c: string, v: any[]) => (filters.push((r) => v.includes(r[c])), b),
      order: (c: string, o: any) => ((order = { col: c, asc: o?.ascending !== false }), b),
      limit: (n: number) => ((lim = n), b),
      range: (a: number, z: number) => ((lim = z + 1), b),
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  }
  return { db: { from } as any, tables, log };
}

const posting = (company: string, id: string, title: string) => ({
  source: 'greenhouse' as const,
  external_id: id,
  company,
  title,
  location: 'Boston',
  url: `https://x/${id}`,
  description: 'd',
  posted_at: null,
});

function setup(extractor: Extractor | null = null, failFor?: string) {
  const f = fakeDb({
    companies: [
      { id: 'c1', name: 'Acme', source: 'greenhouse', slug: 'acme', last_checked_at: null },
      { id: 'c2', name: 'Bad', source: 'greenhouse', slug: 'bad', last_checked_at: null },
    ],
    jobs: [],
    bot_runs: [{ id: 'r1', status: 'running' }],
  });
  const deps: ScoutDeps = {
    db: f.db,
    selectCompanies: async () => ({
      selected: [
        { companyId: 'c1', company: 'Acme', reason: 'r', fallback: true },
        { companyId: 'c2', company: 'Bad', reason: 'r', fallback: true },
      ],
      errors: [],
    }),
    fetchers: {
      greenhouse: async (c) => {
        if (c.name === failFor) throw new Error('HTTP 500');
        return [posting(c.name, c.slug + '1', 'SWE Intern'), posting(c.name, c.slug + '2', 'Staff Engineer')];
      },
      lever: async () => [],
    },
    filterRoles: async (ps) => ({
      roleTypes: ps.map((p) => (/intern/i.test(p.title) ? 'internship' : 'other')),
      usedFallback: false,
      errors: [],
    }),
    extractor,
    now: () => new Date('2026-11-14T00:00:00Z'),
    delayMs: 0,
  };
  return { f, deps };
}

describe('runScout', () => {
  it('normal run: counts, companies updated, run finished', async () => {
    const { f, deps } = setup(async () => ({ extracted: { ok: 1 }, dropped: ['X'] }));
    await runScout('r1', deps);
    const run = f.tables.bot_runs[0];
    expect(run).toMatchObject({ status: 'done', companies_checked: 2, jobs_added: 2, jobs_extracted: 2 });
    expect(run.finished_at).toBeTruthy();
    expect(f.tables.jobs.every((j) => j.role_type === 'internship' && j.ingested_by_run_id === 'r1')).toBe(true);
    expect(f.tables.companies[0]).toMatchObject({ last_postings_found: 2 });
    expect(f.tables.companies[0].last_checked_at).toBe('2026-11-14T00:00:00.000Z');
  });

  it('a failing fetcher is logged, others processed, its last_checked_at unchanged', async () => {
    const { f, deps } = setup(null, 'Bad');
    await runScout('r1', deps);
    const run = f.tables.bot_runs[0];
    expect(run.status).toBe('done');
    expect(run.companies_checked).toBe(1);
    expect(run.errors).toContain('Bad: HTTP 500');
    expect(f.tables.companies[1].last_checked_at).toBeNull();
    expect(f.tables.companies[0].last_checked_at).not.toBeNull();
  });

  it('null extractor leaves jobs pending and logs the skip', async () => {
    const { f, deps } = setup(null);
    await runScout('r1', deps);
    expect(f.tables.jobs.every((j) => j.extraction_status === 'pending' && j.extraction_attempts === 0)).toBe(true);
    expect(f.tables.bot_runs[0].errors.some((e: string) => e.startsWith('Extraction skipped'))).toBe(true);
  });

  it('second run adds nothing (dedupe)', async () => {
    const { f, deps } = setup();
    await runScout('r1', deps);
    f.tables.bot_runs[0].jobs_added = -1;
    await runScout('r1', deps);
    expect(f.tables.bot_runs[0].jobs_added).toBe(0);
  });
});

describe('extractPending', () => {
  it('retries failed before pending and stops at the limit', async () => {
    const jobs: Row[] = [
      ...Array.from({ length: 50 }, (_, i) => ({
        id: `p${String(i).padStart(2, '0')}`, title: 't', company: 'c', location: null, description: '',
        extraction_status: 'pending', extraction_attempts: 0, posted_at: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      })),
      { id: 'f1', title: 't', company: 'c', location: null, description: '', extraction_status: 'failed', extraction_attempts: 1 },
      { id: 'f2', title: 't', company: 'c', location: null, description: '', extraction_status: 'failed', extraction_attempts: 2 },
    ];
    const f = fakeDb({ jobs });
    const calls: string[] = [];
    const ex: Extractor = vi.fn(async () => ({ extracted: {}, dropped: [] }));
    const res = await extractPending(f.db, 'r', { extractor: ex });
    void calls;
    expect(res.extracted).toBe(40);
    expect(ex).toHaveBeenCalledTimes(40);
    expect(jobs.find((j) => j.id === 'f1')).toMatchObject({ extraction_status: 'done', extraction_attempts: 2 });
    expect(jobs.find((j) => j.id === 'f2')?.extraction_status).toBe('failed'); // exhausted, untouched
    expect(jobs.filter((j) => j.extraction_status === 'pending')).toHaveLength(11);
  });

  it('marks failures with attempts+1 and an error naming the job', async () => {
    const jobs: Row[] = [{ id: 'a', title: 't', company: 'c', location: null, description: '', extraction_status: 'pending', extraction_attempts: 0 }];
    const f = fakeDb({ jobs });
    const res = await extractPending(f.db, 'r', { extractor: async () => { throw new Error('boom'); } });
    expect(res.failed).toBe(1);
    expect(res.errors[0]).toContain('job a: boom');
    expect(jobs[0]).toMatchObject({ extraction_status: 'failed', extraction_attempts: 1 });
  });
});

describe('extractPending time budget and rate limits', () => {
  const mk = (n: number): Row[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `p${String(i).padStart(2, '0')}`, title: 't', company: 'c', location: null, description: '',
      extraction_status: 'pending', extraction_attempts: 0, posted_at: null,
    }));

  it('starts no batch when the deadline is near, leaves jobs pending and says so', async () => {
    const jobs = mk(8);
    const ex: Extractor = vi.fn(async () => ({ extracted: {}, dropped: [] }));
    const res = await extractPending(fakeDb({ jobs }).db, null, { extractor: ex, deadline: Date.now() + 10_000 });
    expect(ex).not.toHaveBeenCalled();
    expect(res.extracted).toBe(0);
    expect(res.errors).toEqual(['Extraction stopped at time budget: 8 left pending']);
    expect(jobs.every((j) => j.extraction_status === 'pending')).toBe(true);
  });

  it('adds no message when the deadline is far', async () => {
    const jobs = mk(3);
    const ex: Extractor = vi.fn(async () => ({ extracted: {}, dropped: [] }));
    const res = await extractPending(fakeDb({ jobs }).db, null, { extractor: ex, deadline: Date.now() + 60_000 });
    expect(res).toMatchObject({ extracted: 3, errors: [], rateLimited: false });
  });

  it('saves role_type, dropped_skills and extracted_json from the adapter result', async () => {
    const jobs = mk(1);
    const ex: Extractor = async () => ({ extracted: { requiredSkills: ['Python'] }, dropped: ['Foo'], roleType: 'new_grad' });
    await extractPending(fakeDb({ jobs }).db, null, { extractor: ex });
    expect(jobs[0]).toMatchObject({
      extraction_status: 'done', extraction_attempts: 1, role_type: 'new_grad',
      dropped_skills: ['Foo'], extracted_json: { requiredSkills: ['Python'] },
    });
  });

  it('a rate-limited job stays pending with no attempt counted; later batches do not start', async () => {
    const jobs = mk(10);
    jobs[1].extraction_status = 'failed';
    jobs[1].extraction_attempts = 1;
    const ex: Extractor = vi.fn(async (j) => {
      if (j.title === 't') throw new Error('429 RESOURCE_EXHAUSTED');
      return { extracted: {}, dropped: [] };
    });
    const res = await extractPending(fakeDb({ jobs }).db, null, { extractor: ex, batchSize: 5 });
    expect(res).toMatchObject({ extracted: 0, failed: 0, errors: [], rateLimited: true });
    expect(ex).toHaveBeenCalledTimes(5); // second batch never started
    expect(jobs[1]).toMatchObject({ extraction_status: 'failed', extraction_attempts: 1 });
    expect(jobs.filter((j) => j.extraction_status === 'pending')).toHaveLength(9);
    expect(jobs.every((j) => j.extraction_attempts <= 1)).toBe(true);
  });

  it('other errors in the same batch still fail normally and good ones are saved', async () => {
    const jobs = mk(3);
    jobs[0].title = 'rate';
    jobs[1].title = 'bad';
    const ex: Extractor = async (j) => {
      if (j.title === 'rate') throw new Error('quota exceeded');
      if (j.title === 'bad') throw new Error('boom');
      return { extracted: {}, dropped: [] };
    };
    const res = await extractPending(fakeDb({ jobs }).db, null, { extractor: ex });
    expect(res).toMatchObject({ extracted: 1, failed: 1, rateLimited: true });
    expect(jobs.map((j) => j.extraction_status)).toEqual(['pending', 'failed', 'done']);
  });
});

describe('isRateLimitError', () => {
  it('detects 429, RESOURCE_EXHAUSTED, quota, rate (message, status, cause)', () => {
    expect(isRateLimitError(new Error('got 429'))).toBe(true);
    expect(isRateLimitError(new Error('RESOURCE_EXHAUSTED: slow down'))).toBe(true);
    expect(isRateLimitError(new Error('You exceeded your current quota'))).toBe(true);
    expect(isRateLimitError(new Error('Rate limit reached'))).toBe(true);
    expect(isRateLimitError(Object.assign(new Error('x'), { status: 429 }))).toBe(true);
    expect(isRateLimitError(new Error('wrapped', { cause: Object.assign(new Error('y'), { status: 429 }) }))).toBe(true);
  });
  it('ignores unrelated errors', () => {
    expect(isRateLimitError(new Error('Gemini response failed validation: generated bad JSON'))).toBe(false);
    expect(isRateLimitError(new Error('This operation was aborted'))).toBe(false);
    expect(isRateLimitError(Object.assign(new Error('x'), { status: 500 }))).toBe(false);
  });
});

describe('toBotRun', () => {
  it('maps a row to a valid BotRun', () => {
    const run = toBotRun({
      id: '6f1c2c1e-2d5a-4a53-9a38-1d0e2f6f8b11',
      started_at: '2026-11-14T00:00:00Z', finished_at: null, trigger: 'cron', kind: 'scout', status: 'running',
      companies_selected: [{ company: 'Acme', reason: 'r', fallback: true }],
      companies_checked: 1, jobs_added: 2, jobs_extracted: 0, briefs_written: 0, course_stats: null, errors: [],
    });
    expect(botRunSchema.safeParse(run).success).toBe(true);
    expect('courseStats' in run).toBe(false);
  });
});

describe('secretAuth', () => {
  const env = { CRON_SECRET: 'cron-secret', INGEST_KEY: 'ingest-key' };
  const h = (o: Record<string, string>) => new Headers(o);
  it('accepts cron bearer and x-ingest-key', () => {
    expect(secretAuth(h({ authorization: 'Bearer cron-secret' }), env)).toBe('cron');
    expect(secretAuth(h({ 'x-ingest-key': 'ingest-key' }), env)).toBe('cron');
  });
  it('rejects wrong, missing, or unconfigured secrets', () => {
    expect(secretAuth(h({ authorization: 'Bearer nope' }), env)).toBeNull();
    expect(secretAuth(h({ 'x-ingest-key': 'x' }), env)).toBeNull();
    expect(secretAuth(h({}), env)).toBeNull();
    expect(secretAuth(h({ authorization: 'Bearer ' }), {})).toBeNull();
  });
});
