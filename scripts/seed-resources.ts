// Upserts data/umass_resources.json into umass_resources (onConflict type,name; active = true).
// Courses are only written when the table has no course rows (so older exported courses never
// overwrite fresh synced ones); labs are always written. Service-role key from .env.local, never printed.
// Usage: npx tsx scripts/seed-resources.ts [--labs-only] [--check]
//   --labs-only  never write courses
//   --check      also verify every lab url, source_url and faculty profile_url returns HTTP 200
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { createAdminClient } from '../lib/ingest/admin';

const SKILLS = new Set(
  (JSON.parse(readFileSync(join(process.cwd(), 'data/skills.json'), 'utf8')) as { canonical_name: string }[]).map(
    (s) => s.canonical_name,
  ),
);

const facultySchema = z.object({ name: z.string().min(1), profile_url: z.string().min(1) });
const entrySchema = z
  .object({
    type: z.enum(['course', 'lab']),
    name: z.string().min(1),
    url: z.string().min(1),
    skills: z.array(z.string()).default([]),
    description: z.string().nullish(),
    meta: z.record(z.string(), z.unknown()).default({}),
    source_url: z.string().nullish(),
  })
  .superRefine((e, ctx) => {
    for (const s of e.skills) {
      if (!SKILLS.has(s)) ctx.addIssue({ code: 'custom', message: `${e.name}: skill "${s}" is not in data/skills.json` });
    }
    if (e.type === 'lab') {
      const f = z.array(facultySchema).min(1).safeParse(e.meta.faculty);
      if (!f.success) ctx.addIssue({ code: 'custom', message: `${e.name}: lab needs meta.faculty with >= 1 { name, profile_url }` });
    }
  });
type Entry = z.infer<typeof entrySchema>;

async function checkUrls(labs: Entry[]): Promise<boolean> {
  const urls = new Set<string>();
  for (const l of labs) {
    urls.add(l.url);
    if (l.source_url) urls.add(l.source_url);
    for (const f of l.meta.faculty as { profile_url: string }[]) urls.add(f.profile_url);
  }
  let bad = 0;
  for (const u of urls) {
    let status: string | number;
    try {
      const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20_000) });
      status = res.status;
    } catch (e) {
      status = e instanceof Error ? e.message : 'error';
    }
    if (status !== 200) bad++;
    console.log(`${status} ${u}`);
  }
  console.log(bad ? `${bad} URL(s) did not return 200` : `all ${urls.size} URLs returned 200`);
  return bad === 0;
}

async function main() {
  const labsOnly = process.argv.includes('--labs-only');
  const check = process.argv.includes('--check');
  const parsed = z.array(entrySchema).safeParse(JSON.parse(readFileSync(join(process.cwd(), 'data/umass_resources.json'), 'utf8')));
  if (!parsed.success) {
    console.error('data/umass_resources.json is invalid:');
    for (const i of parsed.error.issues) console.error(`  - ${i.path.join('.')}: ${i.message}`);
    process.exit(1);
  }
  const all = parsed.data;
  const labs = all.filter((e) => e.type === 'lab');
  console.log(`file ok: ${all.length - labs.length} courses, ${labs.length} labs`);

  if (check && !(await checkUrls(labs))) process.exit(1);

  process.loadEnvFile('.env.local');
  const db = createAdminClient();
  const { count, error: cErr } = await db
    .from('umass_resources')
    .select('id', { count: 'exact', head: true })
    .eq('type', 'course');
  if (cErr) {
    console.error(`Could not read umass_resources: ${cErr.message}`);
    process.exit(1);
  }
  const hasCourses = (count ?? 0) > 0;
  const writeCourses = !labsOnly && !hasCourses;
  const toWrite = writeCourses ? all : labs;
  if (!writeCourses) console.log(`skipping courses (${labsOnly ? '--labs-only' : `${count} already in the DB`})`);

  const payload = toWrite.map((e) => ({
    type: e.type,
    name: e.name,
    url: e.url,
    skills: e.skills,
    description: e.description ?? null,
    meta: e.meta,
    source_url: e.source_url ?? null,
    active: true,
  }));
  for (let i = 0; i < payload.length; i += 50) {
    const { error } = await db.from('umass_resources').upsert(payload.slice(i, i + 50), { onConflict: 'type,name' });
    if (error) {
      console.error(`Upsert failed: ${error.message}`);
      process.exit(1);
    }
  }
  console.log(`upserted ${payload.filter((p) => p.type === 'course').length} courses, ${payload.filter((p) => p.type === 'lab').length} labs`);
}

main().catch((e) => {
  console.error('seed-resources failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
