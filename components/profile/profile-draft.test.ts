import { describe, expect, it } from "vitest";
import resumeMock from "../../mocks/resume.json"; // relative: vitest doesn't know the @/ alias
import type { ParsedResume } from "@/lib/types";
import {
  draftFromParsedResume,
  draftFromRows,
  emptyExperience,
  monthToDate,
  toExperienceInserts,
  toMonthValue,
  toProfileUpdate,
  validateDraft,
} from "./profile-draft";

describe("toMonthValue", () => {
  it.each([
    ["2025-09", "2025-09"],
    ["2025-9", "2025-09"],
    ["2025-09-01", "2025-09"], // database date
    ["09/2025", "2025-09"],
    ["Sep 2025", "2025-09"],
    ["September 2025", "2025-09"],
    ["sept. 2025", "2025-09"],
    ["2025", "2025-01"],
  ])("%j -> %j", (raw, expected) => {
    expect(toMonthValue(raw)).toBe(expected);
  });

  it.each([null, undefined, "", "Present", "current", "Fall semester"])("%j -> empty", (raw) => {
    expect(toMonthValue(raw)).toBe("");
  });
});

describe("monthToDate", () => {
  it("adds the first of the month for the date column", () => {
    expect(monthToDate("2025-09")).toBe("2025-09-01");
  });
  it("treats blank as unknown / present", () => {
    expect(monthToDate("")).toBeNull();
  });
});

describe("parsed résumé -> draft -> database rows", () => {
  const parsed = resumeMock.parsed as ParsedResume;
  const draft = draftFromParsedResume(parsed, "Sam Minuteman");

  it("keeps the parsed fields and converts dates", () => {
    expect(draft.majors).toEqual(["Computer Science"]);
    expect(draft.experiences[0].start).toBe("2025-09");
    expect(draft.experiences[0].end).toBe(""); // current job
    expect(draft.clubs[1].role).toBe(""); // null role becomes an empty input
  });

  it("gives every experience its own key", () => {
    const keys = draft.experiences.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("builds clean rows: trims, drops blanks, null for empty dates and roles", () => {
    const edited = {
      ...draft,
      majors: [" Computer Science ", ""],
      experiences: [{ ...draft.experiences[0], bullets: ["  Did a thing  ", ""] }],
    };
    const profile = toProfileUpdate(edited);
    expect(profile.majors).toEqual(["Computer Science"]);
    expect(profile.clubs[1]).toEqual({ name: "UMass Data Science Club", role: null });

    const [row] = toExperienceInserts(edited, "user-1");
    expect(row).toMatchObject({ user_id: "user-1", start_date: "2025-09-01", end_date: null, bullets: ["Did a thing"] });
  });

  it("round-trips through database rows", () => {
    const [row] = toExperienceInserts(draft, "user-1");
    const back = draftFromRows(
      { ...toProfileUpdate(draft), user_id: "user-1", email: "sam@umass.edu", needs_sponsorship: false,
        open_to_relocation: false, preferred_locations: [], min_pay: null } as never,
      [{ ...row, id: "exp-1" }],
    );
    expect(back.experiences[0]).toMatchObject({ company: row.company, start: "2025-09", end: "" });
    expect(back.majors).toEqual(draft.majors);
  });
});

describe("validateDraft", () => {
  it("requires a name, and company + position on each experience", () => {
    const exp = emptyExperience();
    const errors = validateDraft({ ...draftFromParsedResume(resumeMock.parsed as ParsedResume, ""), experiences: [exp] });
    expect(errors["profile-fullName"]).toBeDefined();
    expect(errors[`${exp.key}-company`]).toBeDefined();
    expect(errors[`${exp.key}-position`]).toBeDefined();
  });

  it("catches an end date before the start date", () => {
    const exp = { ...emptyExperience(), company: "A", position: "B", start: "2026-05", end: "2025-01" };
    expect(validateDraft({ ...draftFromParsedResume(resumeMock.parsed as ParsedResume, "Sam"), experiences: [exp] }))
      .toEqual({ [`${exp.key}-end`]: "End date is before the start date." });
  });
});
