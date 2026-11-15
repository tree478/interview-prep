import { atsReportSchema, type AtsReport } from "../types";

type Section = AtsReport["missingSections"][number];

// A heading is its own short line. Case, "&", and other punctuation are ignored.
const SECTION_LABELS: { section: Section; labels: readonly string[] }[] = [
  { section: "Education", labels: ["education"] },
  {
    section: "Experience",
    labels: [
      "work experience",
      "professional experience",
      "technical experience",
      "research experience",
      "experience",
      "employment",
      "work history",
      "internships",
    ],
  },
  {
    section: "Skills",
    labels: [
      "technical skills",
      "skills & tools",
      "languages & tools",
      "technologies",
      "core competencies",
      "skills",
    ],
  },
];

const SECTION_ORDER: readonly Section[] = ["Education", "Experience", "Skills"];

const MAX_HEADING_LENGTH = 40;

function normalizeHeading(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesHeading(line: string, label: string): boolean {
  return normalizeHeading(line) === normalizeHeading(label);
}

export function missingSections(rawText: string): Section[] {
  const found = new Set<Section>();

  for (const line of rawText.split(/\r\n|\n|\r/)) {
    const heading = line.trim().toLowerCase();
    if (heading.length === 0 || heading.length >= MAX_HEADING_LENGTH) continue;

    for (const { section, labels } of SECTION_LABELS) {
      if (found.has(section)) continue;
      if (labels.some((label) => matchesHeading(heading, label))) {
        found.add(section);
      }
    }
  }

  return SECTION_ORDER.filter((section) => !found.has(section));
}

export function buildAtsReport(rawText: string): AtsReport {
  const missing = missingSections(rawText);
  return atsReportSchema.parse({
    missingSections: missing,
    keywordCoverage: null,
    issues: missing.map((section) => ({
      type: "missing_section" as const,
      detail: `Possible issue: ${section} section heading is missing`,
    })),
  });
}
