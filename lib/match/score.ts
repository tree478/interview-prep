import type {
  FeedItem,
  MatchResult,
  PostingExtraction,
  RequirementCheck,
  RoleType,
} from "../types";
import { canonicalize } from "./skills";

const HOURS_PER_YEAR = 2080;

export type ScoreMatchInput = {
  studentSkills: string[];
  year: string | null;
  majors: string[];
  needsSponsorship: boolean;
  openToRelocation: boolean;
  preferredLocations: string[];
  minPay: number | null;
  posting: PostingExtraction;
  jobLocation: string | null;
};

export function scoreMatch(input: ScoreMatchInput): MatchResult {
  const required = canonicalize(input.posting.requiredSkills).canonical;
  const preferred = canonicalize(input.posting.preferredSkills).canonical;
  const student = new Set(canonicalize(input.studentSkills).canonical);
  const requiredCoverage = splitCoverage(required, student);
  const preferredCoverage = splitCoverage(preferred, student);
  const checks = requirementChecks(input);

  let score: number | null = null;
  if (required.length > 0) {
    const ratio = requiredCoverage.covered.length / required.length;
    let weightRequired = 0.5;
    let weightPreferred = 0.2;
    let weightChecks = 0.3;
    if (preferred.length === 0) {
      weightRequired += weightPreferred;
      weightPreferred = 0;
    }
    if (checks.length === 0) {
      weightRequired += weightChecks;
      weightChecks = 0;
    }
    const preferredRatio =
      preferred.length === 0
        ? 0
        : preferredCoverage.covered.length / preferred.length;
    const passed = checks.filter((check) => check.passed).length;
    const checkRatio = checks.length === 0 ? 0 : passed / checks.length;
    const raw = Math.round(
      100 *
        (weightRequired * ratio +
          weightPreferred * preferredRatio +
          weightChecks * checkRatio),
    );
    score = Math.min(100, Math.max(0, raw));
  }

  const hardMismatch = hardMismatchReason(input, checks);
  if (hardMismatch && score != null) {
    score = Math.min(score, 40);
  }

  return {
    score,
    covered: requiredCoverage.covered,
    missing: requiredCoverage.missing,
    preferredCovered: preferredCoverage.covered,
    preferredMissing: preferredCoverage.missing,
    checks,
    hardMismatch,
  };
}

export function compareFeedItems(a: FeedItem, b: FeedItem): number {
  const rankA = feedRank(a);
  const rankB = feedRank(b);
  if (rankA !== rankB) return rankA - rankB;

  if (
    a.match.score != null &&
    b.match.score != null &&
    a.match.score !== b.match.score
  ) {
    return b.match.score - a.match.score;
  }

  if (a.job.id < b.job.id) return -1;
  if (a.job.id > b.job.id) return 1;
  return 0;
}

function splitCoverage(
  skills: string[],
  student: Set<string>,
): { covered: string[]; missing: string[] } {
  const covered: string[] = [];
  const missing: string[] = [];
  for (const skill of skills) {
    if (student.has(skill)) covered.push(skill);
    else missing.push(skill);
  }
  return { covered, missing };
}

function requirementChecks(input: ScoreMatchInput): RequirementCheck[] {
  const checks: RequirementCheck[] = [];
  const { posting } = input;

  if (posting.majors.length > 0) {
    checks.push(majorCheck(input.majors, posting.majors));
  }

  const graduation = graduationCheck(input.year, posting);
  if (graduation) checks.push(graduation);

  if (
    hasLocationPreference(input) &&
    locationApplies(posting, input.jobLocation)
  ) {
    checks.push(locationCheck(input));
  }

  if (posting.sponsorship === "yes" || posting.sponsorship === "no") {
    checks.push(sponsorshipCheck(input.needsSponsorship, posting.sponsorship));
  }

  const pay = payCheck(input.minPay, posting);
  if (pay) checks.push(pay);

  return checks;
}

function majorCheck(studentMajors: string[], postingMajors: string[]): RequirementCheck {
  for (const major of studentMajors) {
    const trimmed = major.trim();
    const key = trimmed.toLowerCase();
    if (!key) continue;
    const matched = postingMajors.some(
      (posted) => posted.trim().toLowerCase() === key,
    );
    if (matched) {
      return { name: "major", passed: true, detail: `Major matches: ${trimmed}` };
    }
  }

  const listed = postingMajors.map((major) => major.trim()).join(", ");
  return {
    name: "major",
    passed: false,
    detail: `Major does not match posting (${listed})`,
  };
}

function graduationCheck(
  yearText: string | null,
  posting: PostingExtraction,
): RequirementCheck | null {
  const graduation = posting.graduation;
  if (!graduation) return null;
  const { startYear, endYear } = graduation;
  if (startYear == null && endYear == null) return null;

  const year = statedGraduationYear(yearText);
  if (year == null) return null;

  const window = graduationWindow(startYear, endYear);
  const inside =
    (startYear == null || year >= startYear) &&
    (endYear == null || year <= endYear);
  return {
    name: "grad_year",
    passed: inside,
    detail: inside
      ? `Graduation year ${year} is inside ${window}`
      : `Graduation year ${year} is outside ${window}`,
  };
}

function statedGraduationYear(yearText: string | null): number | null {
  if (!yearText) return null;
  const match = yearText.match(/20\d{2}/);
  if (!match) return null;
  return Number(match[0]);
}

function graduationWindow(startYear: number | null, endYear: number | null): string {
  if (startYear != null && endYear != null) return `${startYear}–${endYear}`;
  if (startYear != null) return `${startYear} or later`;
  return `${endYear} or earlier`;
}

function hasLocationPreference(input: ScoreMatchInput): boolean {
  if (input.openToRelocation) return true;
  return input.preferredLocations.some((place) => place.trim() !== "");
}

function locationApplies(
  posting: PostingExtraction,
  jobLocation: string | null,
): boolean {
  if (posting.remote) return true;
  if (posting.locations.length > 0) return true;
  return jobLocation != null && jobLocation.trim() !== "";
}

function locationCheck(input: ScoreMatchInput): RequirementCheck {
  if (input.posting.remote) {
    return { name: "location", passed: true, detail: "Posting is remote" };
  }
  if (input.openToRelocation) {
    return { name: "location", passed: true, detail: "Open to relocation" };
  }

  const stated =
    input.posting.locations.length > 0
      ? input.posting.locations
      : input.jobLocation
        ? [input.jobLocation]
        : [];
  const place = matchingPlace(input.preferredLocations, stated);
  if (place) {
    return { name: "location", passed: true, detail: `Location matches ${place}` };
  }
  return {
    name: "location",
    passed: false,
    detail: "Location does not match preferred locations",
  };
}

function matchingPlace(preferred: string[], stated: string[]): string | null {
  for (const place of stated) {
    const statedNorm = place.trim().toLowerCase();
    if (statedNorm.length < 2) continue;
    for (const pref of preferred) {
      const prefNorm = pref.trim().toLowerCase();
      if (prefNorm.length < 2) continue;
      if (statedNorm.includes(prefNorm) || prefNorm.includes(statedNorm)) {
        return place.trim();
      }
    }
  }
  return null;
}

function sponsorshipCheck(
  needsSponsorship: boolean,
  sponsorship: "yes" | "no",
): RequirementCheck {
  if (sponsorship === "yes") {
    return { name: "sponsorship", passed: true, detail: "Posting sponsors" };
  }
  if (!needsSponsorship) {
    return {
      name: "sponsorship",
      passed: true,
      detail: "Sponsorship not needed",
    };
  }
  return {
    name: "sponsorship",
    passed: false,
    detail: "Needs sponsorship; posting won't sponsor",
  };
}

function yearlyAmount(pay: NonNullable<PostingExtraction["pay"]>): number | null {
  if (pay.min == null || !Number.isFinite(pay.min)) return null;
  if (pay.interval === "year" || pay.interval === null) return pay.min;
  if (pay.interval === "hour") return pay.min * HOURS_PER_YEAR;
  return null;
}

function payCheck(
  minPay: number | null,
  posting: PostingExtraction,
): RequirementCheck | null {
  const pay = posting.pay;
  if (minPay == null || !Number.isFinite(minPay) || pay == null) return null;
  const yearly = yearlyAmount(pay);
  if (yearly == null) return null;

  const passed = yearly >= minPay;
  return {
    name: "pay",
    passed,
    detail: passed ? "Pay meets minimum" : "Pay is below your minimum",
  };
}

function hardMismatchReason(
  input: ScoreMatchInput,
  checks: RequirementCheck[],
): string | null {
  const reasons: string[] = [];
  if (input.needsSponsorship && input.posting.sponsorship === "no") {
    reasons.push("Needs sponsorship; posting won't sponsor");
  }
  const gradYear = checks.find((check) => check.name === "grad_year");
  if (gradYear && !gradYear.passed) reasons.push(gradYear.detail);
  return reasons.length > 0 ? reasons.join("; ") : null;
}

export function isFeedRole(roleType: RoleType): boolean {
  return roleType !== "other";
}

function feedRank(item: FeedItem): number {
  const hard = item.match.hardMismatch != null;
  const unscored = item.match.score == null;
  if (!hard && !unscored) return 0;
  if (!hard && unscored) return 1;
  if (hard && !unscored) return 2;
  return 3;
}
