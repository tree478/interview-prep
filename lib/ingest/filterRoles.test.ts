import { describe, expect, it } from 'vitest';
import { FILTER_HEADROOM_MS, FILTER_TIMEOUT_ERROR, filterRoles } from './filterRoles';

const posts = [
  { title: 'Software Engineering Intern', location: null },
  { title: 'Software Engineer, New Grad', location: 'Boston' },
  { title: 'Senior Software Engineer', location: null },
];

describe('filterRoles', () => {
  it('uses the keyword classifier for an index Grok omits', async () => {
    const grok = async () =>
      ({ labels: [{ i: 0, role_type: 'other' }, { i: 2, role_type: 'other' }] }) as never;
    const r = await filterRoles(posts, { grok });
    expect(r.roleTypes).toEqual(['other', 'new_grad', 'other']);
    expect(r.usedFallback).toBe(false);
  });
  it('uses the keyword classifier for duplicated indexes', async () => {
    const grok = async () =>
      ({ labels: [{ i: 0, role_type: 'other' }, { i: 0, role_type: 'new_grad' }] }) as never;
    expect((await filterRoles([posts[0]], { grok })).roleTypes).toEqual(['internship']);
  });
  it('falls back to keywords for everything when Grok throws', async () => {
    const grok = async () => {
      throw new Error('down');
    };
    const r = await filterRoles(posts, { grok });
    expect(r.roleTypes).toEqual(['internship', 'new_grad', 'other']);
    expect(r.usedFallback).toBe(true);
    expect(r.errors).toEqual(['down']);
  });

  it('keyword-labels chunks that would start inside the safety margin', async () => {
    const chunks = 30;
    const posts = Array.from({ length: chunks * 100 }, () => ({
      title: 'Software Engineering Intern',
      location: null,
    }));
    let calls = 0;
    const grok = async (_schema: unknown, req: { user: string }) => {
      const rows = JSON.parse(req.user) as Record<string, unknown>[];
      expect(rows).toHaveLength(100);
      expect(rows.every((row) => Object.keys(row).sort().join() === 'i,location,title')).toBe(true);
      calls++;
      await new Promise((r) => setTimeout(r, 2_000));
      return { labels: rows.map((_, i) => ({ i, role_type: 'new_grad' as const })) } as never;
    };
    // A few seconds past the headroom: the first waves call Grok, the rest miss the window.
    const deadline = Date.now() + FILTER_HEADROOM_MS + 3_000;
    const started = Date.now();
    const r = await filterRoles(posts, { grok, deadline });
    expect(Date.now()).toBeLessThanOrEqual(deadline);
    expect(Date.now() - started).toBeLessThan(chunks * 2_000);
    expect(calls).toBeGreaterThanOrEqual(5);
    expect(calls).toBeLessThan(chunks);
    expect(r.usedFallback).toBe(true);
    expect(r.errors).toEqual([FILTER_TIMEOUT_ERROR]);
    expect(r.roleTypes.filter((t) => t === 'new_grad')).toHaveLength(calls * 100);
    expect(r.roleTypes.filter((t) => t === 'internship')).toHaveLength(chunks * 100 - calls * 100);
  }, 20_000);
});
