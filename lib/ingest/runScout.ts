// SERVER-ONLY. The Scout Bot pipeline (JOB-3, JOB-3a, JOB-4, MATCH-1a).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RoleType } from '../types';
import { dedupe, loadExistingKeys } from './dedupe';
import { extractPending, type Extractor } from './extract';
import type { SelectedCompany } from './selectCompanies';
import type { CompanyRef, RawPosting } from './types';

export interface ScoutDeps {
  db: SupabaseClient;
  selectCompanies: (db: SupabaseClient) => Promise<{ selected: SelectedCompany[]; errors: string[] }>;
  fetchers: {
    greenhouse: (c: CompanyRef) => Promise<RawPosting[]>;
    lever: (c: CompanyRef) => Promise<RawPosting[]>;
  };
  filterRoles: (
    postings: { title: string; location: string | null }[],
  ) => Promise<{ roleTypes: RoleType[]; usedFallback: boolean; errors: string[] }>;
  extractor: Extractor | null;
  now: () => Date;
  /** ms between company fetches; defaults to 300 */
  delayMs?: number;
}

const CHUNK = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runScout(runId: string, deps: ScoutDeps): Promise<void> {
  const { db } = deps;
  const errors: string[] = [];
  let selected: SelectedCompany[] = [];
  let companiesChecked = 0;
  let jobsAdded = 0;
  let jobsExtracted = 0;

  try {
    const sel = await deps.selectCompanies(db);
    selected = sel.selected;
    errors.push(...sel.errors);

    const { data: rows } = await db.from('companies').select('id, name, source, slug').in(
      'id',
      selected.map((s) => s.companyId),
    );
    const refs = new Map((rows ?? []).map((r) => [r.id as string, r as CompanyRef & { id: string }]));

    const fetched: RawPosting[] = [];
    const okCompanies: { id: string; count: number }[] = [];
    for (const [i, s] of selected.entries()) {
      if (i > 0) await sleep(deps.delayMs ?? 300);
      const ref = refs.get(s.companyId);
      if (!ref) {
        errors.push(`${s.company}: company row not found`);
        continue;
      }
      try {
        const postings = await deps.fetchers[ref.source](ref);
        fetched.push(...postings);
        okCompanies.push({ id: ref.id, count: postings.length });
        companiesChecked++;
      } catch (e) {
        errors.push(`${s.company}: ${msg(e)}`);
      }
    }

    const roles = await deps.filterRoles(fetched.map((p) => ({ title: p.title, location: p.location })));
    errors.push(...roles.errors);
    const kept: { p: RawPosting; role: RoleType }[] = [];
    fetched.forEach((p, i) => {
      const role = roles.roleTypes[i];
      if (role === 'internship' || role === 'new_grad') kept.push({ p, role });
    });

    const existing = await loadExistingKeys(db);
    const roleOf = new Map(kept.map((k) => [k.p, k.role]));
    const { fresh } = dedupe(kept.map((k) => k.p), existing);
    for (let i = 0; i < fresh.length; i += CHUNK) {
      const chunk = fresh.slice(i, i + CHUNK).map((p) => ({
        source: p.source,
        external_id: p.external_id,
        company: p.company,
        title: p.title,
        location: p.location,
        url: p.url,
        description: p.description,
        posted_at: p.posted_at,
        role_type: roleOf.get(p),
        ingested_by_run_id: runId,
        extraction_status: 'pending',
      }));
      const { data, error } = await db
        .from('jobs')
        .upsert(chunk, { onConflict: 'source,external_id', ignoreDuplicates: true })
        .select('id');
      if (error) throw new Error(`insert jobs: ${error.message}`);
      jobsAdded += data?.length ?? 0;
    }

    const ex = await extractPending(db, runId, { extractor: deps.extractor, limit: 40, batchSize: 5 });
    jobsExtracted = ex.extracted;
    errors.push(...ex.errors);

    const stamp = deps.now().toISOString();
    for (const c of okCompanies) {
      const { error } = await db
        .from('companies')
        .update({ last_checked_at: stamp, last_postings_found: c.count })
        .eq('id', c.id);
      if (error) errors.push(`update company ${c.id}: ${error.message}`);
    }

    await finish('done');
  } catch (e) {
    errors.push(`Run failed: ${msg(e)}`);
    await finish('failed');
  }

  async function finish(status: 'done' | 'failed') {
    try {
      const { error } = await db
        .from('bot_runs')
        .update({
          status,
          finished_at: deps.now().toISOString(),
          companies_selected: selected.map((s) => ({
            company: s.company,
            reason: s.reason,
            fallback: s.fallback,
          })),
          companies_checked: companiesChecked,
          jobs_added: jobsAdded,
          jobs_extracted: jobsExtracted,
          errors,
        })
        .eq('id', runId);
      if (error) console.error(`bot_runs update failed: ${error.message}`);
    } catch (e) {
      console.error(`bot_runs update threw: ${msg(e)}`);
    }
  }
}
