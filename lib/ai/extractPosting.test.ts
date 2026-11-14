import { describe, expect, it } from "vitest";
import { finalizeExtraction, promptFor } from "./extractPosting";

function raw(
  overrides: Partial<Parameters<typeof finalizeExtraction>[0]> = {},
): Parameters<typeof finalizeExtraction>[0] {
  return {
    requiredSkills: [],
    preferredSkills: [],
    majors: [],
    graduationStartYear: null,
    graduationEndYear: null,
    locations: [],
    remote: false,
    sponsorship: "unknown",
    payMin: null,
    payMax: null,
    payInterval: null,
    roleType: "internship",
    ...overrides,
  };
}

describe("finalizeExtraction", () => {
  it("maps JS to JavaScript in requiredSkills", () => {
    const { extraction, dropped } = finalizeExtraction(
      raw({ requiredSkills: ["JS"] }),
    );
    expect(extraction.requiredSkills).toContain("JavaScript");
    expect(extraction.preferredSkills).not.toContain("JavaScript");
    expect(dropped).not.toContain("JS");
  });

  it("maps Postgres to PostgreSQL", () => {
    const { extraction } = finalizeExtraction(
      raw({ requiredSkills: ["Postgres"] }),
    );
    expect(extraction.requiredSkills).toContain("PostgreSQL");
  });

  it("drops a skill that is not in data/skills.json", () => {
    const { extraction, dropped } = finalizeExtraction(
      raw({
        requiredSkills: ["Not A Real Skill"],
        preferredSkills: ["Not A Real Skill", "Also Not Real"],
      }),
    );
    expect(extraction.requiredSkills).toEqual([]);
    expect(extraction.preferredSkills).toEqual([]);
    expect(dropped).toEqual(["Not A Real Skill", "Also Not Real"]);
  });

  it("drops go to market and does not match Go", () => {
    const { extraction, dropped } = finalizeExtraction(
      raw({ requiredSkills: ["go to market"] }),
    );
    expect(dropped).toContain("go to market");
    expect(extraction.requiredSkills).not.toContain("Go");
    expect(extraction.preferredSkills).not.toContain("Go");
  });

  it("dedupes JS and JavaScript to one JavaScript", () => {
    const { extraction } = finalizeExtraction(
      raw({ requiredSkills: ["JS", "JavaScript"] }),
    );
    expect(extraction.requiredSkills).toEqual(["JavaScript"]);
  });

  it("keeps a skill only in requiredSkills when it is also preferred", () => {
    const { extraction, dropped } = finalizeExtraction(
      raw({
        requiredSkills: ["JS"],
        preferredSkills: ["JavaScript", "Postgres"],
      }),
    );
    expect(extraction.requiredSkills).toEqual(["JavaScript"]);
    expect(extraction.preferredSkills).toEqual(["PostgreSQL"]);
    expect(dropped).toEqual([]);
  });

  it("keeps unstated sponsorship as unknown", () => {
    const { extraction } = finalizeExtraction(raw({ sponsorship: "unknown" }));
    expect(extraction.sponsorship).toBe("unknown");
  });

  it("sets pay to null when every pay field is null", () => {
    const { extraction } = finalizeExtraction(
      raw({ payMin: null, payMax: null, payInterval: null }),
    );
    expect(extraction.pay).toBeNull();
  });

  it("keeps pay when a number is stated", () => {
    const { extraction } = finalizeExtraction(
      raw({ payMin: 48, payMax: null, payInterval: null }),
    );
    expect(extraction.pay).toEqual({ min: 48, max: null, interval: null });
  });

  it("keeps a monthly interval instead of forcing hour or year", () => {
    const { extraction } = finalizeExtraction(
      raw({ payMin: 6000, payMax: 8000, payInterval: "month" }),
    );
    expect(extraction.pay).toEqual({ min: 6000, max: 8000, interval: "month" });
  });

  it("tells the model to label monthly pay as month", () => {
    const prompt = promptFor({
      title: "Intern",
      company: "Acme",
      location: null,
      description: "Pay is $6,000 per month.",
    });
    expect(prompt).toContain('"month"');
  });

  it("sets graduation to null when both years are null", () => {
    const { extraction } = finalizeExtraction(
      raw({ graduationStartYear: null, graduationEndYear: null }),
    );
    expect(extraction.graduation).toBeNull();
  });

  it("keeps graduation when a year is stated", () => {
    const { extraction } = finalizeExtraction(
      raw({ graduationStartYear: null, graduationEndYear: 2027 }),
    );
    expect(extraction.graduation).toEqual({ startYear: null, endYear: 2027 });
  });
});
