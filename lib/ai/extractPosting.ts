import { z } from "zod";
import { callGeminiJSON } from "./gemini";
import { canonicalize } from "../match/skills";
import {
  payIntervalSchema,
  postingExtractionSchema,
  roleTypeSchema,
  sponsorshipSchema,
  type PostingExtraction,
} from "../types";

export { postingExtractionSchema, type PostingExtraction };

const DESCRIPTION_LIMIT = 15_000;

const postingModelSchema = z.object({
  requiredSkills: z.array(z.string()),
  preferredSkills: z.array(z.string()),
  majors: z.array(z.string()),
  graduationStartYear: z.number().int().nullable(),
  graduationEndYear: z.number().int().nullable(),
  locations: z.array(z.string()),
  remote: z.boolean(),
  sponsorship: sponsorshipSchema,
  payMin: z.number().nullable(),
  payMax: z.number().nullable(),
  payInterval: payIntervalSchema.nullable(),
  roleType: roleTypeSchema,
});

export function finalizeExtraction(
  raw: z.infer<typeof postingModelSchema>,
): { extraction: PostingExtraction; dropped: string[] } {
  const required = canonicalize(raw.requiredSkills);
  const preferred = canonicalize(raw.preferredSkills);
  const requiredSkills = new Set(required.canonical);
  const preferredSkills = preferred.canonical.filter(
    (skill) => !requiredSkills.has(skill),
  );

  const dropped: string[] = [];
  const seenDropped = new Set<string>();
  for (const skill of [...required.dropped, ...preferred.dropped]) {
    if (seenDropped.has(skill)) continue;
    seenDropped.add(skill);
    dropped.push(skill);
  }

  const graduation =
    raw.graduationStartYear === null && raw.graduationEndYear === null
      ? null
      : {
          startYear: raw.graduationStartYear,
          endYear: raw.graduationEndYear,
        };

  const pay =
    raw.payMin === null && raw.payMax === null && raw.payInterval === null
      ? null
      : {
          min: raw.payMin,
          max: raw.payMax,
          interval: raw.payInterval,
        };

  const extraction = postingExtractionSchema.parse({
    requiredSkills: required.canonical,
    preferredSkills,
    majors: raw.majors,
    graduation,
    locations: raw.locations,
    remote: raw.remote,
    sponsorship: raw.sponsorship,
    pay,
    roleType: raw.roleType,
  });

  return { extraction, dropped };
}

export function promptFor(job: {
  title: string;
  company: string;
  location: string | null;
  description: string;
}): string {
  const description =
    job.description.length > DESCRIPTION_LIMIT
      ? job.description.slice(0, DESCRIPTION_LIMIT)
      : job.description;

  return [
    "Extract structured fields from this job posting.",
    "Use only the title, company, location, and description. Do not invent.",
    "Copy skill names as written. Do not canonicalize and do not drop unknown skills. Code does that.",
    "Each entry is one skill, tool, language, or subject the posting names, not the sentence around it. If a sentence names several, return each name as its own entry.",
    "Put skills described as required, must, or qualifications in requiredSkills. Put skills described as preferred, nice to have, or bonus in preferredSkills. If the posting does not split them, put the listed skills in requiredSkills and leave preferredSkills empty.",
    "Include a major in majors only if the posting names it.",
    'Set graduationStartYear and graduationEndYear only when the posting states graduation years, such as "class of 2026" or "graduating 2026 or 2027". If it does not state years, set both to null.',
    'Set sponsorship to "yes" only if the posting says they sponsor work authorization. Set it to "no" only if the posting says they will not sponsor. Otherwise set sponsorship to "unknown". Never guess.',
    'Set payMin, payMax, and payInterval only when the posting states a pay number. payInterval is "hour", "month", or "year" as stated. Do not convert hourly or monthly pay into another interval. If no pay number is stated, set payMin, payMax, and payInterval to null.',
    "Set remote to true only if the posting says the role is remote or distributed. Otherwise set remote to false.",
    'Set roleType from the title and body to "internship", "new_grad", or "other".',
    "",
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    `Location: ${job.location ?? ""}`,
    "Description:",
    description,
  ].join("\n");
}

export async function extractPosting(job: {
  title: string;
  company: string;
  location: string | null;
  description: string;
}): Promise<{ extraction: PostingExtraction; dropped: string[] }> {
  const raw = await callGeminiJSON(postingModelSchema, promptFor(job), {
    timeoutMs: 25_000,
  });
  return finalizeExtraction(raw);
}
