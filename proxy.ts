import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Runs on the server before matching pages render (Next 16 renamed middleware.ts to proxy.ts).
//
// 1. Refreshes the Supabase session cookie so logins don't silently expire.
// 2. Logged out + /dashboard/**  ->  /login           (AUTH-2)
// 3. Logged in  + /login|/signup ->  /dashboard
//
// This is a fast "optimistic" check for navigation only. Every API route still
// checks the user itself, and row-level security protects the data.
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // No Supabase keys yet: auth is simulated (see lib/api.ts), so let everything through.
  if (!url || !key) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      // Called when Supabase refreshes the session: copy the new cookies onto
      // both the request (for this render) and the response (for the browser).
      setAll: (cookiesToSet, headers) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([header, value]) => response.headers.set(header, value));
      },
    },
  });

  // getUser() asks Supabase to verify the session (don't trust the cookie alone).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  if (!user && path.startsWith("/dashboard")) return redirectKeepingCookies("/login", request, response);
  if (user && (path === "/login" || path === "/signup")) return redirectKeepingCookies("/dashboard", request, response);
  return response;
}

// A redirect is a new response, so carry over any refreshed session cookies.
function redirectKeepingCookies(to: string, request: NextRequest, from: NextResponse) {
  const redirect = NextResponse.redirect(new URL(to, request.url));
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

// Only run on pages that care about login state (skips images, JS, API routes).
export const config = {
  matcher: ["/dashboard/:path*", "/login", "/signup"],
};
