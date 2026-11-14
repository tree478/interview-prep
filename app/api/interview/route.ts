import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AIError } from '@/lib/ai/gemini';
import { generateQuestions, gradeAnswer, interviewRequestSchema, type InterviewExperience } from '@/lib/ai/interview';
import { getSessionUser } from '@/lib/ingest/session';
import { postingExtractionSchema, type StarFeedback } from '@/lib/types';

export const maxDuration = 30;

const AI_UNAVAILABLE = 'Interview coach is unavailable right now. Try again.';

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/** PREP-4 (P1): best-effort. Logs only the error code, never answer text or row contents. */
async function saveQuestions(db: SupabaseClient, userId: string, jobId: string, questions: unknown) {
  const { error } = await db.from('interview_sessions').insert({ user_id: userId, job_id: jobId, questions });
  if (error) console.error('interview: saving questions failed', error.code);
}

async function saveAnswer(
  db: SupabaseClient,
  userId: string,
  jobId: string,
  entry: { questionId: string; answer: string; feedback: StarFeedback },
) {
  const at = new Date().toISOString();
  const answer = { questionId: entry.questionId, answer: entry.answer, at };
  const feedback = { questionId: entry.questionId, feedback: entry.feedback, at };
  try {
    const latest = await db
      .from('interview_sessions')
      .select('id, answers, feedback')
      .eq('user_id', userId)
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest.error) throw latest.error;
    const row = latest.data;
    const res = row
      ? await db
          .from('interview_sessions')
          .update({
            answers: [...(Array.isArray(row.answers) ? row.answers : []), answer],
            feedback: [...(Array.isArray(row.feedback) ? row.feedback : []), feedback],
          })
          .eq('id', row.id)
      : await db
          .from('interview_sessions')
          .insert({ user_id: userId, job_id: jobId, answers: [answer], feedback: [feedback] });
    if (res.error) throw res.error;
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? String(e.code) : 'unknown';
    console.error('interview: saving answer failed', code);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const { supabase, user } = await getSessionUser();
  if (!user) return fail('Unauthorized', 401);

  let body;
  try {
    body = interviewRequestSchema.safeParse(await request.json());
  } catch {
    return fail('Invalid body', 400);
  }
  if (!body.success) return fail('Invalid body', 400);
  const req = body.data;

  try {
    const job = await supabase
      .from('jobs')
      .select('id, title, company, location, description, extracted_json, extraction_status')
      .eq('id', req.jobId)
      .maybeSingle();
    if (job.error) throw new Error(`load job: ${job.error.code}`);
    if (!job.data || job.data.extraction_status !== 'done' || !job.data.description) {
      return fail('Job not found', 404);
    }
    const { title, company, location, description } = job.data;

    if (req.action === 'questions') {
      const exps = await supabase
        .from('experiences')
        .select('company, position, bullets, skills')
        .eq('user_id', user.id)
        .order('start_date', { ascending: false, nullsFirst: false });
      if (exps.error) throw new Error(`load experiences: ${exps.error.code}`);
      const experiences: InterviewExperience[] = (exps.data ?? []).map((e) => ({
        company: e.company,
        position: e.position,
        bullets: e.bullets ?? [],
        skills: e.skills ?? [],
      }));
      const extracted = postingExtractionSchema.safeParse(job.data.extracted_json);

      const questions = await generateQuestions({
        job: { title, company, location, description, extracted: extracted.success ? extracted.data : null },
        experiences,
      });
      await saveQuestions(supabase, user.id, req.jobId, questions);
      return NextResponse.json(questions);
    }

    const feedback = await gradeAnswer({ question: req.question, answer: req.answer, job: { title, company } });
    await saveAnswer(supabase, user.id, req.jobId, { questionId: req.questionId, answer: req.answer, feedback });
    return NextResponse.json(feedback);
  } catch (e) {
    if (e instanceof AIError || e instanceof ZodError) {
      console.error('interview: AI failed', req.action, e instanceof AIError ? e.message.slice(0, 200) : 'zod');
      return fail(AI_UNAVAILABLE, 502);
    }
    console.error('interview: failed', req.action, e instanceof Error ? e.message : 'unknown');
    return fail('Something went wrong', 500);
  }
}
