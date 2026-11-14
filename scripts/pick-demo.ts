// Scores a résumé PDF (kept outside the repo) against extracted internship and new-grad
// jobs and proposes the demo posting, one hard-mismatch posting, and one N/A posting.
// No database writes. Résumé text goes only to Gemini via parseResume, never to Grok,
// and is never printed. Service-role key is never printed.
// Usage: npx tsx scripts/pick-demo.ts --resume <path-to-pdf>
//          [--needs-sponsorship] [--year <grad year text>] [--locations "A;B"]
import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '../lib/ingest/admin';
import { selectGaps, type GapResourceRow } from '../lib/gaps/select';
import { scoreMatch, type ScoreMatchInput } from '../lib/match/score';
import { canonicalize } from '../lib/match/skills';
import { extractTextFromPdf, parseResume } from '../lib/resume/parse';
import { buildAtsReport } from '../lib/resume/sections';
import { postingExtractionSchema, type MatchResult, type PostingExtraction } from '../lib/types';

const PRIORITY_LAB_SKILLS = [
  'Machine learning',
  'Statistics',
  'Distributed systems',
  'Natural language processing',
  'Large language models',
] as const;

const priorityLabSkills = new Set<string>(PRIORITY_LAB_SKILLS);

type JobRow = {
  id: string;
  company: string;
  title: string;
  location: string | null;
  url: string;
  role_type: string | null;
  extracted_json: unknown;
};

type Scored = {
  job: JobRow;
  posting: PostingExtraction;
  match: MatchResult;
  gaps: GapView[];
  wellKnown: boolean;
};

type GapView = {
  skill: string;
  courses: string[];
  labs: { name: string; faculty: string[] }[];
};

function safe(text: string): string {
  let out = text.replace(/([?&]key=)[^&\s"']+/gi, '$1[redacted]');
  for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY', 'INGEST_KEY', 'CRON_SECRET']) {
    const secret = process.env[name]?.trim();
    if (secret) out = out.split(secret).join('[redacted]');
  }
  const resumeAt = out.indexOf('Résumé:');
  if (resumeAt >= 0) out = `${out.slice(0, resumeAt)}[résumé omitted]`;
  return out.replace(/\s+/g, ' ').slice(0, 240);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  if (!value || value.startsWith('--')) {
    console.error(`${name} needs a value`);
    process.exit(1);
  }
  return value;
}

function parseArgs(): {
  resumePath: string;
  needsSponsorship: boolean;
  year: string | undefined;
  locations: string[];
} {
  const resumePath = arg('--resume');
  if (!resumePath) {
    console.error('Usage: npx tsx scripts/pick-demo.ts --resume <path-to-pdf> [--needs-sponsorship] [--year <text>] [--locations "A;B"]');
    process.exit(1);
  }
  const year = arg('--year');
  const locationsArg = arg('--locations');
  const known = new Set(['--resume', '--needs-sponsorship', '--year', '--locations']);
  for (let i = 2; i < process.argv.length; i++) {
    const token = process.argv[i]!;
    if (token === '--needs-sponsorship') continue;
    if (known.has(token)) {
      i += 1;
      continue;
    }
    console.error(`Unknown argument ${token}`);
    process.exit(1);
  }
  const locations = locationsArg
    ? locationsArg.split(';').map((place) => place.trim()).filter((place) => place !== '')
    : [];
  return {
    resumePath,
    needsSponsorship: process.argv.includes('--needs-sponsorship'),
    year,
    locations,
  };
}

function resumeBytes(flagPath: string): Uint8Array {
  const repo = realpathSync(process.cwd());
  let resolved: string;
  try {
    resolved = realpathSync(path.resolve(flagPath));
  } catch {
    console.error('Résumé PDF not found');
    process.exit(1);
  }
  const rel = path.relative(repo, resolved);
  const inside = rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
  if (inside) {
    console.error('Refusing to read a résumé inside the repo. Pass a PDF outside this directory.');
    process.exit(1);
  }
  const info = statSync(resolved);
  if (!info.isFile() || !resolved.toLowerCase().endsWith('.pdf')) {
    console.error('Résumé path must be a PDF file outside the repo');
    process.exit(1);
  }
  return new Uint8Array(readFileSync(resolved));
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

// Same row shape as app/api/gaps/route.ts resourceRow, so selectGaps sees what the route sees.
function resourceRow(value: unknown): GapResourceRow | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const { id, type, name, url, active } = row;
  if (typeof id !== 'string' || typeof name !== 'string' || typeof url !== 'string') return null;
  if (type !== 'course' && type !== 'lab') return null;
  if (active !== true) return null;
  const description = row.description;
  return {
    id,
    type,
    name,
    url,
    description: typeof description === 'string' ? description : null,
    skills: stringList(row.skills),
    meta: record(row.meta),
    active,
  };
}

function wellKnownNames(): Set<string> {
  const raw: unknown = JSON.parse(readFileSync('data/companies.json', 'utf8'));
  const names = new Set<string>();
  if (!Array.isArray(raw)) return names;
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const name = (entry as { name?: unknown }).name;
    if (typeof name === 'string' && name.trim()) names.add(name.trim().toLowerCase());
  }
  return names;
}

function gapViews(match: MatchResult, resources: GapResourceRow[]): GapView[] {
  return selectGaps({
    missingSkills: match.missing,
    preferredMissing: match.preferredMissing,
    resources,
  }).map((gap) => ({
    skill: gap.skill,
    courses: gap.resources
      .filter((resource) => resource.type === 'course')
      .map((resource) => (resource.code ? `${resource.code} ${resource.name}` : resource.name)),
    labs: gap.resources
      .filter((resource) => resource.type === 'lab')
      .map((resource) => ({
        name: resource.name,
        faculty: (resource.faculty ?? []).map((person) => person.name),
      })),
  }));
}

function hasCourseOrLab(gap: GapView): boolean {
  return gap.courses.length > 0 || gap.labs.length > 0;
}

function priorityLabCount(gaps: GapView[]): number {
  return gaps.filter(
    (gap) =>
      priorityLabSkills.has(gap.skill) && gap.labs.some((lab) => lab.faculty.length > 0),
  ).length;
}

async function loadJobs(db: SupabaseClient): Promise<JobRow[]> {
  const pageSize = 500;
  const rows: JobRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from('jobs')
      .select('id, company, title, location, url, role_type, extracted_json')
      .eq('extraction_status', 'done')
      .in('role_type', ['internship', 'new_grad'])
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`load jobs: ${safe(error.message)}`);
    const batch = (data ?? []) as JobRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

async function loadResources(db: SupabaseClient): Promise<GapResourceRow[]> {
  const pageSize = 1000;
  const resources: GapResourceRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from('umass_resources')
      .select('id, type, name, url, description, skills, meta, active')
      .eq('active', true)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`load resources: ${safe(error.message)}`);
    const batch = data ?? [];
    for (const row of batch) {
      const resource = resourceRow(row);
      if (resource) resources.push(resource);
    }
    if (batch.length < pageSize) break;
  }
  return resources;
}

function printJob(index: number, item: Scored): void {
  const score = item.match.score == null ? 'N/A' : `${item.match.score}%`;
  console.log(
    `${index}. ${score}  ${item.job.company} — ${item.job.title}${item.wellKnown ? '  [well-known]' : ''}`,
  );
  console.log(`   id: ${item.job.id}`);
  console.log(`   url: ${item.job.url}`);
  console.log(`   role: ${item.job.role_type ?? 'unknown'}  location: ${item.job.location ?? 'unknown'}`);
  console.log(`   covered: ${item.match.covered.join(', ') || '(none)'}`);
  console.log(`   missing: ${item.match.missing.join(', ') || '(none)'}`);
  console.log(`   preferred missing: ${item.match.preferredMissing.join(', ') || '(none)'}`);
  if (item.match.hardMismatch) console.log(`   hard mismatch: ${item.match.hardMismatch}`);
  if (item.gaps.length === 0) {
    console.log('   resources: (no missing skills)');
    return;
  }
  for (const gap of item.gaps) {
    const courses = gap.courses.length > 0 ? gap.courses.join('; ') : '(no course)';
    const labs =
      gap.labs.length > 0
        ? gap.labs
            .map((lab) =>
              lab.faculty.length > 0 ? `${lab.name} (faculty: ${lab.faculty.join(', ')})` : lab.name,
            )
            .join('; ')
        : '(no lab)';
    console.log(`   ${gap.skill}: course ${courses} | lab ${labs}`);
  }
}

function compareDemo(a: Scored, b: Scored): number {
  const labs = priorityLabCount(b.gaps) - priorityLabCount(a.gaps);
  if (labs !== 0) return labs;
  if (a.wellKnown !== b.wellKnown) return a.wellKnown ? -1 : 1;
  const distA = Math.abs((a.match.score ?? 0) - 80);
  const distB = Math.abs((b.match.score ?? 0) - 80);
  if (distA !== distB) return distA - distB;
  return a.job.company.localeCompare(b.job.company) || a.job.id.localeCompare(b.job.id);
}

function isDemoCandidate(item: Scored): boolean {
  const score = item.match.score;
  if (score == null || score < 75 || score > 85) return false;
  if (item.match.hardMismatch) return false;
  if (item.gaps.length === 0) return false;
  return item.gaps.every(hasCourseOrLab);
}

function compareHard(a: Scored, b: Scored): number {
  if (a.wellKnown !== b.wellKnown) return a.wellKnown ? -1 : 1;
  return a.job.company.localeCompare(b.job.company) || a.job.id.localeCompare(b.job.id);
}

function compareNa(a: Scored, b: Scored): number {
  const hardA = a.match.hardMismatch != null;
  const hardB = b.match.hardMismatch != null;
  if (hardA !== hardB) return hardA ? 1 : -1;
  return compareHard(a, b);
}

function hasGraduationWindow(posting: PostingExtraction): boolean {
  const graduation = posting.graduation;
  if (!graduation) return false;
  return graduation.startYear != null || graduation.endYear != null;
}

async function main(): Promise<void> {
  const flags = parseArgs();
  process.loadEnvFile('.env.local');
  const missing = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GEMINI_API_KEY', 'GEMINI_MODEL'].filter(
    (name) => !process.env[name]?.trim(),
  );
  if (missing.length > 0) {
    console.error(`Missing ${missing.join(', ')} in .env.local`);
    process.exit(1);
  }

  const bytes = resumeBytes(flags.resumePath);
  console.log('Résumé PDF is outside the repo.');
  let rawText: string;
  try {
    rawText = await extractTextFromPdf(bytes);
  } catch (err: unknown) {
    console.error(`Could not read the PDF: ${safe(err instanceof Error ? err.message : 'read failed')}`);
    process.exit(1);
  }
  if (rawText.trim() === '') {
    console.error('Could not read text from this PDF');
    process.exit(1);
  }

  let parsed;
  try {
    parsed = await parseResume(rawText);
  } catch (err: unknown) {
    console.error(`Could not parse the résumé: ${safe(err instanceof Error ? err.message : 'parse failed')}`);
    process.exit(1);
  }
  const ats = buildAtsReport(rawText);

  const studentSkills = [
    ...parsed.skills,
    ...parsed.experiences.flatMap((experience) => experience.skills),
  ];
  const year = flags.year === undefined ? parsed.academics.year : flags.year;
  const profile: Omit<ScoreMatchInput, 'posting' | 'jobLocation'> = {
    studentSkills,
    year,
    majors: parsed.academics.majors,
    needsSponsorship: flags.needsSponsorship,
    openToRelocation: false,
    preferredLocations: flags.locations,
    minPay: null,
  };

  console.log('Parsed résumé summary');
  console.log(`  year: ${parsed.academics.year ?? '(none)'}`);
  console.log(`  majors: ${parsed.academics.majors.join(', ') || '(none)'}`);
  console.log(`  experiences: ${parsed.experiences.length}`);
  console.log(`  skills: ${parsed.skills.length}`);
  console.log(`  missing sections: ${ats.missingSections.join(', ') || '(none)'}`);
  console.log('Profile settings passed to scoreMatch (schema defaults unless a flag overrides them)');
  console.log(`  year: ${profile.year ?? '(none)'}${flags.year === undefined ? '' : '  (--year)'}`);
  console.log(`  majors: ${profile.majors.join(', ') || '(none)'}`);
  console.log(`  needsSponsorship: ${profile.needsSponsorship}`);
  console.log(`  openToRelocation: ${profile.openToRelocation}`);
  console.log(`  preferredLocations: ${profile.preferredLocations.join('; ') || '(none)'}`);
  console.log(`  minPay: ${profile.minPay ?? '(none)'}`);
  console.log(`  student skill entries (profile + experiences): ${studentSkills.length}`);

  const db = createAdminClient();
  const known = wellKnownNames();
  const [jobs, resources] = await Promise.all([loadJobs(db), loadResources(db)]);

  const scored: Scored[] = [];
  let skipped = 0;
  let scoreNullButRequired = 0;
  for (const job of jobs) {
    const parsedPosting = postingExtractionSchema.safeParse(job.extracted_json);
    if (!parsedPosting.success) {
      skipped += 1;
      continue;
    }
    const posting = parsedPosting.data;
    const match = scoreMatch({ ...profile, posting, jobLocation: job.location });
    const required = canonicalize(posting.requiredSkills).canonical.length;
    if (match.score == null && required > 0) scoreNullButRequired += 1;
    if (match.score != null && required === 0) scoreNullButRequired += 1;
    scored.push({
      job,
      posting,
      match,
      gaps: gapViews(match, resources),
      wellKnown: known.has(job.company.trim().toLowerCase()),
    });
  }

  console.log(
    `Scored ${scored.length} jobs with extraction_status done and role_type internship or new_grad. Skipped ${skipped} with invalid extracted_json.`,
  );
  console.log(`Active resources used for gaps: ${resources.length}`);
  const bands = new Map<string, number>();
  for (const item of scored) {
    const score = item.match.score;
    const label =
      score == null ? 'N/A' : score < 40 ? '0-39' : score < 75 ? '40-74' : score <= 85 ? '75-85' : '86-100';
    bands.set(label, (bands.get(label) ?? 0) + 1);
  }
  console.log(
    `Score bands: ${['0-39', '40-74', '75-85', '86-100', 'N/A'].map((label) => `${label} ${bands.get(label) ?? 0}`).join(', ')}`,
  );
  const inBand = scored
    .filter((item) => item.match.score != null && item.match.score >= 75 && item.match.score <= 85)
    .sort(compareDemo);
  console.log(`All jobs scored 75–85: ${inBand.length}`);
  inBand.forEach((item, index) => printJob(index + 1, item));
  for (const skill of PRIORITY_LAB_SKILLS) {
    const courses = resources.filter((row) => row.type === 'course' && row.skills.includes(skill)).length;
    const labs = resources.filter((row) => {
      if (row.type !== 'lab' || !row.skills.includes(skill)) return false;
      const faculty = row.meta.faculty;
      return Array.isArray(faculty) && faculty.length > 0;
    }).length;
    const missing = scored.filter(
      (item) => item.match.missing.includes(skill) || item.match.preferredMissing.includes(skill),
    );
    const hard = missing.filter((item) => item.match.hardMismatch != null).length;
    console.log(
      `  ${skill}: ${courses} courses, ${labs} faculty labs, missing on ${missing.length} jobs (${hard} hard-mismatched)`,
    );
  }
  if (scoreNullButRequired > 0) {
    console.log(
      `WARNING: ${scoreNullButRequired} jobs disagree between scoreMatch N/A and canonicalize(requiredSkills). Miranda should look.`,
    );
  }

  const demo = scored.filter(isDemoCandidate).sort(compareDemo);
  console.log('');
  console.log(`DEMO POSTING candidates: ${demo.length} (score 75–85, every missing skill has a course or lab)`);
  if (demo.length === 0) {
    const inRange = scored
      .filter((item) => item.match.score != null && item.match.score >= 75 && item.match.score <= 85)
      .sort(compareDemo);
    console.log('None qualify. Jobs in 75–85 that still have an uncovered missing skill:');
    inRange.slice(0, 5).forEach((item, index) => printJob(index + 1, item));
    if (inRange.length === 0) console.log('  (no jobs scored 75–85)');
  } else {
    demo.slice(0, 5).forEach((item, index) => printJob(index + 1, item));
    const chosen = demo[0]!;
    console.log(`CHOSEN demo posting: ${chosen.job.id}  ${chosen.job.company} — ${chosen.job.title}`);
  }

  const labAlt = scored
    .filter(
      (item) =>
        item.match.score != null &&
        item.match.hardMismatch == null &&
        priorityLabCount(item.gaps) > 0,
    )
    .sort((a, b) => {
      const coverA = a.gaps.every(hasCourseOrLab) ? 0 : 1;
      const coverB = b.gaps.every(hasCourseOrLab) ? 0 : 1;
      if (coverA !== coverB) return coverA - coverB;
      const inBandA = (a.match.score ?? 0) >= 75 && (a.match.score ?? 0) <= 85 ? 0 : 1;
      const inBandB = (b.match.score ?? 0) >= 75 && (b.match.score ?? 0) <= 85 ? 0 : 1;
      if (inBandA !== inBandB) return inBandA - inBandB;
      const dist = Math.abs((a.match.score ?? 0) - 80) - Math.abs((b.match.score ?? 0) - 80);
      if (dist !== 0) return dist;
      return compareDemo(a, b);
    });
  console.log('');
  console.log(
    `Priority-lab alternatives: ${labAlt.length} (missing ML, Statistics, Distributed systems, NLP, or LLMs, and that skill has a faculty lab in the gap plan)`,
  );
  labAlt.slice(0, 5).forEach((item, index) => printJob(index + 1, item));
  const labHard = scored
    .filter((item) => item.match.hardMismatch != null && priorityLabCount(item.gaps) > 0)
    .sort(compareHard);
  console.log(
    `Priority-lab jobs that are hard mismatches: ${labHard.length} (capped, so they are not demo-posting candidates)`,
  );
  labHard.slice(0, 3).forEach((item, index) => printJob(index + 1, item));

  const hard = scored.filter((item) => item.match.hardMismatch != null).sort(compareHard);
  console.log('');
  console.log(`HARD MISMATCH candidates: ${hard.length}`);
  if (hard.length === 0) {
    console.log('No hard mismatch for this demo profile.');
    const sponsorshipNo = scored.filter((item) => item.posting.sponsorship === 'no').sort(compareHard);
    const windows = scored.filter((item) => hasGraduationWindow(item.posting)).sort(compareHard);
    console.log(`Jobs with sponsorship 'no': ${sponsorshipNo.length}`);
    sponsorshipNo.slice(0, 8).forEach((item, index) => printJob(index + 1, item));
    if (sponsorshipNo.length > 8) console.log(`  … ${sponsorshipNo.length - 8} more`);
    console.log(`Jobs with a graduation window: ${windows.length}`);
    windows.slice(0, 8).forEach((item, index) => printJob(index + 1, item));
    if (windows.length > 8) console.log(`  … ${windows.length - 8} more`);
    console.log('Flip needs sponsorship during the demo (A-4) if a sponsorship-no posting should be the hard mismatch.');
  } else {
    hard.slice(0, 5).forEach((item, index) => printJob(index + 1, item));
    const chosen = hard[0]!;
    console.log(`CHOSEN hard-mismatch posting: ${chosen.job.id}  ${chosen.job.company} — ${chosen.job.title}`);
  }

  const sponsorshipFlip = scored
    .filter((item) => item.posting.sponsorship === 'no' && item.match.hardMismatch == null)
    .sort((a, b) => {
      const scoredA = a.match.score == null ? 1 : 0;
      const scoredB = b.match.score == null ? 1 : 0;
      if (scoredA !== scoredB) return scoredA - scoredB;
      return compareHard(a, b);
    });
  console.log('');
  console.log(
    `Sponsorship 'no' and not already a hard mismatch: ${sponsorshipFlip.length} (these become hard mismatches if needs sponsorship is turned on)`,
  );
  sponsorshipFlip.slice(0, 3).forEach((item, index) => printJob(index + 1, item));

  const na = scored
    .filter((item) => canonicalize(item.posting.requiredSkills).canonical.length === 0)
    .sort(compareNa);
  console.log('');
  console.log(`N/A POSTING candidates: ${na.length} (0 required skills after canonicalize)`);
  if (na.length === 0) {
    console.log('None.');
  } else {
    na.slice(0, 3).forEach((item, index) => printJob(index + 1, item));
    const chosen = na[0]!;
    console.log(`CHOSEN N/A posting: ${chosen.job.id}  ${chosen.job.company} — ${chosen.job.title}`);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : 'pick-demo failed';
  console.error(safe(message));
  process.exit(1);
});
