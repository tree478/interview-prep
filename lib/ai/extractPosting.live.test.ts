import { load } from "cheerio";
import { describe, expect, it } from "vitest";
import { postingExtractionSchema } from "../types";
import { extractPosting } from "./extractPosting";

const live =
  process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL
    ? describe
    : describe.skip;

const SLUGS = ["stripe", "databricks", "cloudflare", "figma", "notion"];

const COMPANY_NAMES: Record<string, string> = {
  stripe: "Stripe",
  databricks: "Databricks",
  cloudflare: "Cloudflare",
  figma: "Figma",
  notion: "Notion",
};

type GreenhouseJob = {
  title?: string;
  content?: string | null;
  location?: { name?: string | null } | null;
};

function isEarlyCareer(title: string): boolean {
  return /\bintern(ship)?s?\b|\bnew grad|\bnew graduate|\bearly career|\bentry[- ]level\b|\buniversity graduate/i.test(
    title,
  );
}

function plainText(value: string): string {
  let text = load(value).text();
  if (/<[a-z/!]/i.test(text)) text = load(text).text();
  return text.replace(/\s+/g, " ").trim();
}

async function jobsFrom(slug: string): Promise<GreenhouseJob[]> {
  const response = await fetch(
    `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
  );
  if (response.status === 404 || !response.ok) return [];
  const body = (await response.json()) as { jobs?: GreenhouseJob[] };
  return body.jobs ?? [];
}

live("extractPosting live", () => {
  it("extracts three Greenhouse intern or new-grad postings", async () => {
    const jobs: {
      title: string;
      company: string;
      location: string | null;
      description: string;
    }[] = [];

    for (const slug of SLUGS) {
      if (jobs.length >= 3) break;
      let board: GreenhouseJob[] = [];
      try {
        board = await jobsFrom(slug);
      } catch {
        continue;
      }
      if (board.length === 0) continue;

      for (const job of board) {
        if (jobs.length >= 3) break;
        const title = job.title?.trim();
        if (!title || !isEarlyCareer(title)) continue;
        const description = plainText(job.content ?? "");
        if (!description) continue;
        jobs.push({
          title,
          company: COMPANY_NAMES[slug] ?? slug,
          location: job.location?.name?.trim() || null,
          description,
        });
      }
    }

    expect(jobs, "found 3 intern or new-grad Greenhouse postings").toHaveLength(
      3,
    );

    for (const job of jobs) {
      console.log(`extracting ${job.company}: ${job.title} (${job.description.length} chars)`);
      const { extraction, dropped } = await extractPosting(job);
      expect(postingExtractionSchema.parse(extraction)).toEqual(extraction);
      expect(dropped.every((skill) => typeof skill === "string")).toBe(true);
      console.log(
        JSON.stringify(
          {
            title: job.title,
            company: job.company,
            location: job.location,
            requiredSkills: extraction.requiredSkills,
            preferredSkills: extraction.preferredSkills,
            dropped,
            majors: extraction.majors,
            locations: extraction.locations,
            remote: extraction.remote,
            sponsorship: extraction.sponsorship,
            pay: extraction.pay,
            graduation: extraction.graduation,
            roleType: extraction.roleType,
            description: job.description,
          },
          null,
          2,
        ),
      );
    }
  }, 200_000);
});
