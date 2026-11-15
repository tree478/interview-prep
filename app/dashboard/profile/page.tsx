"use client";

import Link from "next/link";
import { toast } from "sonner";
import { getMyProfile, refreshMatches, saveMyProfile } from "@/lib/api";
import { useApi } from "@/components/use-api";
import { ErrorMessage, LoadingCards, PageHeader } from "@/components/page-state";
import { ProfileEditor } from "@/components/profile/profile-editor";
import { draftFromRows, toExperienceInserts, toProfileUpdate, type ProfileDraft } from "@/components/profile/profile-draft";
import { Button } from "@/components/ui/button";

// Profile (PROF-1, PROF-3): the saved profile and job preferences, every field editable.
// Saving rescores the student's matches, so a preference change shows up in the feed.
export default function ProfilePage() {
  const me = useApi(getMyProfile, []);

  async function handleSave(draft: ProfileDraft) {
    // If this throws, ProfileEditor shows the error and keeps the student's edits.
    await saveMyProfile(toProfileUpdate(draft), (userId) => toExperienceInserts(draft, userId));
    try {
      const { updated } = await refreshMatches(); // POST /api/match: rescore every job
      toast.success(`Profile saved. ${updated} ${updated === 1 ? "match" : "matches"} updated.`);
    } catch {
      // The profile is saved either way; only the rescoring failed.
      toast.warning("Profile saved, but match scores couldn't update yet. Save again to retry.");
    }
    me.reload(); // re-read from the database so the form shows exactly what was stored
  }

  return (
    <>
      <PageHeader title="Profile" description="Your matches are scored against this. Keep it accurate.">
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/onboarding">Re-upload résumé</Link>
        </Button>
      </PageHeader>
      {me.status === "loading" && <LoadingCards count={3} />}
      {me.status === "error" && <ErrorMessage message={me.error} onRetry={me.reload} />}
      {me.status === "success" && (
        <ProfileEditor
          // A new key after each reload resets the form to the freshly loaded values.
          key={JSON.stringify(me.data.profile) + me.data.experiences.map((e) => e.id).join()}
          initial={draftFromRows(me.data.profile, me.data.experiences)}
          email={me.data.profile.email}
          onSave={handleSave}
          showPreferences
        />
      )}
    </>
  );
}
