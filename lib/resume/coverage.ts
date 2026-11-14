import { canonicalize } from "../match/skills";
import {
  atsReportSchema,
  type AtsReport,
  type PostingExtraction,
} from "../types";

export const LOW_KEYWORD_COVERAGE = 0.5;

type Section = AtsReport["missingSections"][number];

const SECTION_ORDER: readonly Section[] = ["Education", "Experience", "Skills"];

function cleanToken(token: string): string {
  return token.replace(/^[^A-Za-z0-9+#.]+/, "").replace(/[^A-Za-z0-9+#.]+$/, "");
}

export function postingSkills(extraction: PostingExtraction): string[] {
  return canonicalize([
    ...extraction.requiredSkills,
    ...extraction.preferredSkills,
  ]).canonical;
}

export function skillsInResume(rawText: string): string[] {
  const tokens = rawText
    .split(/\s+/)
    .map(cleanToken)
    .filter((token) => token.length > 0);
  const grams: string[] = [];

  for (let start = 0; start < tokens.length; start++) {
    const parts: string[] = [];
    const last = Math.min(tokens.length, start + 4);
    for (let index = start; index < last; index++) {
      const token = tokens[index];
      if (token === undefined) break;
      parts.push(token);
      grams.push(parts.join(" "));
    }
  }

  return canonicalize(grams).canonical;
}

export function keywordCoverage(
  rawText: string,
  postingSkills: string[],
): number | null {
  if (postingSkills.length === 0) return null;
  const found = new Set(skillsInResume(rawText));
  let covered = 0;
  for (const skill of postingSkills) {
    if (found.has(skill)) covered += 1;
  }
  return covered / postingSkills.length;
}

export function buildJobAtsReport(input: {
  missingSections: readonly Section[];
  rawText: string;
  postingSkills: string[];
}): AtsReport {
  const missing = SECTION_ORDER.filter((section) =>
    input.missingSections.includes(section),
  );
  const coverage = keywordCoverage(input.rawText, input.postingSkills);
  const issues: AtsReport["issues"] = missing.map((section) => ({
    type: "missing_section",
    detail: `Possible issue: ${section} section heading is missing`,
  }));
  if (typeof coverage === "number" && coverage < LOW_KEYWORD_COVERAGE) {
    issues.push({
      type: "low_keyword_coverage",
      detail: "Possible issue: keyword coverage is below 50%",
    });
  }

  return atsReportSchema.parse({
    missingSections: missing,
    keywordCoverage: coverage,
    issues,
  });
}
