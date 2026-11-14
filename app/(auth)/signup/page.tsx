import Link from "next/link";
import { Button } from "@/components/ui/button";

// Placeholder until A-2 (sign-up, @umass.edu only) and A-3 (resume upload).
export default function SignupPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold">Create your account</h1>
      <p className="text-sm text-muted-foreground">
        Sign-up and resume upload arrive in tasks A-2 and A-3.
      </p>
      <Button asChild className="w-fit">
        <Link href="/dashboard">Continue to the dashboard (mock)</Link>
      </Button>
    </main>
  );
}
