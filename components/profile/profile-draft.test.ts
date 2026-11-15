import { describe, expect, it } from "vitest";
import resumeMock from "../../mocks/resume.json"; // relative: vitest doesn't know the @/ alias
import type { ParsedResume, ProfileRow } from "@/lib/types";
import {
  draftFromParsedResume,
  draftFromRows,
  emptyDraft,
  emptyExperience,
  MAX_MIN_PAY,
  parseMinPay,
  preferencesFromRow,
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

describe("job preferences (PROF-3)", () => {
  const parsed = resumeMock.parsed as ParsedResume;
  // A saved profile with every preference set, as the database returns it.
  const savedRow: ProfileRow = {
    user_id: "00000000-0000-4000-8000-000000000000",
    full_name: "Sam Minuteman",
    email: "sam@umass.edu",
    year: "Junior",
    majors: ["Computer Science"],
    minors: [],
    honors: [],
    clubs: [],
    skills: ["Python"],
    interests: [],
    needs_sponsorship: true,
    open_to_relocation: true,
    preferred_locations: ["Boston, MA", "Remote"],
    min_pay: 60000,
  };

  describe("parseMinPay", () => {
    it.each([
      ["", null],
      ["   ", null],
      ["60000", 60000],
      ["60,000", 60000],
      ["$60,000", 60000],
      [" 0 ", 0],
      [String(MAX_MIN_PAY), MAX_MIN_PAY],
    ])("%j -> %j", (raw, expected) => {
      expect(parseMinPay(raw)).toBe(expected);
    });

    it.each(["-5", "60000.50", "60k", "abc", String(MAX_MIN_PAY + 1), "1e5"])("%j -> invalid", (raw) => {
      expect(parseMinPay(raw)).toBe("invalid");
    });
  });

  it("new drafts default to no preferences (nothing guessed)", () => {
    for (const draft of [emptyDraft("Sam"), draftFromParsedResume(parsed, "Sam")]) {
      expect(draft).toMatchObject({ needsSponsorship: false, openToRelocation: false, preferredLocations: [], minPay: "" });
    }
  });

  it("reads preferences from the database row", () => {
    expect(draftFromRows(savedRow, [])).toMatchObject({
      needsSponsorship: true,
      openToRelocation: true,
      preferredLocations: ["Boston, MA", "Remote"],
      minPay: "60000",
    });
    expect(preferencesFromRow({ ...savedRow, min_pay: null }).minPay).toBe("");
  });

  it("writes all four columns, converting pay and cleaning locations", () => {
    const draft = {
      ...draftFromRows(savedRow, []),
      preferredLocations: [" Boston, MA ", "boston, ma", "", "Remote"],
      minPay: "$75,000",
    };
    expect(toProfileUpdate(draft)).toMatchObject({
      needs_sponsorship: true,
      open_to_relocation: true,
      preferred_locations: ["Boston, MA", "Remote"], // trimmed, blank dropped, case-insensitive duplicate dropped
      min_pay: 75000,
    });
    expect(toProfileUpdate({ ...draft, minPay: "" }).min_pay).toBeNull();
  });

  it("round-trips: row -> draft -> row keeps every preference", () => {
    const update = toProfileUpdate(draftFromRows(savedRow, []));
    expect(update).toMatchObject({
      needs_sponsorship: savedRow.needs_sponsorship,
      open_to_relocation: savedRow.open_to_relocation,
      preferred_locations: savedRow.preferred_locations,
      min_pay: savedRow.min_pay,
    });
  });

  it("re-uploading a résumé keeps the saved preferences", () => {
    const saved = preferencesFromRow(savedRow);
    const fromResume = draftFromParsedResume(parsed, savedRow.full_name, saved);
    const manual = emptyDraft(savedRow.full_name, saved);

    for (const draft of [fromResume, manual]) {
      expect(toProfileUpdate(draft)).toMatchObject({
        needs_sponsorship: true,
        open_to_relocation: true,
        preferred_locations: ["Boston, MA", "Remote"],
        min_pay: 60000,
      });
    }
    // ...while the résumé fields still come from the new résumé.
    expect(fromResume.majors).toEqual(parsed.academics.majors);
    expect(fromResume.experiences).toHaveLength(parsed.experiences.length);
  });

  it("validates minimum pay and location count, with errors on the field ids", () => {
    const base = draftFromRows(savedRow, []);
    expect(validateDraft(base)).toEqual({});
    expect(validateDraft({ ...base, minPay: "" })).toEqual({});
    expect(validateDraft({ ...base, minPay: "-1" })["profile-minPay"]).toMatch(/whole number/);
    expect(validateDraft({ ...base, minPay: "lots" })["profile-minPay"]).toBeDefined();

    const eleven = Array.from({ length: 11 }, (_, i) => `City ${i}`);
    expect(validateDraft({ ...base, preferredLocations: eleven })["profile-preferredLocations"]).toMatch(/10 locations/);
  });
});
