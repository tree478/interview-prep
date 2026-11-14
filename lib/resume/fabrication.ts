import { skillsInResume } from "./coverage";
import { extractNumbers } from "./numbers";

export type BulletCheck = {
  ok: boolean;
  reasons: string[];
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function employerIn(text: string, name: string): boolean {
  const parts = name.trim().split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) return false;
  const pattern = new RegExp(`\\b${parts.map(escapeRegExp).join("\\s+")}\\b`, "i");
  return pattern.test(text);
}

function addedSkills(original: string, rewritten: string): string[] {
  const before = new Set(skillsInResume(original));
  const added = skillsInResume(rewritten).filter((skill) => !before.has(skill));
  return [...new Set(added)].sort();
}

function addedEmployers(
  original: string,
  rewritten: string,
  knownEmployers: string[],
): string[] {
  const added: string[] = [];
  const seen = new Set<string>();
  for (const name of knownEmployers) {
    const trimmed = name.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    if (!employerIn(rewritten, trimmed) || employerIn(original, trimmed)) continue;
    added.push(trimmed);
  }
  return added;
}

function addedNumbers(original: string, rewritten: string): string[] {
  const before = new Set(extractNumbers(original));
  return extractNumbers(rewritten).filter((value) => !before.has(value));
}

export function checkBullet(
  original: string,
  rewritten: string,
  knownEmployers: string[],
): BulletCheck {
  const reasons = [
    ...addedSkills(original, rewritten).map((skill) => `added skill: ${skill}`),
    ...addedEmployers(original, rewritten, knownEmployers).map(
      (name) => `added employer: ${name}`,
    ),
    ...addedNumbers(original, rewritten).map((value) => `added number: ${value}`),
  ];
  return { ok: reasons.length === 0, reasons };
}
