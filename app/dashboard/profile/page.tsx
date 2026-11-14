"use client";

import Link from "next/link";
import { toast } from "sonner";
import { getMyProfile, refreshMatches, saveMyProfile } from "@/lib/api";
import { useApi } from "@/components/use-api";
import { ErrorMessage, LoadingCards, PageHeader } from "@/components/page-state";
import { ProfileEditor } from "@/components/profile/profile-editor";
import { draftFromRows, toExperienceInserts, toProfileUpdate, type ProfileDraft } from "@/components/profile/profile-draft";
import { Button } from "@/components/ui/button";

// Profile (PROF-1): the saved profile, every field editable.
// A-4 adds job preferences (sponsorship, relocation, locations, minimum pay) here.
export default function ProfilePage() {
  const me = useApi(getMyProfile, []);

  async function handleSave(draft: ProfileDraft) {
    await saveMyProfile(toProfileUpdate(draft), (userId) => toExperienceInserts(draft, userId));
    toast.success("Profile saved");
    try {
      await refreshMatches();
    } catch {
      toast.warning("Match scores couldn't update yet. They'll refresh next time.");
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
        />
      )}
    </>
  );
}
