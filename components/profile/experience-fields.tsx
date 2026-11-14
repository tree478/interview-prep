"use client";

import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ExperienceDraft } from "./profile-draft";
import { CANONICAL_SKILLS, normalizeSkill } from "./skills";
import { TagInput } from "./tag-input";

// One experience card. The parent owns the data; this component just reports
// changes with onChange (a "controlled" component, same idea as a controlled <input>).
export function ExperienceFields({
  experience: exp,
  index,
  errors,
  onChange,
  onRemove,
}: {
  experience: ExperienceDraft;
  index: number;
  errors: Record<string, string>;
  onChange: (next: ExperienceDraft) => void;
  onRemove: () => void;
}) {
  const set = <K extends keyof ExperienceDraft>(field: K, value: ExperienceDraft[K]) => onChange({ ...exp, [field]: value });
  const setBullet = (i: number, value: string) => set("bullets", exp.bullets.map((b, j) => (j === i ? value : b)));
  const title = exp.position || exp.company ? `${exp.position || "Position"} · ${exp.company || "Company"}` : `Experience ${index + 1}`;

  return (
    // The <legend> must be the fieldset's first child to name the group for screen readers.
    <fieldset className="relative flex flex-col gap-4 rounded-lg border p-4 pt-3">
      <legend className="float-left pr-20 text-sm font-medium">{title}</legend>
      <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove ${title}`}
        className="absolute top-2 right-2">
        Remove
      </Button>

      <div className="clear-both grid gap-4 sm:grid-cols-2">
        <FormField id={`${exp.key}-company`} label="Company or organization" value={exp.company}
          error={errors[`${exp.key}-company`]} onChange={(e) => set("company", e.target.value)} />
        <FormField id={`${exp.key}-position`} label="Position" value={exp.position}
          error={errors[`${exp.key}-position`]} onChange={(e) => set("position", e.target.value)} />
        <FormField id={`${exp.key}-start`} label="Start" type="month" value={exp.start}
          onChange={(e) => set("start", e.target.value)} />
        <FormField id={`${exp.key}-end`} label="End" type="month" value={exp.end} hint="Leave blank if this is current."
          error={errors[`${exp.key}-end`]} onChange={(e) => set("end", e.target.value)} />
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-sm">Bullets</Label>
        {exp.bullets.map((bullet, i) => (
          // Index keys are OK here: bullets are plain text inputs fully controlled by state.
          <div key={i} className="flex gap-2">
            <Textarea
              aria-label={`Bullet ${i + 1}`}
              rows={2}
              value={bullet}
              onChange={(e) => setBullet(i, e.target.value)}
              className="min-h-0 text-sm"
            />
            <Button type="button" variant="ghost" size="sm" aria-label={`Remove bullet ${i + 1}`}
              onClick={() => set("bullets", exp.bullets.filter((_, j) => j !== i))}>
              ×
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => set("bullets", [...exp.bullets, ""])}>
          Add bullet
        </Button>
      </div>

      <TagInput
        id={`${exp.key}-skills`}
        label="Skills used"
        values={exp.skills}
        onChange={(skills) => set("skills", skills)}
        normalize={normalizeSkill}
        suggestions={CANONICAL_SKILLS}
        placeholder="e.g. Python"
      />
    </fieldset>
  );
}
