import { describe, expect, it } from 'vitest';
import { GrokError } from './grok';
import { buildSelectionInput, selectCompanies } from './selectCompanies';
import type { CompanyRow } from '../types';

const NOW = new Date('2026-11-14T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function co(i: number, last: string | null): CompanyRow {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name: `Co${i}`,
    source: 'greenhouse',
    slug: `co${i}`,
    active: true,
    last_checked_at: last,
    last_postings_found: 5,
  };
}

function fakeDb(companies: CompanyRow[], rpcResult: { data: unknown; error: { message: string } | null }) {
  return {
    from: () => ({ select: () => ({ eq: async () => ({ data: companies, error: null }) }) }),
    rpc: async () => rpcResult,
  } as never;
}
const okRpc = { data: [{ company: 'Co1', saves: 2, applications: 1 }], error: null };

describe('buildSelectionInput (privacy)', () => {
  it('exposes only the allowed keys', () => {
    const out = buildSelectionInput([co(1, daysAgo(2))], [{ company: 'Co1', saves: 2, applications: 1 }], NOW);
    expect(Object.keys(out[0]).sort()).toEqual(
      ['applications', 'days_since_checked', 'last_checked_at', 'last_postings_found', 'name', 'saves', 'source'].sort(),
    );
    expect(out[0].days_since_checked).toBe(2);
    expect(out[0].saves).toBe(2);
  });
  it('uses null days for never-checked companies', () => {
    expect(buildSelectionInput([co(1, null)], [], NOW)[0].days_since_checked).toBeNull();
  });
});

describe('selectCompanies', () => {
  const companies = [co(1, daysAgo(1)), co(2, daysAgo(1)), co(3, daysAgo(10)), co(4, null)];

  it('keeps Grok picks and force-adds stale companies', async () => {
    const grok = async () => ({ picks: [{ company: 'co1', reason: 'popular' }] }) as never;
    const r = await selectCompanies(fakeDb(companies, okRpc), { now: NOW, grok });
    expect(r.selected.map((s) => [s.company, s.reason, s.fallback])).toEqual([
      ['Co1', 'popular', false],
      ['Co3', 'Rule: not checked in 3+ days', false],
      ['Co4', 'Rule: not checked in 3+ days', false],
    ]);
  });
  it('drops unknown names and records an error', async () => {
    const grok = async () =>
      ({ picks: [{ company: 'Nope', reason: 'x' }, { company: 'Co2', reason: 'y' }] }) as never;
    const r = await selectCompanies(fakeDb(companies, okRpc), { now: NOW, grok });
    expect(r.selected.map((s) => s.company)).toContain('Co2');
    expect(r.selected.map((s) => s.company)).not.toContain('Nope');
    expect(r.errors.join()).toContain('Nope');
  });
  it('falls back to the 10 least recently checked when Grok throws', async () => {
    const many = Array.from({ length: 14 }, (_, i) => co(i + 1, daysAgo(i === 0 ? 0 : i)));
    const grok = async () => {
      throw new GrokError('XAI_API_KEY not set');
    };
    const r = await selectCompanies(fakeDb(many, okRpc), { now: NOW, grok });
    const fb = r.selected.filter((s) => s.fallback);
    expect(fb).toHaveLength(10);
    expect(fb[0].company).toBe('Co14'); // oldest first
    expect(fb.every((s) => s.reason === 'Fallback: least recently checked')).toBe(true);
    expect(r.errors).toContain('XAI_API_KEY not set');
  });
  it('still works when the RPC errors', async () => {
    const grok = async () => ({ picks: [{ company: 'Co1', reason: 'r' }] }) as never;
    const r = await selectCompanies(fakeDb(companies, { data: null, error: { message: 'no rpc' } }), {
      now: NOW,
      grok,
    });
    expect(r.selected[0].company).toBe('Co1');
    expect(r.errors.some((e) => e.includes('no rpc'))).toBe(true);
  });
});
