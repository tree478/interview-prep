import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createClient } from '../supabase/server';

export async function getSessionUser(): Promise<{ supabase: SupabaseClient; user: User | null }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}
