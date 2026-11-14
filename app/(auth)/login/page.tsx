import Link from "next/link";
import { Button } from "@/components/ui/button";

// Placeholder until A-2 (Supabase email/password login).
// The "(auth)" folder name is in parentheses, so it groups files without
// adding to the URL: this page lives at /login, not /auth/login.
export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold">Log in</h1>
      <p className="text-sm text-muted-foreground">The login form arrives in task A-2.</p>
      <Button asChild className="w-fit">
        <Link href="/dashboard">Continue to the dashboard (mock)</Link>
      </Button>
    </main>
  );
}
