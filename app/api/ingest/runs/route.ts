import { NextResponse } from 'next/server';
import { toBotRun } from '@/lib/ingest/botRuns';
import { getSessionUser } from '@/lib/ingest/session';
import { botRunSchema } from '@/lib/types';

export async function GET() {
  const { supabase, user } = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // user's session client, so RLS applies
  const { data, error } = await supabase
    .from('bot_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: 'Could not load runs' }, { status: 500 });

  try {
    return NextResponse.json(botRunSchema.array().parse((data ?? []).map(toBotRun)));
  } catch {
    return NextResponse.json({ error: 'Unexpected run data' }, { status: 500 });
  }
}
