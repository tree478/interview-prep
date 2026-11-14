// SERVER-ONLY (imports the Grok client). Grok sees only the fields in buildSelectionInput.
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  companyEngagementCountSchema,
  type CompanyEngagementCount,
  type CompanyRow,
} from '../types';
import { callGrokJSON } from './grok';

const DAY_MS = 86_400_000;
const MAX_PICKS = 10;
const STALE_DAYS = 3;

export interface SelectionInput {
  name: string;
  source: 'greenhouse' | 'lever';
  last_checked_at: string | null;
  days_since_checked: number | null;
  last_postings_found: number | null;
  saves: number;
  applications: number;
}

export interface SelectedCompany {
  companyId: string;
  company: string;
  reason: string;
  fallback: boolean;
}

/** Everything Grok sees: company names, sources, check dates, counts. No user data. */
export function buildSelectionInput(
  companies: CompanyRow[],
  counts: CompanyEngagementCount[],
  now: Date,
): SelectionInput[] {
  const byName = new Map(counts.map((c) => [c.company.toLowerCase(), c]));
  return companies.map((c) => {
    const e = byName.get(c.name.toLowerCase());
    return {
      name: c.name,
      source: c.source,
      last_checked_at: c.last_checked_at,
      days_since_checked: c.last_checked_at
        ? Math.floor((now.getTime() - new Date(c.last_checked_at).getTime()) / DAY_MS)
        : null,
      last_postings_found: c.last_postings_found,
      saves: e?.saves ?? 0,
      applications: e?.applications ?? 0,
    };
  });
}

// Strict json_schema needs an object root, so the picks are wrapped.
const picksSchema = z.object({
  picks: z.array(z.object({ company: z.string(), reason: z.string().min(1).max(300) })).max(MAX_PICKS),
});

const SYSTEM =
  'You choose which employers a job-posting scraper should check next. ' +
  `Pick up to ${MAX_PICKS} companies from the provided list only. Favor companies not checked ` +
  'recently, companies whose last check found many postings, and companies students save or apply to. ' +
  'Give each a short reason. Use the exact company names from the list.';

function staleOrder(a: CompanyRow, b: CompanyRow): number {
  if (!a.last_checked_at && !b.last_checked_at) return a.name.localeCompare(b.name);
  if (!a.last_checked_at) return -1;
  if (!b.last_checked_at) return 1;
  return new Date(a.last_checked_at).getTime() - new Date(b.last_checked_at).getTime();
}

export async function selectCompanies(
  db: SupabaseClient,
  opts: { now?: Date; grok?: typeof callGrokJSON } = {},
): Promise<{ selected: SelectedCompany[]; errors: string[] }> {
  const now = opts.now ?? new Date();
  const grok = opts.grok ?? callGrokJSON;
  const errors: string[] = [];

  const { data: rows, error: cErr } = await db
    .from('companies')
    .select('id, name, source, slug, active, last_checked_at, last_postings_found')
    .eq('active', true);
  if (cErr) return { selected: [], errors: [`companies query failed: ${cErr.message}`] };
  const companies = (rows ?? []) as CompanyRow[];

  let counts: CompanyEngagementCount[] = [];
  const rpc = await db.rpc('company_engagement_counts');
  if (rpc.error) {
    errors.push(`company_engagement_counts failed, using zero counts: ${rpc.error.message}`);
  } else {
    const parsed = companyEngagementCountSchema.array().safeParse(rpc.data ?? []);
    if (parsed.success) counts = parsed.data;
    else errors.push('company_engagement_counts returned unexpected rows, using zero counts');
  }

  const byName = new Map(companies.map((c) => [c.name.toLowerCase(), c]));
  const selected: SelectedCompany[] = [];
  const chosen = new Set<string>();

  try {
    const res = await grok(picksSchema, {
      system: SYSTEM,
      user: JSON.stringify(buildSelectionInput(companies, counts, now)),
      name: 'company_picks',
    });
    const unknown: string[] = [];
    for (const p of res.picks) {
      const c = byName.get(p.company.trim().toLowerCase());
      if (!c) unknown.push(p.company);
      else if (!chosen.has(c.id)) {
        chosen.add(c.id);
        selected.push({ companyId: c.id, company: c.name, reason: p.reason, fallback: false });
      }
    }
    if (unknown.length) errors.push(`Grok named unknown companies (dropped): ${unknown.join(', ')}`);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  if (selected.length === 0) {
    for (const c of [...companies].sort(staleOrder).slice(0, MAX_PICKS)) {
      chosen.add(c.id);
      selected.push({
        companyId: c.id,
        company: c.name,
        reason: 'Fallback: least recently checked',
        fallback: true,
      });
    }
  }

  const cutoff = now.getTime() - STALE_DAYS * DAY_MS;
  for (const c of companies) {
    if (chosen.has(c.id)) continue;
    if (!c.last_checked_at || new Date(c.last_checked_at).getTime() < cutoff) {
      chosen.add(c.id);
      selected.push({
        companyId: c.id,
        company: c.name,
        reason: 'Rule: not checked in 3+ days',
        fallback: false,
      });
    }
  }

  return { selected, errors };
}
