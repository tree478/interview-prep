import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Log in · UMass Career Coach" };

export default function LoginPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Welcome back</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">Log in with your UMass email.</p>
      <LoginForm />
    </>
  );
}
