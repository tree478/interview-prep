"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AUTH_ENABLED, signIn } from "@/lib/api";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { FormAlert, MockAuthNote } from "./form-alert";
import { validateLoginField } from "./validation";
import { useValidatedForm } from "./use-validated-form";

// Log-in (AUTH-2). Supabase keeps the session in cookies, so it lasts across visits.
export function LoginForm() {
  const router = useRouter();
  const form = useValidatedForm({ email: "", password: "" }, validateLoginField, "login-");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    if (!form.validateForSubmit()) return;

    setSubmitting(true);
    try {
      await signIn(form.values);
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
    // On success we leave the button disabled while the dashboard loads.
  }

  return (
    <form method="post" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {serverError && <FormAlert message={serverError} />}
      {!AUTH_ENABLED && <MockAuthNote />}

      <FormField
        label="UMass email"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@umass.edu"
        {...form.field("email")}
      />
      <FormField label="Password" type="password" autoComplete="current-password" {...form.field("password")} />

      <Button type="submit" disabled={submitting} className="h-10 text-sm">
        {submitting ? "Logging in…" : "Log in"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link href="/signup" className="font-medium text-foreground underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </form>
  );
}
