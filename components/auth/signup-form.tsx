"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AUTH_ENABLED, signUp } from "@/lib/api";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { FormAlert, MockAuthNote } from "./form-alert";
import { MIN_PASSWORD_LENGTH, validateSignupField } from "./validation";
import { useValidatedForm } from "./use-validated-form";

// Sign-up (AUTH-1): full name, UMass email, password.
export function SignupForm() {
  const router = useRouter();
  const form = useValidatedForm({ fullName: "", email: "", password: "" }, validateSignupField, "signup-");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); // stop the browser's own full-page form submit
    setServerError(null);
    if (!form.validateForSubmit()) return;

    setSubmitting(true);
    try {
      const { needsEmailConfirmation } = await signUp(form.values);
      if (needsEmailConfirmation) {
        setConfirmationSentTo(form.values.email.trim());
        return;
      }
      // New students upload their résumé next (A-3).
      router.push("/dashboard/onboarding");
      router.refresh(); // re-run proxy.ts and server code with the new session cookie
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmationSentTo) {
    return (
      <div role="status" className="flex flex-col gap-3 text-sm">
        <p className="font-medium">Check your inbox</p>
        <p className="text-muted-foreground">
          We sent a confirmation link to <span className="font-medium text-foreground">{confirmationSentTo}</span>.
          Click it, then log in.
        </p>
        <Button asChild variant="outline" className="h-10 w-fit text-sm">
          <Link href="/login">Go to log in</Link>
        </Button>
      </div>
    );
  }

  return (
    // noValidate turns off the browser's built-in popups so our messages show instead.
    <form method="post" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {serverError && <FormAlert message={serverError} />}
      {!AUTH_ENABLED && <MockAuthNote />}

      <FormField label="Full name" autoComplete="name" {...form.field("fullName")} />
      <FormField
        label="UMass email"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@umass.edu"
        hint="Only @umass.edu addresses can sign up."
        {...form.field("email")}
      />
      <FormField
        label="Password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        {...form.field("password")}
      />

      <Button type="submit" disabled={submitting} className="h-10 text-sm">
        {submitting ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
          Log in
        </Link>
      </p>
    </form>
  );
}
