// The editable profile ("draft") and conversions to and from the shapes around it:
//
//   ParsedResume (from POST /api/resume)  ─┐
//                                          ├─>  ProfileDraft (what the form edits)  ──>  profiles + experiences rows
//   profiles + experiences rows (from DB) ─┘
//
// Pure functions only, so they're easy to unit test (profile-draft.test.ts).

import type { ExperienceRow, ParsedResume, ProfileRow } from "@/lib/types";

export type ClubDraft = { key: string; name: string; role: string };

export type ExperienceDraft = {
  key: string; // stable React key, so editing/removing one card never mixes up another
  company: string;
  position: string;
  start: string; // "YYYY-MM" (what <input type="month"> uses) or ""
  end: string; // "YYYY-MM", or "" for current / unknown
  bullets: string[];
  skills: string[];
};

export type ProfileDraft = {
  fullName: string;
  year: string;
  majors: string[];
  minors: string[];
  honors: string[];
  clubs: ClubDraft[];
  experiences: ExperienceDraft[];
  skills: string[];
  interests: string[];
};

export const MAX_INTERESTS = 10; // PRD AUTH-4, and a CHECK constraint in the database
export const SKILLS_SHOWN_BEFORE_EXPAND = 20;

let keyCounter = 0;
/** A unique key for list items created in this browser session. */
export function newKey(prefix: string) {
  keyCounter += 1;
  return `${prefix}-${keyCounter}`;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * Turns whatever date text a résumé or the database has into "YYYY-MM" for a month input.
 * Accepts "2025-09", "2025-09-01", "09/2025", "Sep 2025", "September 2025", "2025".
 * Returns "" for "Present", blanks, or anything unrecognized (the student can fill it in).
 */
export function toMonthValue(raw: string | null | undefined): string {
  const text = (raw ?? "").trim().toLowerCase();
  if (!text) return "";
  let m = text.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = text.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  m = text.match(/^([a-z]{3})[a-z]*\.?\s+(\d{4})$/);
  if (m && MONTHS[m[1]]) return `${m[2]}-${MONTHS[m[1]]}`;
  m = text.match(/^(\d{4})$/);
  if (m) return `${m[1]}-01`;
  return "";
}

/** "YYYY-MM" -> "YYYY-MM-01" for the database's date column; "" -> null. */
export function monthToDate(month: string): string | null {
  return /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : null;
}

export function emptyExperience(): ExperienceDraft {
  return { key: newKey("exp"), company: "", position: "", start: "", end: "", bullets: [""], skills: [] };
}

export function emptyDraft(fullName = ""): ProfileDraft {
  return { fullName, year: "", majors: [], minors: [], honors: [], clubs: [], experiences: [], skills: [], interests: [] };
}

export function draftFromParsedResume(parsed: ParsedResume, fullName: string): ProfileDraft {
  return {
    fullName,
    year: parsed.academics.year ?? "",
    majors: parsed.academics.majors,
    minors: parsed.academics.minors,
    honors: parsed.academics.honors,
    clubs: parsed.academics.clubs.map((c) => ({ key: newKey("club"), name: c.name, role: c.role ?? "" })),
    experiences: parsed.experiences.map((e) => ({
      key: newKey("exp"),
      company: e.company,
      position: e.position,
      start: toMonthValue(e.start_date),
      end: toMonthValue(e.end_date),
      bullets: e.bullets.length ? e.bullets : [""],
      skills: e.skills,
    })),
    skills: parsed.skills,
    interests: parsed.interests.slice(0, MAX_INTERESTS),
  };
}

export function draftFromRows(profile: ProfileRow, experiences: ExperienceRow[]): ProfileDraft {
  return {
    fullName: profile.full_name,
    year: profile.year ?? "",
    majors: profile.majors,
    minors: profile.minors,
    honors: profile.honors,
    clubs: profile.clubs.map((c) => ({ key: newKey("club"), name: c.name, role: c.role ?? "" })),
    experiences: experiences.map((e) => ({
      key: newKey("exp"),
      company: e.company,
      position: e.position,
      start: toMonthValue(e.start_date),
      end: toMonthValue(e.end_date),
      bullets: e.bullets.length ? e.bullets : [""],
      skills: e.skills,
    })),
    skills: profile.skills,
    interests: profile.interests,
  };
}

/** Problems that would stop a save, keyed by the id of the input to focus. */
export function validateDraft(draft: ProfileDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.fullName.trim()) errors["profile-fullName"] = "Enter your full name.";
  for (const exp of draft.experiences) {
    if (!exp.company.trim()) errors[`${exp.key}-company`] = "Enter the company or organization.";
    if (!exp.position.trim()) errors[`${exp.key}-position`] = "Enter your position.";
    if (exp.start && exp.end && exp.end < exp.start) errors[`${exp.key}-end`] = "End date is before the start date.";
  }
  for (const club of draft.clubs) {
    if (!club.name.trim() && club.role.trim()) errors[`${club.key}-name`] = "Enter the club name.";
  }
  if (draft.interests.length > MAX_INTERESTS) errors["profile-interests"] = `Keep it to ${MAX_INTERESTS} interests.`;
  return errors;
}

/** The profiles columns this form owns (preferences are saved separately in A-4). */
export function toProfileUpdate(draft: ProfileDraft) {
  return {
    full_name: draft.fullName.trim(),
    year: draft.year.trim() || null,
    majors: cleanList(draft.majors),
    minors: cleanList(draft.minors),
    honors: cleanList(draft.honors),
    clubs: draft.clubs
      .filter((c) => c.name.trim())
      .map((c) => ({ name: c.name.trim(), role: c.role.trim() || null })),
    skills: cleanList(draft.skills),
    interests: cleanList(draft.interests).slice(0, MAX_INTERESTS),
  };
}

/** New experiences rows (the database fills in id). */
export function toExperienceInserts(draft: ProfileDraft, userId: string) {
  return draft.experiences.map((e) => ({
    user_id: userId,
    company: e.company.trim(),
    position: e.position.trim(),
    start_date: monthToDate(e.start),
    end_date: monthToDate(e.end),
    bullets: cleanList(e.bullets),
    skills: cleanList(e.skills),
  }));
}

function cleanList(items: string[]) {
  return items.map((s) => s.trim()).filter(Boolean);
}
