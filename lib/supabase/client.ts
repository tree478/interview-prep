import { createBrowserClient } from "@supabase/ssr";

// Browser session client for Client Components (sign-up and log-in).
// The session is stored in cookies so lib/supabase/server.ts can read it.
// In the browser this returns one shared client.

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

export function createClient() {
  const { url, key } = publicConfig();
  return createBrowserClient(url, key);
}
