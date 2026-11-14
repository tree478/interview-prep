import type { SupabaseClient } from '@supabase/supabase-js';
import type { RawPosting } from './types';

export interface ExistingKeys {
  ids: Set<string>; // `${source}:${external_id}`
  keys: Set<string>; // normalizeKey(title, company, location)
}

function norm(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeKey(title: string, company: string, location: string | null | undefined): string {
  return `${norm(title)}|${norm(company)}|${norm(location)}`;
}

export function idKey(source: string, externalId: string): string {
  return `${source}:${externalId}`;
}

/**
 * Drops postings whose source:external_id or normalized key is already known, including
 * duplicates inside this batch. No DB access. Each kept posting's id and key are ADDED to
 * `existing` (mutated) so successive calls, e.g. one per company, de-dupe against earlier ones.
 */
export function dedupe(
  postings: RawPosting[],
  existing: ExistingKeys,
): { fresh: RawPosting[]; duplicates: number } {
  const fresh: RawPosting[] = [];
  let duplicates = 0;
  for (const p of postings) {
    const id = idKey(p.source, p.external_id);
    const key = normalizeKey(p.title, p.company, p.location);
    if (existing.ids.has(id) || existing.keys.has(key)) {
      duplicates++;
      continue;
    }
    existing.ids.add(id);
    existing.keys.add(key);
    fresh.push(p);
  }
  return { fresh, duplicates };
}

const PAGE_SIZE = 1000;

/** Reads every job's identity from the DB, paginated (PostgREST caps each response). */
export async function loadExistingKeys(db: SupabaseClient): Promise<ExistingKeys> {
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from('jobs')
      .select('source, external_id, title, company, location')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`loadExistingKeys: ${error.message}`);
    for (const r of data ?? []) {
      ids.add(idKey(r.source, r.external_id));
      keys.add(normalizeKey(r.title, r.company, r.location));
    }
    if (!data || data.length < PAGE_SIZE) break;
  }
  return { ids, keys };
}
