import { z } from 'zod';
import { decodeEntities, htmlToText } from './html';
import type { CompanyRef, RawPosting } from './types';

const GreenhouseResponse = z.looseObject({
  jobs: z.array(
    z.looseObject({
      id: z.union([z.number(), z.string()]),
      title: z.string(),
      location: z.looseObject({ name: z.string().nullish() }).nullish(),
      absolute_url: z.string(),
      updated_at: z.string().nullish(),
      first_published: z.string().nullish(),
      content: z.string().nullish(),
    }),
  ),
});

function toIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = new Date(s);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/** Fetch all postings for one Greenhouse board. Throws on a non-200 response or an unexpected body shape. */
export async function fetchGreenhouse(company: CompanyRef): Promise<RawPosting[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(company.slug)}/jobs?content=true`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (res.status !== 200) {
    throw new Error(`Greenhouse ${company.name} (${company.slug}): HTTP ${res.status}`);
  }
  const parsed = GreenhouseResponse.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(`Greenhouse ${company.name} (${company.slug}): unexpected response shape: ${parsed.error.message}`);
  }
  return parsed.data.jobs.map((j) => ({
    source: 'greenhouse' as const,
    external_id: String(j.id),
    company: company.name,
    title: j.title.trim(),
    location: j.location?.name?.trim() || null,
    url: j.absolute_url,
    // content is HTML-escaped: decode entities first, then strip tags
    description: htmlToText(decodeEntities(j.content ?? '')),
    posted_at: toIso(j.first_published) ?? toIso(j.updated_at),
  }));
}
