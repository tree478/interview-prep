import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Session client for Server Components, Route Handlers, and Server Actions.
// Publishable key plus the request cookies, so the user's RLS policies apply.
// Create a new client per request. Do not cache it.

function publicConfig(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) {
    const missing = [
      !url ? "NEXT_PUBLIC_SUPABASE_URL" : null,
      !key ? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" : null,
    ].filter((name): name is string => name !== null);
    throw new Error(
      missing.length === 1
        ? `${missing[0]} is not set`
        : `${missing.join(" and ")} are not set`,
    );
  }
  return { url, key };
}

export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = publicConfig();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. Token refresh has to happen
          // in proxy.ts (A-2), where the response is still writable.
        }
      },
    },
  });
}
