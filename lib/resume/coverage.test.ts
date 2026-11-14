import { describe, expect, it } from "vitest";
import { atsReportSchema, type PostingExtraction } from "../types";
import {
  buildJobAtsReport,
  keywordCoverage,
  postingSkills,
} from "./coverage";
import { missingSections } from "./sections";

function posting(
  requiredSkills: string[],
  preferredSkills: string[] = [],
): PostingExtraction {
  return {
    requiredSkills,
    preferredSkills,
    majors: [],
    graduation: null,
    locations: [],
    remote: false,
    sponsorship: "unknown",
    pay: null,
    roleType: "internship",
  };
}

const NO_SKILLS_HEADING = [
  "Education",
  "B.S. Computer Science, University of Massachusetts Amherst",
  "",
  "Work Experience",
  "Campus Cafe — Barista",
  "- Built an ordering tool",
].join("\n");

const POSTING_SKILLS = ["Python", "React", "Docker", "SQL"];

describe("buildJobAtsReport", () => {
  it("flags a missing Skills heading when Education and Work Experience are present", () => {
    const missing = missingSections(NO_SKILLS_HEADING);
    const report = buildJobAtsReport({
      missingSections: missing,
      rawText: NO_SKILLS_HEADING,
      postingSkills: [],
    });

    expect(missing).toContain("Skills");
    expect(report.missingSections).toContain("Skills");
    expect(report.issues).toContainEqual({
      type: "missing_section",
      detail: "Possible issue: Skills section heading is missing",
    });
  });

  it("reports 0.5 coverage and does not flag the 50% boundary", () => {
    const report = buildJobAtsReport({
      missingSections: [],
      rawText: "Python, React",
      postingSkills: POSTING_SKILLS,
    });

    expect(report.keywordCoverage).toBe(0.5);
    expect(
      report.issues.some((issue) => issue.type === "low_keyword_coverage"),
    ).toBe(false);
  });

  it("flags coverage below 50% when only Python is present", () => {
    const report = buildJobAtsReport({
      missingSections: [],
      rawText: "Python",
      postingSkills: POSTING_SKILLS,
    });
    const issue = report.issues.find(
      (item) => item.type === "low_keyword_coverage",
    );

    expect(report.keywordCoverage).toBe(0.25);
    expect(issue?.detail.startsWith("Possible issue")).toBe(true);
  });

  it("counts JS in the resume as the JavaScript posting skill", () => {
    expect(keywordCoverage("JS", ["JavaScript"])).toBe(1);
  });

  it("does not treat go to market as Go, R&D as R, or C++ as C", () => {
    expect(keywordCoverage("go to market", ["Go"])).toBe(0);
    expect(keywordCoverage("R&D", ["R"])).toBe(0);
    expect(keywordCoverage("C++", ["C++"])).toBe(1);
    expect(keywordCoverage("C++", ["C"])).toBe(0);
  });

  it("returns null coverage and still returns section issues when the posting has no skills", () => {
    const report = buildJobAtsReport({
      missingSections: missingSections(NO_SKILLS_HEADING),
      rawText: NO_SKILLS_HEADING,
      postingSkills: postingSkills(posting([], [])),
    });

    expect(report.keywordCoverage).toBeNull();
    expect(
      report.issues.some((issue) => issue.type === "low_keyword_coverage"),
    ).toBe(false);
    expect(report.issues).toContainEqual({
      type: "missing_section",
      detail: "Possible issue: Skills section heading is missing",
    });
  });

  it("counts JavaScript once when it is both required and preferred", () => {
    const skills = postingSkills(posting(["JavaScript"], ["JavaScript"]));

    expect(skills).toEqual(["JavaScript"]);
    expect(keywordCoverage("JavaScript", skills)).toBe(1);
  });

  it("matches multi-word skills from consecutive tokens", () => {
    expect(
      keywordCoverage("Shipped Tailwind CSS and Ruby on Rails apps", [
        "Tailwind CSS",
        "Ruby on Rails",
      ]),
    ).toBe(1);
  });

  it("parses as an AtsReport", () => {
    const report = buildJobAtsReport({
      missingSections: ["Skills", "Education"],
      rawText: "Python",
      postingSkills: POSTING_SKILLS,
    });

    expect(report.missingSections).toEqual(["Education", "Skills"]);
    expect(report.issues.map((issue) => issue.detail)).toEqual([
      "Possible issue: Education section heading is missing",
      "Possible issue: Skills section heading is missing",
      "Possible issue: keyword coverage is below 50%",
    ]);
    expect(atsReportSchema.parse(report)).toEqual(report);
  });
});
