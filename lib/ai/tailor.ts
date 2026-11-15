import { z } from "zod";
import type { BulletDiff } from "../types";
import { checkBullet } from "../resume/fabrication";
import { canonicalize } from "../match/skills";
import { callGeminiJSON } from "./gemini";

const rewriteModelSchema = z.object({
  rewrites: z.array(
    z.object({
      id: z.string(),
      after: z.string(),
    }),
  ),
});

type RewriteResponse = z.infer<typeof rewriteModelSchema>;

export type TailorCall = (
  schema: z.ZodType<RewriteResponse>,
  prompt: string,
  opts?: { timeoutMs?: number },
) => Promise<RewriteResponse>;

export type TailorBullet = {
  id: string;
  experienceIndex: number;
  bulletIndex: number;
  company: string;
  position: string;
  before: string;
};

export type TailorInput = {
  jobTitle: string;
  company: string;
  emphasis: string[];
  interests: string[];
  bullets: TailorBullet[];
  knownEmployers: string[];
};

export type BlockedRewrite = {
  before: string;
  attempted: string;
  reason: string;
};

export type RetryRewrite = {
  id: string;
  before: string;
  attempted: string;
  reason: string;
};

const MAX_REWRITES = 3;

const RULES = [
  "Rephrase only. Return the full replacement bullet in after, not a word diff.",
  "Copy id exactly.",
  "Return rewrites for up to 3 existing bullets that best fit this posting. Put the best fit first.",
  "A bullet that already matches the posting can still be rephrased to use the posting's wording.",
  "Change the wording. Do not return a bullet unchanged.",
  "Emphasize an emphasis-list skill only when that same bullet already contains it.",
  "Do not add a skill, tool, employer, or number that is not already in that bullet.",
  "Do not move a skill from another bullet, the profile, or the posting into this bullet.",
  "Do not invent metrics, percentages, or counts.",
  "Omit a bullet only when it cannot be rephrased without adding a skill, employer, or number.",
];

export function collectBullets(
  experiences: { company: string; position: string; bullets: string[] }[],
): TailorBullet[] {
  const collected: TailorBullet[] = [];
  experiences.forEach((experience, experienceIndex) => {
    experience.bullets.forEach((before, bulletIndex) => {
      if (before.trim() === "") return;
      collected.push({
        id: `${experienceIndex}:${bulletIndex}`,
        experienceIndex,
        bulletIndex,
        company: experience.company,
        position: experience.position,
        before,
      });
    });
  });
  return collected;
}

export function emphasisSkills(
  studentSkills: string[],
  posting: { requiredSkills: string[]; preferredSkills: string[] },
): string[] {
  const student = new Set(canonicalize(studentSkills).canonical);
  return canonicalize([
    ...posting.requiredSkills,
    ...posting.preferredSkills,
  ]).canonical.filter((skill) => student.has(skill));
}

export function knownEmployers(names: string[]): string[] {
  const employers: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const trimmed = name.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    employers.push(trimmed);
  }
  return employers;
}

function keepFirstRewrites(
  bullets: TailorBullet[],
  rewrites: { id: string; after: string }[],
  limit: number,
): { id: string; after: string }[] {
  const known = new Set(bullets.map((bullet) => bullet.id));
  const keep = new Set<string>();
  for (const rewrite of rewrites) {
    if (!known.has(rewrite.id) || keep.has(rewrite.id)) continue;
    keep.add(rewrite.id);
    if (keep.size === limit) break;
  }
  return rewrites.filter((rewrite) => keep.has(rewrite.id));
}

function lastRewrite(rewrites: { id: string; after: string }[]): Map<string, string> {
  const byId = new Map<string, string>();
  for (const rewrite of rewrites) byId.set(rewrite.id, rewrite.after);
  return byId;
}

export function settleRewrites(
  bullets: TailorBullet[],
  rewrites: { id: string; after: string }[],
  employers: string[],
): { diffs: BulletDiff[]; retry: RetryRewrite[]; blocked: BlockedRewrite[] } {
  const byId = lastRewrite(rewrites);
  const diffs: BulletDiff[] = [];
  const retry: RetryRewrite[] = [];

  for (const bullet of bullets) {
    const after = byId.get(bullet.id);
    if (after === undefined) continue;
    if (after.trim() === bullet.before.trim()) continue;
    if (after.trim() === "") {
      retry.push({
        id: bullet.id,
        before: bullet.before,
        attempted: after,
        reason: "empty rewrite",
      });
      continue;
    }

    const check = checkBullet(bullet.before, after, employers);
    if (check.ok) {
      diffs.push({
        id: bullet.id,
        experienceIndex: bullet.experienceIndex,
        before: bullet.before,
        after,
        status: "proposed",
      });
      continue;
    }

    retry.push({
      id: bullet.id,
      before: bullet.before,
      attempted: after,
      reason: check.reasons.join("; "),
    });
  }

  return { diffs, retry, blocked: [] };
}

function contextLines(input: TailorInput): string[] {
  return [
    `Job title: ${input.jobTitle}`,
    `Company: ${input.company}`,
    `Emphasis skills: ${JSON.stringify(input.emphasis)}`,
    `Interests: ${JSON.stringify(input.interests)}`,
  ];
}

function promptFor(input: TailorInput): string {
  const bullets = input.bullets.map((item) => ({
    id: item.id,
    company: item.company,
    position: item.position,
    before: item.before,
  }));
  return [...RULES, ...contextLines(input), "Bullets:", JSON.stringify(bullets)].join(
    "\n",
  );
}

function retryPrompt(input: TailorInput, retry: RetryRewrite[]): string {
  const bullets = retry.map((item) => ({
    id: item.id,
    before: item.before,
    attempted: item.attempted,
    reason: item.reason,
  }));
  return [
    ...RULES,
    "The previous rewrite failed a fabrication check. Rewrite only these bullets.",
    "Each bullet includes id, before, attempted after, and reason.",
    ...contextLines(input),
    "Bullets:",
    JSON.stringify(bullets),
  ].join("\n");
}

function toBlocked(item: RetryRewrite): BlockedRewrite {
  return {
    before: item.before,
    attempted: item.attempted,
    reason: item.reason,
  };
}

function outcome(
  bullets: TailorBullet[],
  diffs: BulletDiff[],
  blocked: BlockedRewrite[],
): { diffs: BulletDiff[]; blocked: BlockedRewrite[]; rejectedCount: number } {
  const diffById = new Map(diffs.map((diff) => [diff.id, diff]));
  return {
    diffs: bullets.flatMap((item) => {
      const diff = diffById.get(item.id);
      return diff ? [diff] : [];
    }),
    blocked,
    rejectedCount: blocked.length,
  };
}

const defaultCall: TailorCall = (schema, prompt, opts) =>
  callGeminiJSON(schema, prompt, opts);

export async function tailorBullets(
  input: TailorInput,
  call: TailorCall = defaultCall,
): Promise<{ diffs: BulletDiff[]; blocked: BlockedRewrite[]; rejectedCount: number }> {
  const first = await call(rewriteModelSchema, promptFor(input), { timeoutMs: 8000 });
  const settled = settleRewrites(
    input.bullets,
    keepFirstRewrites(input.bullets, first.rewrites, MAX_REWRITES),
    input.knownEmployers,
  );
  if (settled.retry.length === 0) {
    return outcome(input.bullets, settled.diffs, settled.blocked);
  }

  try {
    const second = await call(rewriteModelSchema, retryPrompt(input, settled.retry), {
      timeoutMs: 5000,
    });
    const retryBullets = input.bullets.filter((item) =>
      settled.retry.some((retry) => retry.id === item.id),
    );
    const retried = settleRewrites(retryBullets, second.rewrites, input.knownEmployers);
    return outcome(
      input.bullets,
      [...settled.diffs, ...retried.diffs],
      [
        ...settled.blocked,
        ...retried.blocked,
        ...retried.retry.map(toBlocked),
      ],
    );
  } catch {
    return outcome(input.bullets, settled.diffs, [
      ...settled.blocked,
      ...settled.retry.map(toBlocked),
    ]);
  }
}

export function applyDecisions(
  diffs: BulletDiff[],
  decisions: { id: string; status: "accepted" | "rejected" }[],
): { diffs: BulletDiff[] } | { error: "Unknown bullet" } {
  const ids = new Set(diffs.map((diff) => diff.id));
  for (const decision of decisions) {
    if (!ids.has(decision.id)) return { error: "Unknown bullet" };
  }

  const statusById = new Map<string, "accepted" | "rejected">();
  for (const decision of decisions) statusById.set(decision.id, decision.status);

  return {
    diffs: diffs.map((diff) => {
      const status = statusById.get(diff.id);
      if (!status) return diff;
      return { ...diff, status };
    }),
  };
}
