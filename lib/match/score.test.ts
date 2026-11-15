import { describe, expect, it } from "vitest";
import type { FeedItem, PostingExtraction } from "../types";
import { compareFeedItems, isFeedRole, scoreMatch } from "./score";

function posting(overrides: Partial<PostingExtraction> = {}): PostingExtraction {
  return {
    requiredSkills: [],
    preferredSkills: [],
    majors: [],
    graduation: null,
    locations: [],
    remote: false,
    sponsorship: "unknown",
    pay: null,
    roleType: "internship",
    ...overrides,
  };
}

function score(
  overrides: Partial<Parameters<typeof scoreMatch>[0]> = {},
): ReturnType<typeof scoreMatch> {
  return scoreMatch({
    studentSkills: [],
    year: null,
    majors: [],
    needsSponsorship: false,
    openToRelocation: false,
    preferredLocations: [],
    minPay: null,
    jobLocation: null,
    posting: posting(),
    ...overrides,
  });
}

function feedItem(
  id: string,
  matchScore: number | null,
  hardMismatch: string | null,
): FeedItem {
  return {
    job: {
      id,
      company: "Acme",
      title: "Intern",
      location: "Boston",
      url: "https://example.com/jobs/" + id,
      roleType: "internship",
      sponsorship: "unknown",
      postedAt: null,
      deadline: null,
    },
    match: {
      score: matchScore,
      covered: [],
      missing: [],
      preferredCovered: [],
      preferredMissing: [],
      checks: [],
      hardMismatch,
    },
  };
}

describe("scoreMatch", () => {
  it("scores required coverage, preferred coverage, and passing checks", () => {
    const result = score({
      studentSkills: ["Python", "React", "TypeScript", "Git"],
      majors: ["Computer Science"],
      preferredLocations: ["Boston"],
      minPay: 80000,
      posting: posting({
        requiredSkills: ["Python", "React", "Docker", "SQL"],
        preferredSkills: ["TypeScript", "AWS"],
        majors: ["Computer Science"],
        locations: ["Boston"],
        pay: { min: 100000, max: 120000, interval: "year" },
      }),
    });

    // R = 2/4, P = 1/2, Q = 3/3 → 0.5*0.5 + 0.2*0.5 + 0.3*1 = 0.65
    expect(result.score).toBe(65);
    expect(result.covered).toEqual(["Python", "React"]);
    expect(result.missing).toEqual(["Docker", "SQL"]);
    expect(result.preferredCovered).toEqual(["TypeScript"]);
    expect(result.preferredMissing).toEqual(["AWS"]);
    expect(result.checks).toEqual([
      {
        name: "major",
        passed: true,
        detail: "Major matches: Computer Science",
      },
      {
        name: "location",
        passed: true,
        detail: "Location matches Boston",
      },
      { name: "pay", passed: true, detail: "Pay meets minimum" },
    ]);
    expect(result.hardMismatch).toBeNull();
  });

  it("returns N/A when no required skills survive canonicalization", () => {
    const result = score({
      studentSkills: ["Python"],
      needsSponsorship: true,
      posting: posting({
        requiredSkills: ["Not A Real Skill"],
        preferredSkills: ["Python", "Docker"],
        sponsorship: "no",
      }),
    });

    expect(result.score).toBeNull();
    expect(result.covered).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.preferredCovered).toEqual(["Python"]);
    expect(result.preferredMissing).toEqual(["Docker"]);
    expect(result.checks).toEqual([
      {
        name: "sponsorship",
        passed: false,
        detail: "Needs sponsorship; posting won't sponsor",
      },
    ]);
    expect(result.hardMismatch).toBe("Needs sponsorship; posting won't sponsor");
  });

  it("moves the preferred weight onto required skills when none are listed", () => {
    const result = score({
      studentSkills: ["Python", "React"],
      majors: ["Computer Science"],
      preferredLocations: ["New York"],
      posting: posting({
        requiredSkills: ["Python", "React", "Docker", "SQL"],
        preferredSkills: [],
        majors: ["Computer Science"],
        locations: ["Boston"],
      }),
    });

    // No preferred skills: 0.7R + 0.3Q. R = 2/4, Q = 1/2.
    expect(result.score).toBe(50);
    expect(result.preferredCovered).toEqual([]);
    expect(result.preferredMissing).toEqual([]);
    expect(result.checks.map((check) => check.passed)).toEqual([true, false]);
  });

  it("moves the check weight onto required skills when no check applies", () => {
    const result = score({
      studentSkills: ["Python", "TypeScript"],
      posting: posting({
        requiredSkills: ["Python", "SQL"],
        preferredSkills: ["TypeScript", "AWS"],
      }),
    });

    // No applicable checks: 0.8R + 0.2P. R = 1/2, P = 1/2.
    expect(result.score).toBe(50);
    expect(result.checks).toEqual([]);
  });

  it("gives the whole score to required skills when preferred skills and checks are absent", () => {
    const full = score({
      studentSkills: ["Python", "SQL"],
      posting: posting({ requiredSkills: ["Python", "SQL"] }),
    });
    const half = score({
      studentSkills: ["Python"],
      posting: posting({ requiredSkills: ["Python", "SQL"] }),
    });

    expect(full.score).toBe(100);
    expect(half.score).toBe(50);
  });

  it("treats off-list preferred skills as an empty preferred list", () => {
    const result = score({
      studentSkills: ["Python"],
      posting: posting({
        requiredSkills: ["Python"],
        preferredSkills: ["Not A Real Skill"],
      }),
    });

    expect(result.score).toBe(100);
    expect(result.preferredCovered).toEqual([]);
    expect(result.preferredMissing).toEqual([]);
  });

  it("counts an experience skill that is absent from profile skills", () => {
    // The route unions profile.skills and then each experience.skills.
    const result = score({
      studentSkills: ["JavaScript", "Python"],
      posting: posting({ requiredSkills: ["Python"] }),
    });

    expect(result.covered).toEqual(["Python"]);
    expect(result.score).toBe(100);
  });

  it("covers a skill only by its canonical name and drops off-list required skills", () => {
    const result = score({
      studentSkills: ["JS"],
      posting: posting({
        requiredSkills: ["JavaScript", "Not A Real Skill", "JS"],
      }),
    });

    expect(result.covered).toEqual(["JavaScript"]);
    expect(result.missing).toEqual([]);
    expect(result.score).toBe(100);
  });

  it("counts a skill in both ratios when it is required and preferred", () => {
    const result = score({
      studentSkills: ["Python"],
      posting: posting({
        requiredSkills: ["Python", "SQL"],
        preferredSkills: ["Python", "React"],
      }),
    });

    // No checks: 0.8*(1/2) + 0.2*(1/2) = 0.5.
    expect(result.score).toBe(50);
    expect(result.covered).toEqual(["Python"]);
    expect(result.missing).toEqual(["SQL"]);
    expect(result.preferredCovered).toEqual(["Python"]);
    expect(result.preferredMissing).toEqual(["React"]);
  });

  it("caps a high score at 40 when the student needs sponsorship and the posting will not sponsor", () => {
    const result = score({
      studentSkills: ["Python", "TypeScript"],
      majors: ["Computer Science"],
      needsSponsorship: true,
      posting: posting({
        requiredSkills: ["Python"],
        preferredSkills: ["TypeScript"],
        majors: ["Computer Science"],
        remote: true,
        sponsorship: "no",
      }),
    });

    // Uncapped: R = 1, P = 1, Q = 2/3 → 90.
    expect(result.score).toBe(40);
    expect(result.hardMismatch).toBe("Needs sponsorship; posting won't sponsor");
    expect(result.checks).toContainEqual({
      name: "sponsorship",
      passed: false,
      detail: "Needs sponsorship; posting won't sponsor",
    });
  });

  it("leaves a raw score of 20 in place when sponsorship is a hard mismatch", () => {
    const result = score({
      studentSkills: ["Python", "React"],
      needsSponsorship: true,
      posting: posting({
        requiredSkills: ["Python", "React", "Docker", "SQL", "TypeScript"],
        preferredSkills: ["AWS"],
        sponsorship: "no",
      }),
    });

    // R = 2/5, P = 0, Q = 0 → 20, which is already under the cap.
    expect(result.score).toBe(20);
    expect(result.hardMismatch).toBe("Needs sponsorship; posting won't sponsor");
  });

  it("caps the score at 40 when the graduation year is outside the window", () => {
    const result = score({
      studentSkills: ["Python", "TypeScript"],
      year: "Class of 2024",
      majors: ["Computer Science"],
      posting: posting({
        requiredSkills: ["Python"],
        preferredSkills: ["TypeScript"],
        majors: ["Computer Science"],
        remote: true,
        graduation: { startYear: 2025, endYear: 2026 },
      }),
    });

    expect(result.score).toBe(40);
    expect(result.hardMismatch).toBe(
      "Graduation year 2024 is outside 2025–2026",
    );
    expect(result.checks).toContainEqual({
      name: "grad_year",
      passed: false,
      detail: "Graduation year 2024 is outside 2025–2026",
    });
  });

  it("joins both hard mismatches with sponsorship first", () => {
    const result = score({
      studentSkills: ["Python", "TypeScript"],
      year: "Class of 2024",
      majors: ["Computer Science"],
      needsSponsorship: true,
      posting: posting({
        requiredSkills: ["Python"],
        preferredSkills: ["TypeScript"],
        majors: ["Computer Science"],
        remote: true,
        sponsorship: "no",
        graduation: { startYear: 2025, endYear: 2026 },
      }),
    });

    expect(result.score).toBe(40);
    expect(result.hardMismatch).toBe(
      "Needs sponsorship; posting won't sponsor; Graduation year 2024 is outside 2025–2026",
    );
  });

  it("does not treat unknown sponsorship as a hard mismatch", () => {
    const result = score({
      studentSkills: ["Python"],
      needsSponsorship: true,
      posting: posting({
        requiredSkills: ["Python"],
        sponsorship: "unknown",
      }),
    });

    expect(result.score).toBe(100);
    expect(result.hardMismatch).toBeNull();
    expect(result.checks).toEqual([]);
  });

  it("passes sponsorship and skips the cap when the student does not need it", () => {
    const result = score({
      studentSkills: ["Python"],
      needsSponsorship: false,
      posting: posting({
        requiredSkills: ["Python"],
        sponsorship: "no",
      }),
    });

    expect(result.score).toBe(100);
    expect(result.hardMismatch).toBeNull();
    expect(result.checks).toEqual([
      {
        name: "sponsorship",
        passed: true,
        detail: "Sponsorship not needed",
      },
    ]);
  });

  it("passes sponsorship when the posting sponsors", () => {
    const result = score({
      studentSkills: ["Python"],
      needsSponsorship: true,
      posting: posting({
        requiredSkills: ["Python"],
        sponsorship: "yes",
      }),
    });

    expect(result.hardMismatch).toBeNull();
    expect(result.checks).toEqual([
      { name: "sponsorship", passed: true, detail: "Posting sponsors" },
    ]);
  });

  it("matches majors case-insensitively and fails when none match", () => {
    const matched = score({
      majors: [" computer science "],
      posting: posting({ majors: ["Computer Science"] }),
    });
    const missed = score({
      majors: [],
      posting: posting({ majors: ["Computer Science", "Informatics"] }),
    });

    expect(matched.checks).toEqual([
      {
        name: "major",
        passed: true,
        detail: "Major matches: computer science",
      },
    ]);
    expect(missed.checks).toEqual([
      {
        name: "major",
        passed: false,
        detail: "Major does not match posting (Computer Science, Informatics)",
      },
    ]);
  });

  it("uses the first graduation year and the stated window text", () => {
    const inside = score({
      year: "Started 2020, class of 2026",
      posting: posting({
        graduation: { startYear: 2020, endYear: 2020 },
      }),
    });
    const later = score({
      year: "2025",
      posting: posting({
        graduation: { startYear: 2025, endYear: null },
      }),
    });
    const earlier = score({
      year: "2027",
      posting: posting({
        graduation: { startYear: null, endYear: 2026 },
      }),
    });
    const unparsed = score({
      year: "Junior",
      posting: posting({
        graduation: { startYear: 2025, endYear: 2026 },
      }),
    });

    expect(inside.checks[0]).toEqual({
      name: "grad_year",
      passed: true,
      detail: "Graduation year 2020 is inside 2020–2020",
    });
    expect(inside.hardMismatch).toBeNull();
    expect(later.checks[0]?.detail).toBe(
      "Graduation year 2025 is inside 2025 or later",
    );
    expect(earlier.checks[0]).toEqual({
      name: "grad_year",
      passed: false,
      detail: "Graduation year 2027 is outside 2026 or earlier",
    });
    expect(earlier.hardMismatch).toBe(
      "Graduation year 2027 is outside 2026 or earlier",
    );
    expect(unparsed.checks).toEqual([]);
    expect(unparsed.hardMismatch).toBeNull();
  });

  it("matches locations by containment, remote, relocation, or the job location fallback", () => {
    const contained = score({
      preferredLocations: ["amherst"],
      posting: posting({ locations: ["Amherst, MA"] }),
    });
    const tooShort = score({
      preferredLocations: ["B"],
      posting: posting({ locations: ["Boston"] }),
    });
    const remote = score({
      preferredLocations: ["Boston"],
      posting: posting({ locations: ["New York"], remote: true }),
    });
    const relocating = score({
      openToRelocation: true,
      preferredLocations: ["Boston"],
      posting: posting({ locations: ["New York"] }),
    });
    const fallback = score({
      preferredLocations: ["Boston"],
      jobLocation: "Boston, MA",
      posting: posting({ locations: [] }),
    });
    const ignoresJobLocation = score({
      preferredLocations: ["Boston"],
      jobLocation: "Boston",
      posting: posting({ locations: ["New York"] }),
    });

    expect(contained.checks[0]).toEqual({
      name: "location",
      passed: true,
      detail: "Location matches Amherst, MA",
    });
    expect(tooShort.checks[0]?.detail).toBe(
      "Location does not match preferred locations",
    );
    expect(remote.checks[0]?.detail).toBe("Posting is remote");
    expect(relocating.checks[0]?.detail).toBe("Open to relocation");
    expect(fallback.checks[0]?.detail).toBe("Location matches Boston, MA");
    expect(ignoresJobLocation.checks[0]?.detail).toBe(
      "Location does not match preferred locations",
    );
  });

  it("skips location when the student lists no places and is not open to relocation", () => {
    const skipped = score({
      studentSkills: ["Python"],
      preferredLocations: ["  "],
      posting: posting({
        requiredSkills: ["Python"],
        locations: ["New York"],
        remote: true,
      }),
    });
    const relocating = score({
      studentSkills: ["Python"],
      openToRelocation: true,
      preferredLocations: [],
      posting: posting({
        requiredSkills: ["Python"],
        locations: ["New York"],
      }),
    });

    expect(skipped.checks).toEqual([]);
    expect(skipped.score).toBe(100);
    expect(relocating.checks).toEqual([
      { name: "location", passed: true, detail: "Open to relocation" },
    ]);
  });

  it("annualizes hourly pay at 2080 hours and compares yearly pay as stated", () => {
    const hourlyMeets = score({
      studentSkills: ["Python"],
      minPay: 80000,
      posting: posting({
        requiredSkills: ["Python"],
        pay: { min: 40, max: 50, interval: "hour" },
      }),
    });
    const hourlyBelow = score({
      studentSkills: ["Python"],
      minPay: 100000,
      posting: posting({
        requiredSkills: ["Python"],
        pay: { min: 40, max: 50, interval: "hour" },
      }),
    });
    const yearly = score({
      minPay: 80000,
      posting: posting({
        pay: { min: 80000, max: null, interval: "year" },
      }),
    });
    const below = score({
      minPay: 120000,
      posting: posting({
        pay: { min: 100000, max: 110000, interval: "year" },
      }),
    });

    // 40 * 2080 = 83200, which clears 80000 and misses 100000.
    // No preferred skills: 0.7R + 0.3Q. R = 1, Q = 0 → 70.
    expect(hourlyMeets.checks).toEqual([
      { name: "pay", passed: true, detail: "Pay meets minimum" },
    ]);
    expect(hourlyMeets.score).toBe(100);
    expect(hourlyBelow.score).toBe(70);
    expect(hourlyBelow.checks).toEqual([
      { name: "pay", passed: false, detail: "Pay is below your minimum" },
    ]);
    expect(yearly.checks).toEqual([
      { name: "pay", passed: true, detail: "Pay meets minimum" },
    ]);
    expect(below.checks).toEqual([
      { name: "pay", passed: false, detail: "Pay is below your minimum" },
    ]);
  });

  it("annualizes a stated monthly rate by multiplying by 12", () => {
    const meets = score({
      minPay: 50000,
      posting: posting({
        pay: { min: 6000, max: 7000, interval: "month" },
      }),
    });
    const below = score({
      minPay: 80000,
      posting: posting({
        pay: { min: 6000, max: 7000, interval: "month" },
      }),
    });

    // 6000 * 12 = 72000, which clears 50000 and misses 80000.
    expect(meets.checks).toEqual([
      { name: "pay", passed: true, detail: "Pay meets minimum" },
    ]);
    expect(below.checks).toEqual([
      { name: "pay", passed: false, detail: "Pay is below your minimum" },
    ]);
  });

  it("skips the pay check when the posting states no interval", () => {
    const stipend = score({
      minPay: 60000,
      posting: posting({
        pay: { min: 15000, max: null, interval: null },
      }),
    });
    const palantir = score({
      minPay: 60000,
      posting: posting({
        pay: { min: 10500, max: null, interval: null },
      }),
    });
    const looksYearly = score({
      minPay: 60000,
      posting: posting({
        pay: { min: 80000, max: null, interval: null },
      }),
    });

    expect(stipend.checks).toEqual([]);
    expect(palantir.checks).toEqual([]);
    expect(looksYearly.checks).toEqual([]);
  });
});

describe("isFeedRole", () => {
  it("hides role type other and keeps internship and new grad", () => {
    expect(isFeedRole("other")).toBe(false);
    expect(isFeedRole("internship")).toBe(true);
    expect(isFeedRole("new_grad")).toBe(true);
  });
});

describe("compareFeedItems", () => {
  it("sorts scored jobs, then N/A, then hard mismatches", () => {
    const items = [
      feedItem("m-low", 55, null),
      feedItem("m-na", null, null),
      feedItem("m-tie-b", 90, null),
      feedItem("m-hard-low", 10, "Graduation year 2024 is outside 2025–2026"),
      feedItem("m-high", 90, null),
      feedItem("m-hard", 40, "Needs sponsorship; posting won't sponsor"),
      feedItem("m-hard-na", null, "Needs sponsorship; posting won't sponsor"),
      feedItem("m-tie-a", 90, null),
    ];

    items.sort(compareFeedItems);

    expect(items.map((item) => item.job.id)).toEqual([
      "m-high",
      "m-tie-a",
      "m-tie-b",
      "m-low",
      "m-na",
      "m-hard",
      "m-hard-low",
      "m-hard-na",
    ]);
  });
});
