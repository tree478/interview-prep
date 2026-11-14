import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/ingest/admin';
import { secretAuth } from '@/lib/ingest/auth';
import { syncCourses } from '@/lib/ingest/courses/sync';
import { getSessionUser } from '@/lib/ingest/session';

// Vercel Hobby caps functions at 60 s. Raise this on Pro (up to 300 s) if runs get cut off.
export const maxDuration = 60;

const bodySchema = z.object({ trigger: z.enum(['manual', 'cron']).optional() });
const STALE_MS = 10 * 60_000;

async function start(request: Request): Promise<NextResponse> {
  // maxDuration is 60 s from request start; leave room for the final bot_runs update.
  const deadline = Date.now() + 50_000;
  let trigger = secretAuth(request.headers);
  if (!trigger) {
    const { user } = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    trigger = null;
  }
  const realTrigger: 'cron' | 'manual' = trigger ?? 'manual';

  if (request.method === 'POST') {
    const text = await request.text();
    if (text) {
      try {
        if (!bodySchema.safeParse(JSON.parse(text)).success) throw new Error();
      } catch {
        return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
      }
    }
  }

  try {
    const db = createAdminClient();
    const since = new Date(Date.now() - STALE_MS).toISOString();
    const running = await db
      .from('bot_runs')
      .select('id')
      .eq('kind', 'courses')
      .eq('status', 'running')
      .gt('started_at', since)
      .order('started_at', { ascending: false })
      .limit(1);
    if (running.error) throw new Error(running.error.message);
    if (running.data?.[0]) return NextResponse.json({ runId: running.data[0].id });

    const ins = await db
      .from('bot_runs')
      .insert({ kind: 'courses', trigger: realTrigger, status: 'running', companies_selected: [], errors: [] })
      .select('id')
      .single();
    if (ins.error) throw new Error(ins.error.message);
    const runId = ins.data.id as string;

    // syncCourses never throws: it finishes the bot_runs row itself ('done' or 'failed').
    after(() => syncCourses(db, runId, { deadline }));
    return NextResponse.json({ runId });
  } catch (e) {
    console.error('course sync failed to start', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Could not start run' }, { status: 500 });
  }
}

// Vercel cron sends GET; the "Refresh courses" button sends POST.
export const GET = start;
export const POST = start;
