"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError, getMyProfile, refreshMatches, saveMyProfile, uploadResume } from "@/lib/api";
import type { AtsReport } from "@/lib/types";
import { useApi } from "@/components/use-api";
import { ErrorMessage, LoadingCards } from "@/components/page-state";
import { ProfileEditor } from "@/components/profile/profile-editor";
import { ResumeDropzone } from "@/components/profile/resume-dropzone";
import {
  draftFromParsedResume,
  emptyDraft,
  preferencesFromRow,
  toExperienceInserts,
  toProfileUpdate,
  type ProfileDraft,
} from "@/components/profile/profile-draft";
import { Button } from "@/components/ui/button";

// Onboarding (AUTH-3, AUTH-4, AUTH-5): upload résumé -> wait while it's read ->
// review the autofilled profile -> save -> job feed.
//
// It lives under /dashboard so proxy.ts already sends logged-out visitors to /login.
// One piece of state, `step`, decides which screen shows.
type Step =
  | { name: "upload" }
  | { name: "reading" }
  | { name: "error"; message: string; loggedOut: boolean }
  | { name: "review"; draft: ProfileDraft; fromResume: boolean; missingSections: AtsReport["missingSections"] };

export default function OnboardingPage() {
  const router = useRouter();
  // The name and email the student signed up with (the résumé parser doesn't return them).
  const me = useApi(getMyProfile, []);
  const [step, setStep] = useState<Step>({ name: "upload" });

  if (me.status === "loading") return <LoadingCards count={1} />;
  if (me.status === "error") return <ErrorMessage message={me.error} onRetry={me.reload} />;
  const { profile } = me.data;
  // Keep whatever preferences are already saved (sponsorship etc.). A résumé never
  // contains them, so a re-upload from the profile page must not reset them.
  const savedPreferences = preferencesFromRow(profile);

  async function handleFile(file: File) {
    setStep({ name: "reading" });
    try {
      const { parsed, ats } = await uploadResume(file);
      setStep({
        name: "review",
        draft: draftFromParsedResume(parsed, profile.full_name, savedPreferences),
        fromResume: true,
        missingSections: ats.missingSections,
      });
    } catch (err) {
      // ApiError messages are written for students; anything else (e.g. no network) gets a generic one.
      const message = err instanceof ApiError ? err.message : "We couldn't read that résumé. Check your connection and try again.";
      // 401: the session expired. Another file won't help, so the screen offers "Log in again" instead.
      setStep({ name: "error", message, loggedOut: err instanceof ApiError && err.status === 401 });
    }
  }

  // Passed to <ProfileEditor onSave>. If this throws, the editor shows the message and stays open.
  async function handleSave(draft: ProfileDraft) {
    await saveMyProfile(toProfileUpdate(draft), (userId) => toExperienceInserts(draft, userId));
    try {
      await refreshMatches(); // POST /api/match: rescore jobs against the new profile
      toast.success("Profile saved");
    } catch {
      // The profile itself is saved, so still go to the feed; scores refresh on the next save.
      toast.warning("Profile saved, but match scores couldn't update yet.");
    }
    router.push("/dashboard");
    router.refresh(); // make server components re-read data with the updated profile
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      {step.name === "upload" && (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Upload your résumé</h1>
          <p className="mt-1 mb-6 text-sm text-muted-foreground">
            We&apos;ll fill in your profile from it so you don&apos;t type everything twice. You can edit every field next.
          </p>
          <ResumeDropzone onFile={handleFile} />
          <p className="mt-4 text-center text-sm text-muted-foreground">
            No PDF handy?{" "}
            <button
              type="button"
              className="rounded-sm font-medium text-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={() => setStep({ name: "review", draft: emptyDraft(profile.full_name, savedPreferences), fromResume: false, missingSections: [] })}
            >
              Skip, fill in manually
            </button>
          </p>
        </>
      )}

      {step.name === "reading" && (
        // role="status" + aria-live: screen readers announce this without moving focus.
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 py-24 text-center">
          <div
            aria-hidden="true"
            className="size-8 animate-spin rounded-full border-2 border-muted border-t-foreground motion-reduce:animate-none"
          />
          <p className="font-medium">Reading your résumé…</p>
          <p className="text-sm text-muted-foreground">This can take up to 20 seconds.</p>
        </div>
      )}

      {step.name === "error" && (
        // role="alert" is announced immediately, since the student is waiting on this result.
        <div role="alert" className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="font-medium text-destructive">We couldn&apos;t read your résumé</p>
          <p className="max-w-md text-sm text-muted-foreground">{step.message}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {step.loggedOut ? (
              <Button asChild>
                <Link href="/login">Log in again</Link>
              </Button>
            ) : (
              <Button onClick={() => setStep({ name: "upload" })}>Try another file</Button>
            )}
            <Button
              variant="outline"
              onClick={() => setStep({ name: "review", draft: emptyDraft(profile.full_name, savedPreferences), fromResume: false, missingSections: [] })}
            >
              Fill in manually
            </Button>
          </div>
        </div>
      )}

      {step.name === "review" && (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Check your profile</h1>
          <p className="mt-1 mb-6 text-sm text-muted-foreground">
            {step.fromResume
              ? "We filled this in from your résumé. Fix anything that's wrong, then save."
              : "Fill in what you can. You can change any of it later on your Profile page."}
          </p>
          {step.missingSections.length > 0 && <PossibleIssues sections={step.missingSections} />}
          <ProfileEditor
            initial={step.draft}
            email={profile.email}
            onSave={handleSave}
            saveLabel="Save and see my matches"
          />
          <p className="mt-4 text-sm text-muted-foreground">
            <Link href="/dashboard" className="underline underline-offset-4">
              Skip for now
            </Link>{" "}
            (your matches will be less accurate)
          </p>
        </>
      )}
    </div>
  );
}

// Short preview of the ATS check (ATS-2). The full panel lives on the job page (A-6).
function PossibleIssues({ sections }: { sections: AtsReport["missingSections"] }) {
  return (
    <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-50 p-4 text-sm dark:bg-amber-950/30">
      <p className="font-medium">Possible issues</p>
      <p className="mt-1 text-muted-foreground">
        Your résumé seems to be missing {sections.length === 1 ? "a section" : "these sections"}:{" "}
        <span className="font-medium text-foreground">{sections.join(", ")}</span>. Many applicant tracking systems look
        for {sections.length === 1 ? "it" : "them"}.
      </p>
    </div>
  );
}
