// PRD §5.8 readiness check for interview prep (C-10): 3 rounds of questions + two STAR grades each.
// Pass = 3/3 rounds with 0 zod/AI failures and every grade under 10 s. Relevance is judged by a human
// from the printed questions. The service-role key is used only to READ one job; experiences and
// answers are fixtures below, never real user data. Keys are never printed.
// Usage: npx tsx scripts/interview-readiness.ts [--job <id>]
import { createClient } from '@supabase/supabase-js';
import { generateQuestions, gradeAnswer, type InterviewExperience, type InterviewJob } from '../lib/ai/interview';
import { postingExtractionSchema, type InterviewQuestion } from '../lib/types';

const ROUNDS = 3;
const GRADE_LIMIT_MS = 10_000;
// Spaces rounds out like a real practice session and stays under per-minute Gemini quotas.
const PAUSE_MS = 15_000;

// TEST DATA: made-up student experiences, not from any real user.
const FIXTURE_EXPERIENCES: InterviewExperience[] = [
  {
    company: 'UMass Amherst IT',
    position: 'Student Software Developer',
    bullets: [
      'Built a Python script that automated weekly lab-computer inventory reports for 12 campus labs',
      'Migrated a ticket dashboard from jQuery to React with two other student developers',
      'Wrote SQL queries against the PostgreSQL help-desk database to find the most common ticket types',
    ],
    skills: ['Python', 'React', 'SQL', 'PostgreSQL'],
  },
  {
    company: 'HackUMass',
    position: 'Logistics Team Member',
    bullets: [
      'Coordinated check-in for about 600 hackers with a team of 8 volunteers',
      'Built a Google Sheets tracker for sponsor table assignments',
    ],
    skills: [],
  },
];

// TEST DATA: a full STAR answer and a weak one with no result.
const STRONG_ANSWER =
  'Last spring at UMass Amherst IT, our weekly lab inventory report took a staff member about four hours by hand ' +
  'and often had mistakes (situation). My supervisor asked me to automate it before the fall semester (task). ' +
  'I wrote a Python script that pulled the machine list from our asset system, checked each lab against it, ' +
  'and generated a spreadsheet; I tested it on two labs first and then walked the staff member through using it (action). ' +
  'The report now runs in under five minutes for all 12 labs, and staff stopped finding mismatches in the counts (result).';
const WEAK_QUESTION = 'Tell me about a time you helped run a large event with a team.';
const WEAK_ANSWER =
  'At HackUMass I was on the logistics team. Check-in was going to be busy, so I helped organize the volunteers ' +
  'and made sure people knew where to go.';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
}

/** Error text for printing: strip the Gemini key and any key=... query values. */
function safe(text: string): string {
  let out = text.replace(/([?&]key=)[^&\s"']+/gi, '$1[redacted]');
  const k = process.env.GEMINI_API_KEY?.trim();
  if (k) out = out.split(k).join('[redacted]');
  return out.replace(/\s+/g, ' ').slice(0, 700);
}

type JobRow = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  description: string | null;
  extracted_json: unknown;
};

async function loadJob(jobId: string | undefined): Promise<{ row: JobRow; job: InterviewJob; why: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  const db = createClient(url, key, { auth: { persistSession: false } });
  const cols = 'id, title, company, location, description, extracted_json';

  let row: JobRow | undefined;
  let why: string;
  if (jobId) {
    const { data, error } = await db.from('jobs').select(cols).eq('id', jobId).eq('extraction_status', 'done').maybeSingle();
    if (error) throw new Error(`read job: ${error.message}`);
    row = data ?? undefined;
    why = '--job';
    if (!row) throw new Error(`job ${jobId} not found or not extracted`);
  } else {
    const { data, error } = await db
      .from('jobs')
      .select(cols)
      .eq('extraction_status', 'done')
      .eq('role_type', 'internship')
      .order('id', { ascending: true })
      .limit(500);
    if (error) throw new Error(`read jobs: ${error.message}`);
    row = (data ?? []).find((r) => {
      const ex = postingExtractionSchema.safeParse(r.extracted_json);
      return ex.success && ex.data.requiredSkills.length >= 3 && (r.description?.length ?? 0) > 500;
    });
    why = 'default: first done internship (by id) with >=3 required skills';
    if (!row) throw new Error('no done internship with >=3 required skills; pass --job <id>');
  }
  if (!row.description) throw new Error('job has no description');

  const ex = postingExtractionSchema.safeParse(row.extracted_json);
  return {
    row,
    why,
    job: {
      title: row.title,
      company: row.company,
      location: row.location,
      description: row.description,
      extracted: ex.success ? ex.data : null,
    },
  };
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value?: T; error?: string }> {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { ms: Date.now() - t0, value };
  } catch (e) {
    return { ms: Date.now() - t0, error: safe(e instanceof Error ? `${e.name}: ${e.message}` : String(e)) };
  }
}

async function main() {
  process.loadEnvFile('.env.local');
  const missing = ['GEMINI_API_KEY', 'GEMINI_MODEL'].filter((n) => !process.env[n]?.trim());
  if (missing.length) throw new Error(`Missing ${missing.join(' and ')} in .env.local`);

  const { row, job, why } = await loadJob(arg('--job'));
  console.log(`job: ${row.id} (${why})`);
  console.log(`     ${row.company} | ${row.title} | ${row.location ?? '-'}`);
  console.log(`     required: ${job.extracted?.requiredSkills.join(', ') ?? '-'}`);
  console.log(`     preferred: ${job.extracted?.preferredSkills.join(', ') || '-'}`);
  console.log('experiences: FIXTURE test data (UMass Amherst IT, HackUMass)\n');

  let failures = 0;
  let slowGrades = 0;
  let cleanRounds = 0;
  const gradeTimes: number[] = [];

  for (let round = 1; round <= ROUNDS; round++) {
    console.log(`=== Round ${round}/${ROUNDS} ===`);
    let roundOk = true;

    const q = await timed(() => generateQuestions({ job, experiences: FIXTURE_EXPERIENCES }));
    let questions: InterviewQuestion[] = [];
    if (q.error) {
      failures++;
      roundOk = false;
      console.log(`questions FAILED in ${q.ms} ms: ${q.error}`);
    } else {
      questions = q.value!;
      const counts = `${questions.filter((x) => x.type === 'behavioral').length} behavioral + ${questions.filter((x) => x.type === 'resume').length} resume`;
      console.log(`questions (${q.ms} ms, ${counts}):`);
      for (const x of questions) console.log(`  ${x.id.padEnd(3)} [${x.type}] ${x.text}`);
      if (questions.length !== 5) {
        roundOk = false;
        console.log('  expected 3 behavioral + 2 resume');
      }
    }

    // Strong answer vs. the first generated behavioral question (what the demo does); weak answer vs. a
    // question it actually addresses, so a low Result rating means "missing result", not "off-topic".
    const graded = [
      { label: 'strong', question: questions.find((x) => x.type === 'behavioral')?.text, answer: STRONG_ANSWER },
      { label: 'weak (no result)', question: WEAK_QUESTION, answer: WEAK_ANSWER },
    ];
    for (const g of graded) {
      const question = g.question ?? 'Tell me about a time you improved a process.';
      const r = await timed(() => gradeAnswer({ question, answer: g.answer, job: { title: job.title, company: job.company } }));
      gradeTimes.push(r.ms);
      const slow = r.ms >= GRADE_LIMIT_MS;
      if (slow) {
        slowGrades++;
        roundOk = false;
      }
      if (r.error) {
        failures++;
        roundOk = false;
        console.log(`grade ${g.label}: FAILED in ${r.ms} ms: ${r.error}`);
        continue;
      }
      const f = r.value!;
      console.log(
        `grade ${g.label}: ${r.ms} ms${slow ? ' (SLOW)' : ''} | S${f.situation.rating} T${f.task.rating} A${f.action.rating} R${f.result.rating}`,
      );
      for (const p of ['situation', 'task', 'action', 'result'] as const) console.log(`  ${p}: ${f[p].comment}`);
      console.log(`  improvement: ${f.improvement}`);
    }

    if (roundOk) cleanRounds++;
    console.log('');
    if (round < ROUNDS) await sleep(PAUSE_MS);
  }

  const maxGrade = Math.max(...gradeTimes);
  const pass = cleanRounds === ROUNDS && failures === 0 && slowGrades === 0;
  console.log('=== PRD §5.8 summary ===');
  console.log(`clean rounds:       ${cleanRounds}/${ROUNDS}`);
  console.log(`zod/AI failures:    ${failures}`);
  console.log(`grade times (ms):   ${gradeTimes.join(', ')} (max ${maxGrade}, limit < ${GRADE_LIMIT_MS})`);
  console.log('relevance:          judge the printed questions by hand');
  console.log(`RESULT: ${pass ? 'PASS' : 'FAIL'} (automated checks)`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(safe(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
