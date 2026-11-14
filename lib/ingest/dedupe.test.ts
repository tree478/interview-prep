import { describe, expect, it } from 'vitest';
import { dedupe, loadExistingKeys, normalizeKey, type ExistingKeys } from './dedupe';
import type { RawPosting } from './types';

function post(over: Partial<RawPosting>): RawPosting {
  return {
    source: 'greenhouse',
    external_id: '1',
    company: 'Acme',
    title: 'Software Engineer Intern',
    location: 'Boston, MA',
    url: 'https://example.com/1',
    description: '',
    posted_at: null,
    ...over,
  };
}

const empty = (): ExistingKeys => ({ ids: new Set(), keys: new Set() });

describe('normalizeKey', () => {
  it('ignores case and punctuation', () => {
    expect(normalizeKey('Software Engineer, Intern', 'Acme', 'Boston, MA')).toBe(
      normalizeKey('software engineer intern', 'ACME', 'boston  ma'),
    );
  });
  it('handles a null location', () => {
    expect(normalizeKey('Intern', 'Acme', null)).toBe('intern|acme|');
  });
});

describe('dedupe', () => {
  it('drops an existing source+id', () => {
    const existing = empty();
    existing.ids.add('greenhouse:1');
    const r = dedupe([post({ title: 'Different title' })], existing);
    expect(r).toEqual({ fresh: [], duplicates: 1 });
  });
  it('drops the same title/company/location under a new id', () => {
    const existing = empty();
    existing.keys.add(normalizeKey('Software Engineer Intern', 'Acme', 'Boston, MA'));
    const r = dedupe([post({ external_id: '99', title: 'Software Engineer, Intern' })], existing);
    expect(r.fresh).toHaveLength(0);
    expect(r.duplicates).toBe(1);
  });
  it('drops duplicates inside one batch', () => {
    const r = dedupe([post({ external_id: '1' }), post({ external_id: '2' }), post({ external_id: '1', title: 'X' })], empty());
    expect(r.fresh.map((p) => p.external_id)).toEqual(['1']);
    expect(r.duplicates).toBe(2);
  });
  it('keeps the same title in a different location', () => {
    const r = dedupe([post({ external_id: '1' }), post({ external_id: '2', location: 'Remote' })], empty());
    expect(r.fresh).toHaveLength(2);
    expect(r.duplicates).toBe(0);
  });
  it('remembers kept postings across calls', () => {
    const existing = empty();
    expect(dedupe([post({})], existing).fresh).toHaveLength(1);
    expect(dedupe([post({})], existing).duplicates).toBe(1);
  });
});

describe('loadExistingKeys', () => {
  it('pages through all rows', async () => {
    const total = 2500;
    const rows = Array.from({ length: total }, (_, i) => ({
      source: 'lever',
      external_id: `id${i}`,
      title: `Role ${i}`,
      company: 'Acme',
      location: i % 2 ? null : 'Boston',
    }));
    const ranges: Array<[number, number]> = [];
    const db = {
      from: () => ({
        select: () => ({
          order: () => ({
            range: async (a: number, b: number) => {
              ranges.push([a, b]);
              return { data: rows.slice(a, b + 1), error: null };
            },
          }),
        }),
      }),
    };
    const existing = await loadExistingKeys(db as never);
    expect(existing.ids.size).toBe(total);
    expect(existing.keys.size).toBe(total);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
});
