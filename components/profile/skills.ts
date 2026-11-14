import rawSkills from "@/data/skills.json";
import { canonicalize } from "@/lib/match/skills";

// Skills must come from the canonical list (CLAUDE.md, MATCH-2): off-list skills
// are dropped from matching, so letting a student add one would mislead them.

/** Every canonical skill name, for the add-box suggestions. */
export const CANONICAL_SKILLS: string[] = (rawSkills as { canonical_name: string }[])
  .map((s) => s.canonical_name)
  .sort((a, b) => a.localeCompare(b));

/** Maps what the student typed to its canonical name ("js" -> "JavaScript"), or explains why not. */
export function normalizeSkill(raw: string): { value: string } | { error: string } {
  const { canonical } = canonicalize([raw]);
  if (canonical.length) return { value: canonical[0] };
  return { error: `"${raw}" isn't in our skills list, so it wouldn't count toward matches. Pick one from the suggestions.` };
}
