import { describe, expect, it } from "vitest";
import { finalizeResume } from "./parse";
import { parsedResumeSchema } from "../types";

function model(
  overrides: Partial<Parameters<typeof finalizeResume>[0]> = {},
): Parameters<typeof finalizeResume>[0] {
  return {
    academics: {
      year: null,
      majors: [],
      minors: [],
      honors: [],
      clubs: [],
    },
    experiences: [],
    skills: [],
    interests: [],
    ...overrides,
  };
}

describe("finalizeResume", () => {
  it("maps JS to JavaScript and Postgres to PostgreSQL on both skill lists", () => {
    const parsed = finalizeResume(
      model({
        skills: ["JS", "JavaScript", "Postgres"],
        experiences: [
          {
            company: "UMass Dining",
            position: "Barista",
            start_date: "May 2024",
            end_date: null,
            bullets: ["Opened the cafe"],
            skills: ["JS", "Postgres"],
          },
        ],
      }),
    );

    expect(parsed.skills).toEqual(["JavaScript", "PostgreSQL"]);
    expect(parsed.experiences[0]?.skills).toEqual(["JavaScript", "PostgreSQL"]);
    expect(parsed.experiences[0]?.start_date).toBe("May 2024");
    expect(parsed.experiences[0]?.end_date).toBeNull();
    expect(parsedResumeSchema.parse(parsed)).toEqual(parsed);
  });

  it("drops an unknown skill", () => {
    const parsed = finalizeResume(
      model({
        skills: ["Not A Real Skill", "JS"],
        experiences: [
          {
            company: "UMass Dining",
            position: "Barista",
            start_date: null,
            end_date: null,
            bullets: [],
            skills: ["Not A Real Skill"],
          },
        ],
      }),
    );

    expect(parsed.skills).toEqual(["JavaScript"]);
    expect(parsed.experiences[0]?.skills).toEqual([]);
    expect(parsed.skills).not.toContain("Not A Real Skill");
    expect(parsed.experiences[0]?.skills).not.toContain("Not A Real Skill");
  });

  it("does not map go to market to Go", () => {
    const parsed = finalizeResume(
      model({
        skills: ["go to market"],
        experiences: [
          {
            company: "UMass Dining",
            position: "Barista",
            start_date: null,
            end_date: null,
            bullets: [],
            skills: ["go to market"],
          },
        ],
      }),
    );

    expect(parsed.skills).not.toContain("Go");
    expect(parsed.experiences[0]?.skills).not.toContain("Go");
    expect(parsed.skills).toEqual([]);
    expect(parsed.experiences[0]?.skills).toEqual([]);
  });

  it("keeps the first 10 interests and passes parsedResumeSchema", () => {
    const interests = Array.from(
      { length: 12 },
      (_, index) => `Interest ${index + 1}`,
    );
    const parsed = finalizeResume(model({ interests }));

    expect(parsed.interests).toEqual(interests.slice(0, 10));
    expect(parsedResumeSchema.parse(parsed)).toEqual(parsed);
  });
});
