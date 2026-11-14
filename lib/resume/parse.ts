import { z } from "zod";
import { extractText, getDocumentProxy } from "unpdf";
import { callGeminiJSON } from "../ai/gemini";
import { canonicalize } from "../match/skills";
import { parsedResumeSchema, type ParsedResume } from "../types";

const clubModelSchema = z.object({
  name: z.string(),
  role: z.string().nullable(),
});

const experienceModelSchema = z.object({
  company: z.string(),
  position: z.string(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  bullets: z.array(z.string()),
  skills: z.array(z.string()),
});

const resumeModelSchema = z.object({
  academics: z.object({
    year: z.string().nullable(),
    majors: z.array(z.string()),
    minors: z.array(z.string()),
    honors: z.array(z.string()),
    clubs: z.array(clubModelSchema),
  }),
  experiences: z.array(experienceModelSchema),
  skills: z.array(z.string()),
  interests: z.array(z.string()),
});

const INTEREST_LIMIT = 10;

export function finalizeResume(
  raw: z.infer<typeof resumeModelSchema>,
): ParsedResume {
  return parsedResumeSchema.parse({
    academics: {
      year: raw.academics.year,
      majors: raw.academics.majors,
      minors: raw.academics.minors,
      honors: raw.academics.honors,
      clubs: raw.academics.clubs.map((club) => ({
        name: club.name,
        role: club.role,
      })),
    },
    experiences: raw.experiences.map((experience) => ({
      company: experience.company,
      position: experience.position,
      start_date: experience.start_date,
      end_date: experience.end_date,
      bullets: experience.bullets,
      skills: canonicalize(experience.skills).canonical,
    })),
    skills: canonicalize(raw.skills).canonical,
    interests: raw.interests.slice(0, INTEREST_LIMIT),
  });
}

function promptFor(rawText: string): string {
  return [
    "Extract structured fields from this résumé.",
    "Use only the résumé text. Do not invent employers, dates, numbers, clubs, skills, interests, or the word Present.",
    "Copy each bullet verbatim.",
    "Copy skill names as written. Do not canonicalize and do not drop unknown skills. Code does that.",
    "Each skill entry is one skill, tool, or language name. If a line names several, return each name as its own entry.",
    "Put the résumé's skill list in skills. Put skills that an experience states into that experience's skills.",
    "Use an empty array when a list is absent.",
    "Set academics.year to the class year or graduation year when the résumé states one. Otherwise set year to null.",
    "Set a club role to the e-board title when the résumé states one. Otherwise set role to null.",
    "Copy start_date and end_date as written. If a date is absent, set it to null. Do not write Present.",
    "",
    "Résumé:",
    rawText,
  ].join("\n");
}

export async function extractTextFromPdf(bytes: Uint8Array): Promise<string> {
  // unpdf's PDF.js build takes ownership of the buffer it is given.
  const pdf = await getDocumentProxy(bytes.slice());
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

export async function parseResume(rawText: string): Promise<ParsedResume> {
  const raw = await callGeminiJSON(resumeModelSchema, promptFor(rawText), {
    timeoutMs: 15_000,
  });
  return finalizeResume(raw);
}
