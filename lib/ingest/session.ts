// TODO(supabase): temporary. Replace with lib/supabase/server.ts once it exists (owner: Miranda).
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export async function getSessionUser(): Promise<{ supabase: SupabaseClient; user: User | null }> {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // called from a context where cookies are read-only; safe to ignore
          }
        },
      },
    },
  );
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}
