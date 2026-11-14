import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGreenhouse } from './greenhouse';
import { fetchLever } from './lever';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchGreenhouse', () => {
  const company = { id: 'c1', name: 'Acme', source: 'greenhouse' as const, slug: 'acme' };

  it('maps jobs to RawPosting and decodes escaped content', async () => {
    const fn = mockFetch(200, {
      jobs: [
        {
          id: 12345,
          title: ' Software Engineer Intern ',
          location: { name: 'Boston, MA' },
          absolute_url: 'https://boards.greenhouse.io/acme/jobs/12345',
          updated_at: '2026-10-01T12:00:00-04:00',
          first_published: '2026-09-01T12:00:00Z',
          content: '&lt;p&gt;Build &lt;b&gt;things&lt;/b&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;/ul&gt;',
          extra_field: true,
        },
        { id: 2, title: 'No location', absolute_url: 'https://x/2', updated_at: '2026-10-01T00:00:00Z' },
      ],
    });
    const out = await fetchGreenhouse(company);
    expect(fn).toHaveBeenCalledOnce();
    expect(String((fn.mock.calls[0] as unknown[])[0])).toBe(
      'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true',
    );
    expect(out[0]).toEqual({
      source: 'greenhouse',
      external_id: '12345',
      company: 'Acme',
      company_id: 'c1',
      title: 'Software Engineer Intern',
      location: 'Boston, MA',
      url: 'https://boards.greenhouse.io/acme/jobs/12345',
      description: 'Build things\n- Python',
      posted_at: '2026-09-01T12:00:00.000Z',
    });
    expect(out[1].location).toBeNull();
    expect(out[1].posted_at).toBe('2026-10-01T00:00:00.000Z'); // falls back to updated_at
    expect(out[1].description).toBe('');
  });

  it('throws with company and status on non-200', async () => {
    mockFetch(404, {});
    await expect(fetchGreenhouse(company)).rejects.toThrow(/Acme.*404/);
  });

  it('throws on a wrong body shape', async () => {
    mockFetch(200, { postings: [] });
    await expect(fetchGreenhouse(company)).rejects.toThrow(/Acme.*unexpected response shape/);
  });
});

describe('fetchLever', () => {
  const company = { name: 'Beta', source: 'lever' as const, slug: 'beta' };

  it('maps postings and assembles the description', async () => {
    const created = Date.UTC(2026, 8, 1, 12, 0, 0);
    mockFetch(200, [
      {
        id: 'abc-123',
        text: 'Data Science Co-op',
        categories: { location: 'Remote' },
        hostedUrl: 'https://jobs.lever.co/beta/abc-123',
        createdAt: created,
        descriptionPlain: 'Intro paragraph.',
        lists: [{ text: 'You will', content: '<li>Analyze data</li><li>Write SQL</li>' }],
        additionalPlain: 'Equal opportunity employer.',
      },
      { id: 'no-cat', text: 'Intern', hostedUrl: 'https://jobs.lever.co/beta/no-cat' },
    ]);
    const out = await fetchLever(company);
    expect(out[0]).toEqual({
      source: 'lever',
      external_id: 'abc-123',
      company: 'Beta',
      title: 'Data Science Co-op',
      location: 'Remote',
      url: 'https://jobs.lever.co/beta/abc-123',
      description: 'Intro paragraph.\n\nYou will\n- Analyze data\n- Write SQL\n\nEqual opportunity employer.',
      posted_at: new Date(created).toISOString(),
    });
    expect(out[1].location).toBeNull();
    expect(out[1].posted_at).toBeNull();
    expect(out[1].description).toBe('');
  });

  it('throws with company and status on non-200', async () => {
    mockFetch(500, {});
    await expect(fetchLever(company)).rejects.toThrow(/Beta.*500/);
  });

  it('throws on a wrong body shape', async () => {
    mockFetch(200, { error: 'nope' });
    await expect(fetchLever(company)).rejects.toThrow(/Beta.*unexpected response shape/);
  });
});
