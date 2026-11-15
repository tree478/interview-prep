"use client";

import { useState } from "react";
import { FormField } from "@/components/form-field";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ExperienceFields } from "./experience-fields";
import {
  emptyExperience,
  MAX_INTERESTS,
  MAX_PREFERRED_LOCATIONS,
  newKey,
  SKILLS_SHOWN_BEFORE_EXPAND,
  validateDraft,
  type ClubDraft,
  type ProfileDraft,
} from "./profile-draft";
import { CANONICAL_SKILLS, normalizeSkill } from "./skills";
import { TagInput } from "./tag-input";

// The editable profile (AUTH-4, AUTH-5, PROF-1). Used by onboarding (prefilled from
// the parsed résumé) and the profile page (prefilled from the database).
//
// This component owns the draft while it's being edited. The page decides what
// "save" means by passing onSave, which keeps this component reusable.
export function ProfileEditor({
  initial,
  email,
  onSave,
  saveLabel = "Save profile",
  savingLabel = "Saving…",
  showPreferences = false,
}: {
  initial: ProfileDraft;
  email?: string;
  onSave: (draft: ProfileDraft) => Promise<void>;
  saveLabel?: string;
  savingLabel?: string;
  /** Show the "Job preferences" card (profile page). Onboarding leaves it off to stay short. */
  showPreferences?: boolean;
}) {
  const [draft, setDraft] = useState<ProfileDraft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const set = <K extends keyof ProfileDraft>(field: K, value: ProfileDraft[K]) =>
    setDraft((prev) => ({ ...prev, [field]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    const found = validateDraft(draft);
    setErrors(found);
    const firstId = Object.keys(found)[0];
    if (firstId) {
      document.getElementById(firstId)?.focus();
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>About you</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField id="profile-fullName" label="Full name" autoComplete="name" value={draft.fullName}
            error={errors["profile-fullName"]} onChange={(e) => set("fullName", e.target.value)} />
          <FormField id="profile-year" label="Year" placeholder="e.g. Junior, Class of 2028" value={draft.year}
            onChange={(e) => set("year", e.target.value)} />
          {email && <FormField id="profile-email" label="Email" value={email} readOnly disabled hint="Your login email can't be changed here." />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Academics</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <TagInput id="profile-majors" label="Majors" values={draft.majors} onChange={(v) => set("majors", v)} placeholder="e.g. Computer Science" />
          <TagInput id="profile-minors" label="Minors" values={draft.minors} onChange={(v) => set("minors", v)} placeholder="e.g. Mathematics" />
          <TagInput id="profile-honors" label="Honors" values={draft.honors} onChange={(v) => set("honors", v)} placeholder="e.g. Dean's List" />
          <ClubsFields clubs={draft.clubs} errors={errors} onChange={(v) => set("clubs", v)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Experience</CardTitle>
          <CardDescription>Jobs, research, and projects. Tailoring rewrites these bullets, so keep them accurate.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {draft.experiences.map((exp, i) => (
            <ExperienceFields
              key={exp.key}
              experience={exp}
              index={i}
              errors={errors}
              onChange={(next) => set("experiences", draft.experiences.map((x) => (x.key === exp.key ? next : x)))}
              onRemove={() => set("experiences", draft.experiences.filter((x) => x.key !== exp.key))}
            />
          ))}
          <Button type="button" variant="outline" className="w-fit"
            onClick={() => set("experiences", [...draft.experiences, emptyExperience()])}>
            Add experience
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Skills and interests</CardTitle>
          <CardDescription>Skills drive your match scores. Pick them from the suggestions.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <TagInput id="profile-skills" label="Skills" values={draft.skills} onChange={(v) => set("skills", v)}
            normalize={normalizeSkill} suggestions={CANONICAL_SKILLS} collapseAfter={SKILLS_SHOWN_BEFORE_EXPAND}
            placeholder="e.g. Python, React, SQL" />
          <TagInput id="profile-interests" label="Interests" values={draft.interests} onChange={(v) => set("interests", v)}
            max={MAX_INTERESTS} error={errors["profile-interests"]} placeholder="e.g. Machine learning" />
        </CardContent>
      </Card>

      {showPreferences && (
        <Card>
          <CardHeader>
            <CardTitle>Job preferences</CardTitle>
            <CardDescription>
              These change how jobs are flagged and checked. They never hide a job from your feed.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <PreferenceToggle
              id="profile-needsSponsorship"
              label="I need visa sponsorship"
              hint="We flag jobs that say they don't sponsor as a hard mismatch and cap their score at 40%."
              checked={draft.needsSponsorship}
              onChange={(v) => set("needsSponsorship", v)}
            />
            <PreferenceToggle
              id="profile-openToRelocation"
              label="I'm open to relocating"
              hint="When on, every job passes the location check, wherever it is."
              checked={draft.openToRelocation}
              onChange={(v) => set("openToRelocation", v)}
            />
            <TagInput
              id="profile-preferredLocations"
              label="Preferred locations"
              values={draft.preferredLocations}
              onChange={(v) => set("preferredLocations", v)}
              max={MAX_PREFERRED_LOCATIONS}
              error={errors["profile-preferredLocations"]}
              placeholder="e.g. Boston, MA or Remote"
              hint="Jobs in these places pass the location check. Remote jobs always pass."
            />
            <FormField
              id="profile-minPay"
              label="Minimum pay (USD per year)"
              inputMode="numeric"
              placeholder="e.g. 60,000"
              value={draft.minPay}
              error={errors["profile-minPay"]}
              onChange={(e) => set("minPay", e.target.value)}
              hint="Compared with a posting's stated pay (hourly × 2,080, monthly × 12). Postings that don't state pay are never hidden."
            />
          </CardContent>
        </Card>
      )}

      {/* Sticky so Save is always reachable on a long form. */}
      <div className="sticky bottom-0 -mx-1 flex flex-col gap-2 border-t bg-background/95 px-1 py-3 backdrop-blur">
        {saveError && <FormAlert message={saveError} />}
        {Object.keys(errors).length > 0 && (
          <p role="alert" className="text-sm text-destructive">Fix the highlighted fields to save.</p>
        )}
        <Button type="submit" disabled={saving} className="h-10 w-full text-sm sm:w-fit sm:self-end">
          {saving ? savingLabel : saveLabel}
        </Button>
      </div>
    </form>
  );
}

// A labeled on/off switch with a helper line. The Switch is a <button role="switch">,
// so Tab focuses it and Space/Enter toggles it; clicking the label toggles it too.
function PreferenceToggle({
  id, label, hint, checked, onChange,
}: { id: string; label: string; hint: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor={id} className="text-sm">{label}</Label>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-describedby={`${id}-hint`} className="mt-0.5" />
    </div>
  );
}

function ClubsFields({
  clubs, errors, onChange,
}: { clubs: ClubDraft[]; errors: Record<string, string>; onChange: (clubs: ClubDraft[]) => void }) {
  const update = (key: string, patch: Partial<ClubDraft>) =>
    onChange(clubs.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium">Clubs and e-board roles</legend>
      {clubs.map((club, i) => (
        <div key={club.key} className="flex flex-col gap-1">
          <div className="flex gap-2">
            <Input id={`${club.key}-name`} aria-label={`Club ${i + 1} name`} placeholder="Club" value={club.name}
              aria-invalid={errors[`${club.key}-name`] ? true : undefined}
              className="h-9 text-sm md:text-sm" onChange={(e) => update(club.key, { name: e.target.value })} />
            <Input aria-label={`Club ${i + 1} role`} placeholder="Role (optional)" value={club.role}
              className="h-9 text-sm md:text-sm" onChange={(e) => update(club.key, { role: e.target.value })} />
            <Button type="button" variant="ghost" size="sm" aria-label={`Remove club ${i + 1}`} className="h-9"
              onClick={() => onChange(clubs.filter((c) => c.key !== club.key))}>
              ×
            </Button>
          </div>
          {errors[`${club.key}-name`] && <p className="text-xs font-medium text-destructive">{errors[`${club.key}-name`]}</p>}
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="w-fit"
        onClick={() => onChange([...clubs, { key: newKey("club"), name: "", role: "" }])}>
        Add club
      </Button>
    </fieldset>
  );
}
