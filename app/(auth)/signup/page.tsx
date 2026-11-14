import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/signup-form";

export const metadata: Metadata = { title: "Create account · UMass Career Coach" };

// Server Component: static heading, with the interactive form as a Client Component inside.
export default function SignupPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Create your account</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">For UMass Amherst students. Use your @umass.edu email.</p>
      <SignupForm />
    </>
  );
}
