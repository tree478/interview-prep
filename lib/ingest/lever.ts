import { z } from 'zod';
import { MAX_DESCRIPTION_CHARS, htmlToText } from './html';
import type { CompanyRef, RawPosting } from './types';

const LeverResponse = z.array(
  z.looseObject({
    id: z.union([z.string(), z.number()]),
    text: z.string(),
    categories: z.looseObject({ location: z.string().nullish() }).nullish(),
    hostedUrl: z.string(),
    createdAt: z.number().nullish(),
    descriptionPlain: z.string().nullish(),
    lists: z.array(z.looseObject({ text: z.string().nullish(), content: z.string().nullish() })).nullish(),
    additionalPlain: z.string().nullish(),
  }),
);

/** Fetch all postings for one Lever company. Throws on a non-200 response or an unexpected body shape. */
export async function fetchLever(company: CompanyRef): Promise<RawPosting[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(company.slug)}?mode=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (res.status !== 200) {
    throw new Error(`Lever ${company.name} (${company.slug}): HTTP ${res.status}`);
  }
  const parsed = LeverResponse.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(`Lever ${company.name} (${company.slug}): unexpected response shape: ${parsed.error.message}`);
  }
  return parsed.data.map((p) => {
    const parts = [
      p.descriptionPlain?.trim(),
      ...(p.lists ?? []).map((l) => [l.text?.trim(), htmlToText(l.content)].filter(Boolean).join('\n')),
      p.additionalPlain?.trim(),
    ].filter((s): s is string => !!s);
    const created = p.createdAt != null ? new Date(p.createdAt) : null;
    return {
      source: 'lever' as const,
      external_id: String(p.id),
      company: company.name,
      title: p.text.trim(),
      location: p.categories?.location?.trim() || null,
      url: p.hostedUrl,
      description: parts.join('\n\n').replace(/\u0000/g, '').slice(0, MAX_DESCRIPTION_CHARS).trimEnd(),
      posted_at: created && !Number.isNaN(created.getTime()) ? created.toISOString() : null,
    };
  });
}
