import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { callGeminiJSON } from '../../ai/gemini';
import { parseCoursePage } from './parse';
import { courseHash, courseNames, syncCourses } from './sync';

/* ---------- tiny in-memory stand-in for the Supabase calls sync.ts makes ---------- */
type Row = Record<string, unknown>;
class FakeDb {
  resources: Row[] = [];
  botRuns: Row[] = [{ id: 'run-1', status: 'running' }];
  private seq = 0;
  from(table: string) {
    return new Query(this, table);
  }
}
class Query {
  private op: 'select' | 'upsert' | 'update' = 'select';
  private payload: Row | Row[] = {};
  private filters: ((r: Row) => boolean)[] = [];
  constructor(
    private db: FakeDb,
    private table: string,
  ) {}
  select() {
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  upsert(rows: Row[]) {
    this.op = 'upsert';
    this.payload = rows;
    return this;
  }
  update(patch: Row) {
    this.op = 'update';
    this.payload = patch;
    return this;
  }
  then(ok?: (v: { data?: Row[]; error: null }) => unknown, bad?: (e: unknown) => unknown) {
    return Promise.resolve(this.exec()).then(ok, bad);
  }
  private exec() {
    const rows = this.table === 'bot_runs' ? this.db.botRuns : this.db.resources;
    const match = (r: Row) => this.filters.every((f) => f(r));
    if (this.op === 'select') return { data: rows.filter(match).map((r) => ({ ...r })), error: null };
    if (this.op === 'update') {
      rows.filter(match).forEach((r) => Object.assign(r, this.payload));
    } else {
      for (const row of this.payload as Row[]) {
        const hit = rows.find((r) => r.type === row.type && r.name === row.name);
        if (hit) Object.assign(hit, row);
        else rows.push({ id: `id-${rows.length}-${Math.random()}`, skills: [], active: true, ...row });
      }
    }
    return { error: null };
  }
}
const asDb = (d: FakeDb) => d as unknown as SupabaseClient;

/* ---------- helpers ---------- */
interface Item {
  code: string;
  title: string;
  desc?: string;
}
const page = (items: Item[]) =>
  `<html><body><h2>Main Menu</h2>${items
    .map(
      (i) =>
        `<h2><a href="" name="${i.code.split(' ')[1]}">${i.code}: ${i.title}  </a></h2><h3>Instructor(s): A B, C D</h3><p>${i.desc ?? `About ${i.title}.`} 3 credits.</p>`,
    )
    .join('')}</body></html>`;
const ITEMS: Item[] = Array.from({ length: 10 }, (_, i) => ({ code: `COMPSCI ${200 + i}`, title: `Title ${i}` }));

function gemini() {
  const fn = vi.fn(async (_s: unknown, prompt: string) => ({
    courses: [...prompt.matchAll(/^\[([^\]]+)\] /gm)].map((m) => ({ code: m[1], skills: ['Python', 'Not A Skill'] })),
  }));
  return { fn, gemini: fn as unknown as typeof callGeminiJSON };
}
const base = { sleep: async () => {}, now: () => new Date('2026-11-14T12:00:00Z') };
const sync = (db: FakeDb, html: string | Error, g: { gemini: typeof callGeminiJSON } = gemini(), extra: object = {}) =>
  syncCourses(asDb(db), 'run-1', {
    ...base,
    gemini: g.gemini,
    fetchPage: async () => {
      if (html instanceof Error) throw html;
      return html;
    },
    ...extra,
  });

describe('syncCourses', () => {
  it('first run adds and tags every course, then logs the run', async () => {
    const db = new FakeDb();
    const g = gemini();
    const r = await sync(db, page(ITEMS), g);
    expect(r.stats).toEqual({ found: 10, added: 10, changed: 0, removed: 0, unchanged: false });
    expect(db.resources).toHaveLength(10);
    const row = db.resources.find((x) => (x.meta as Row).code === 'COMPSCI 200')!;
    expect(row).toMatchObject({
      type: 'course',
      name: 'Title 0',
      skills: ['Python'], // off-list tag dropped
      active: true,
      source_url: expect.stringContaining('spring-2026-course-descriptions'),
      last_checked_at: '2026-11-14T12:00:00.000Z',
    });
    expect(row.meta).toMatchObject({
      code: 'COMPSCI 200',
      instructors: ['A B', 'C D'],
      level: 200,
      credits: 3,
      semester: 'Spring 2026',
    });
    expect(db.botRuns[0]).toMatchObject({ status: 'done', course_stats: r.stats, errors: [] });
    expect(r.geminiCalls).toBe(1);
  });

  it('second run is unchanged and makes 0 Gemini calls', async () => {
    const db = new FakeDb();
    await sync(db, page(ITEMS));
    const g = gemini();
    const r = await sync(db, page(ITEMS), g);
    expect(r.stats).toEqual({ found: 10, added: 0, changed: 0, removed: 0, unchanged: true });
    expect(g.fn).not.toHaveBeenCalled();
    expect(db.resources.every((x) => (x.skills as string[]).length === 1)).toBe(true);
  });

  it('re-tags only the course whose content changed', async () => {
    const db = new FakeDb();
    await sync(db, page(ITEMS));
    const changedItems = ITEMS.map((i, n) => (n === 3 ? { ...i, desc: 'Brand new description.' } : i));
    const g = gemini();
    const r = await sync(db, page(changedItems), g);
    expect(r.stats).toMatchObject({ added: 0, changed: 1, removed: 0, unchanged: false });
    expect(g.fn).toHaveBeenCalledTimes(1);
    const prompt = g.fn.mock.calls[0][1] as string;
    expect(prompt).toContain('[COMPSCI 203]');
    expect(prompt).not.toContain('[COMPSCI 204]');
  });

  it('marks vanished courses inactive and never deletes them', async () => {
    const db = new FakeDb();
    await sync(db, page(ITEMS));
    const r = await sync(db, page(ITEMS.slice(0, 8)));
    expect(r.stats).toMatchObject({ found: 8, removed: 2, unchanged: false });
    expect(db.resources).toHaveLength(10);
    expect(db.resources.filter((x) => x.active === false)).toHaveLength(2);
    // and they come back when the page lists them again
    const back = await sync(db, page(ITEMS));
    expect(back.stats).toMatchObject({ changed: 2, added: 0 });
    expect(db.resources.every((x) => x.active === true)).toBe(true);
  });

  it('keeps existing rows when the fetch fails', async () => {
    const db = new FakeDb();
    await sync(db, page(ITEMS));
    const before = JSON.stringify(db.resources);
    const r = await sync(db, new Error('HTTP 503'));
    expect(r.ok).toBe(false);
    expect(r.stats.found).toBe(0);
    expect(r.errors[0]).toContain('HTTP 503');
    expect(JSON.stringify(db.resources)).toBe(before);
    expect(db.botRuns[0]).toMatchObject({ status: 'failed' });
  });

  it('keeps existing rows when the page has under 50% of the active courses', async () => {
    const db = new FakeDb();
    await sync(db, page(ITEMS));
    const before = JSON.stringify(db.resources);
    const r = await sync(db, page(ITEMS.slice(0, 4)));
    expect(r.ok).toBe(false);
    expect(r.stats).toMatchObject({ found: 4, added: 0, removed: 0 });
    expect(r.errors[0]).toMatch(/kept the existing data/);
    expect(JSON.stringify(db.resources)).toBe(before);
  });

  it('keeps existing rows when the page parses to 0 courses', async () => {
    const db = new FakeDb();
    await sync(db, page(ITEMS));
    const r = await sync(db, '<html><body><h2>Main Menu</h2></body></html>');
    expect(r.ok).toBe(false);
    expect(db.resources.filter((x) => x.active)).toHaveLength(10);
  });

  it('falls back to the seed file when the table has no courses', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'));
    const seedPath = join(dir, 'umass_resources.json');
    writeFileSync(
      seedPath,
      JSON.stringify([
        { type: 'course', name: 'Seed Course', url: 'https://x.edu/c', skills: ['Python'], meta: { code: 'CICS 1' } },
        { type: 'lab', name: 'Seed Lab', url: 'https://x.edu/l', skills: ['Machine learning'] },
      ]),
    );
    const db = new FakeDb();
    const r = await sync(db, new Error('offline'), gemini(), { seedPath });
    expect(r.usedSeed).toBe(true);
    expect(db.resources.map((x) => x.name).sort()).toEqual(['Seed Course', 'Seed Lab']);
    expect(r.errors.join(' ')).toContain('offline');
  });

  it('reports a missing seed file instead of crashing', async () => {
    const db = new FakeDb();
    const r = await sync(db, new Error('offline'), gemini(), { seedPath: '/nope/none.json' });
    expect(r.usedSeed).toBe(false);
    expect(r.errors.join(' ')).toMatch(/No seed file/);
  });

  it('stores untagged courses with a null hash so the next run retries them', async () => {
    const db = new FakeDb();
    const bad = vi.fn(async () => {
      throw new Error('quota');
    });
    const r1 = await sync(db, page(ITEMS.slice(0, 2)), { gemini: bad as unknown as typeof callGeminiJSON });
    expect(r1.errors.join(' ')).toContain('Gemini tagging failed');
    expect(db.resources).toHaveLength(2);
    expect(db.resources.every((x) => x.content_hash === null && (x.skills as string[]).length === 0)).toBe(true);

    const r2 = await sync(db, page(ITEMS.slice(0, 2)));
    expect(r2.stats).toMatchObject({ added: 0, changed: 2 });
    expect(db.resources.every((x) => x.content_hash !== null && (x.skills as string[]).length === 1)).toBe(true);
  });

  it('leaves existing skills alone when re-tagging a changed course fails', async () => {
    const db = new FakeDb();
    await sync(db, page(ITEMS.slice(0, 2)));
    const bad = vi.fn(async () => {
      throw new Error('down');
    });
    const changedItems = ITEMS.slice(0, 2).map((i) => ({ ...i, desc: 'New text.' }));
    await sync(db, page(changedItems), { gemini: bad as unknown as typeof callGeminiJSON });
    expect(db.resources.every((x) => (x.skills as string[]).join() === 'Python')).toBe(true);
    expect(db.resources.every((x) => x.content_hash === null)).toBe(true);
  });

  it('renames in place when a course title changes (no duplicate row)', async () => {
    const db = new FakeDb();
    await sync(db, page(ITEMS));
    const renamed = ITEMS.map((i, n) => (n === 0 ? { ...i, title: 'Renamed Title' } : i));
    await sync(db, page(renamed));
    expect(db.resources).toHaveLength(10);
    expect(db.resources.some((x) => x.name === 'Renamed Title')).toBe(true);
    expect(db.resources.some((x) => x.name === 'Title 0')).toBe(false);
  });

  it('a thrown error marks the run failed instead of crashing', async () => {
    const db = new FakeDb();
    db.from = () => {
      throw new Error('db down');
    };
    const r = await syncCourses(asDb(db), null, { ...base, fetchPage: async () => page(ITEMS) });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain('db down');
  });
});

describe('courseNames / courseHash', () => {
  it('suffixes the code only for shared titles', () => {
    const courses = parseCoursePage(
      page([
        { code: 'COMPSCI 590AB', title: 'Quantum Cryptography' },
        { code: 'COMPSCI 690BB', title: 'Quantum Cryptography' },
        { code: 'CICS 110', title: 'Foundations of Programming' },
      ]),
      () => {},
    );
    const names = courseNames(courses);
    expect(names.get('COMPSCI 590AB')).toBe('Quantum Cryptography (COMPSCI 590AB)');
    expect(names.get('COMPSCI 690BB')).toBe('Quantum Cryptography (COMPSCI 690BB)');
    expect(names.get('CICS 110')).toBe('Foundations of Programming');
  });

  it('hash changes with description or instructors, not with url', () => {
    const [a] = parseCoursePage(page([{ code: 'CICS 110', title: 'T', desc: 'one' }]), () => {});
    expect(courseHash(a)).toBe(courseHash({ ...a, url: 'https://elsewhere' }));
    expect(courseHash(a)).not.toBe(courseHash({ ...a, description: 'two' }));
    expect(courseHash(a)).not.toBe(courseHash({ ...a, instructors: ['Z'] }));
  });
});
