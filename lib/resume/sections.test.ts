import { describe, expect, it } from "vitest";
import { atsReportSchema } from "../types";
import { buildAtsReport, missingSections } from "./sections";

const FULL_RESUME = [
  "Education:",
  "B.S. Computer Science, University of Massachusetts Amherst",
  "",
  "Work Experience",
  "Campus Cafe — Barista",
  "- Built skills in Python",
  "",
  "Skills",
  "Python, JavaScript",
].join("\n");

describe("missingSections", () => {
  it("returns nothing when Education, Experience, and Skills headings are present", () => {
    expect(missingSections(FULL_RESUME)).toEqual([]);
  });

  it("treats skills mentioned only inside a bullet as a missing Skills heading", () => {
    const text = [
      "Education",
      "University of Massachusetts Amherst",
      "",
      "Work Experience",
      "- Built skills in Python",
    ].join("\n");
    expect(missingSections(text)).toContain("Skills");
    expect(missingSections(text)).not.toContain("Education");
    expect(missingSections(text)).not.toContain("Experience");
  });

  it("counts TECHNICAL SKILLS as a Skills heading", () => {
    const text = [
      "Education",
      "University of Massachusetts Amherst",
      "",
      "Work Experience",
      "Research assistant",
      "",
      "TECHNICAL SKILLS",
      "Python",
    ].join("\n");
    expect(missingSections(text)).not.toContain("Skills");
  });

  it("counts WORK EXPERIENCE as an Experience heading", () => {
    const text = [
      "Education",
      "University of Massachusetts Amherst",
      "",
      "WORK EXPERIENCE",
      "Research assistant",
      "",
      "Skills",
      "Python",
    ].join("\n");
    expect(missingSections(text)).not.toContain("Experience");
  });

  it("counts Professional Experience as an Experience heading", () => {
    const text = [
      "Education",
      "University of Massachusetts Amherst",
      "",
      "Professional Experience",
      "Research assistant",
      "",
      "Skills",
      "Python",
    ].join("\n");
    expect(missingSections(text)).not.toContain("Experience");
  });

  it("counts common experience headings such as TECHNICAL EXPERIENCE", () => {
    for (const heading of [
      "TECHNICAL EXPERIENCE",
      "Experience",
      "Research Experience",
      "Employment",
      "Work History",
      "Internships:",
    ]) {
      const text = [
        "Education",
        "University of Massachusetts Amherst",
        "",
        heading,
        "Research assistant",
        "",
        "Skills",
        "Python",
      ].join("\n");
      expect(missingSections(text), heading).not.toContain("Experience");
    }
  });

  it("counts skills headings when case or an ampersand differs", () => {
    for (const heading of [
      "SKILLS & TOOLS",
      "Languages and Tools",
      "Technologies",
      "Core Competencies",
    ]) {
      const text = [
        "Education",
        "University of Massachusetts Amherst",
        "",
        "Work Experience",
        "Research assistant",
        "",
        heading,
        "Python",
      ].join("\n");
      expect(missingSections(text), heading).not.toContain("Skills");
    }
  });
});

describe("buildAtsReport", () => {
  it("sets keyword coverage to null and one missing-section issue per heading", () => {
    const text = ["Education", "University of Massachusetts Amherst"].join("\n");
    const report = buildAtsReport(text);

    expect(report.missingSections).toEqual(["Experience", "Skills"]);
    expect(report.keywordCoverage).toBeNull();
    expect(report.issues).toEqual([
      {
        type: "missing_section",
        detail: "Possible issue: Experience section heading is missing",
      },
      {
        type: "missing_section",
        detail: "Possible issue: Skills section heading is missing",
      },
    ]);
    expect(atsReportSchema.parse(report)).toEqual(report);
  });

  it("returns no issues when every heading is present", () => {
    const report = buildAtsReport(FULL_RESUME);
    expect(report).toEqual({
      missingSections: [],
      keywordCoverage: null,
      issues: [],
    });
  });
});
