import { compareFeedItems, isFeedRole } from "@/lib/match/score";
import { createClient } from "@/lib/supabase/server";
import {
  feedItemSchema,
  postingExtractionSchema,
  type FeedItem,
  type RoleType,
  type Sponsorship,
} from "@/lib/types";

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function scoreNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function embeddedJob(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return asRecord(value[0]);
  return asRecord(value);
}

function isSponsorship(value: string): value is Sponsorship {
  return value === "yes" || value === "no" || value === "unknown";
}

function isRoleType(value: string): value is RoleType {
  return value === "internship" || value === "new_grad" || value === "other";
}

function readExtracted(value: unknown): {
  roleType: RoleType | null;
  sponsorship: Sponsorship;
  locations: string[];
} {
  const parsed = postingExtractionSchema.safeParse(value);
  if (parsed.success) {
    return {
      roleType: parsed.data.roleType,
      sponsorship: parsed.data.sponsorship,
      locations: parsed.data.locations,
    };
  }
  const record = asRecord(value);
  const roleType = record?.roleType;
  const sponsorship = record?.sponsorship;
  return {
    roleType: typeof roleType === "string" && isRoleType(roleType) ? roleType : null,
    sponsorship:
      typeof sponsorship === "string" && isSponsorship(sponsorship)
        ? sponsorship
        : "unknown",
    locations: stringList(record?.locations),
  };
}

type Filters = {
  location: string | null;
  sponsorship: Sponsorship | null;
  roleType: RoleType | null;
};

function readFilters(request: Request): Filters | { error: string } {
  const params = new URL(request.url).searchParams;
  const location = params.get("location");
  const sponsorship = params.get("sponsorship");
  const roleType = params.get("roleType");

  if (sponsorship && !isSponsorship(sponsorship)) return { error: "Invalid filter" };
  if (roleType && !isRoleType(roleType)) return { error: "Invalid filter" };

  return {
    location: location ? location : null,
    sponsorship: sponsorship && isSponsorship(sponsorship) ? sponsorship : null,
    roleType: roleType && isRoleType(roleType) ? roleType : null,
  };
}

function locationHits(
  jobLocation: string | null,
  extracted: string[],
  query: string,
): boolean {
  const needle = query.toLowerCase();
  if (jobLocation?.toLowerCase().includes(needle)) return true;
  return extracted.some((place) => place.toLowerCase().includes(needle));
}

export async function GET(request: Request): Promise<Response> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return jsonError("Not signed in", 401);

    const filters = readFilters(request);
    if ("error" in filters) return jsonError(filters.error, 400);

    const { data, error } = await supabase
      .from("matches")
      .select(
        `
        score,
        covered_skills,
        missing_skills,
        preferred_covered,
        preferred_missing,
        hard_mismatch,
        requirement_checks,
        jobs!inner (
          id,
          company,
          title,
          location,
          url,
          role_type,
          posted_at,
          deadline,
          extraction_status,
          extracted_json
        )
      `,
      )
      .eq("user_id", user.id)
      .eq("jobs.extraction_status", "done");
    if (error) return jsonError("Could not load feed", 500);

    const items: FeedItem[] = [];
    for (const row of data ?? []) {
      const record = asRecord(row);
      const job = embeddedJob(record?.jobs);
      if (!record || !job) continue;
      if (job.extraction_status !== "done") continue;

      const extracted = readExtracted(job.extracted_json);
      const roleType = stringOrNull(job.role_type) ?? extracted.roleType;
      const candidate = {
        job: {
          id: job.id,
          company: job.company,
          title: job.title,
          location: stringOrNull(job.location),
          url: job.url,
          roleType,
          sponsorship: extracted.sponsorship,
          postedAt: stringOrNull(job.posted_at),
          deadline: stringOrNull(job.deadline),
        },
        match: {
          score: scoreNumber(record.score),
          covered: stringList(record.covered_skills),
          missing: stringList(record.missing_skills),
          preferredCovered: stringList(record.preferred_covered),
          preferredMissing: stringList(record.preferred_missing),
          checks: record.requirement_checks,
          hardMismatch: stringOrNull(record.hard_mismatch),
        },
      };
      const parsed = feedItemSchema.safeParse(candidate);
      if (!parsed.success) continue;
      if (!isFeedRole(parsed.data.job.roleType)) continue;
      if (
        filters.location &&
        !locationHits(parsed.data.job.location, extracted.locations, filters.location)
      ) {
        continue;
      }
      if (
        filters.sponsorship &&
        parsed.data.job.sponsorship !== filters.sponsorship
      ) {
        continue;
      }
      if (filters.roleType && parsed.data.job.roleType !== filters.roleType) {
        continue;
      }
      items.push(parsed.data);
    }

    items.sort(compareFeedItems);
    return Response.json(items);
  } catch {
    return jsonError("Could not load feed", 500);
  }
}
