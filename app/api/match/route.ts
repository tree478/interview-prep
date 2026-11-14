import { scoreMatch } from "@/lib/match/score";
import { createClient } from "@/lib/supabase/server";
import { matchRefreshSchema, postingExtractionSchema } from "@/lib/types";

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

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export async function POST(): Promise<Response> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return jsonError("Not signed in", 401);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select(
        "year, majors, skills, needs_sponsorship, open_to_relocation, preferred_locations, min_pay",
      )
      .eq("user_id", user.id)
      .maybeSingle();
    if (profileError) return jsonError("Could not load profile", 500);
    if (!profile) return jsonError("Profile not found", 404);

    const { data: experiences, error: experienceError } = await supabase
      .from("experiences")
      .select("skills")
      .eq("user_id", user.id);
    if (experienceError) return jsonError("Could not load experiences", 500);

    const { data: jobs, error: jobsError } = await supabase
      .from("jobs")
      .select(
        "id, company, title, location, url, role_type, posted_at, deadline, extracted_json",
      )
      .eq("extraction_status", "done")
      .not("extracted_json", "is", null);
    if (jobsError) return jsonError("Could not load jobs", 500);

    const studentSkills = [
      ...stringList(profile.skills),
      ...(experiences ?? []).flatMap((row) => stringList(row.skills)),
    ];
    const computedAt = new Date().toISOString();
    const rows: {
      user_id: string;
      job_id: string;
      score: number | null;
      covered_skills: string[];
      missing_skills: string[];
      preferred_covered: string[];
      preferred_missing: string[];
      hard_mismatch: string | null;
      requirement_checks: ReturnType<typeof scoreMatch>["checks"];
      computed_at: string;
    }[] = [];

    for (const job of jobs ?? []) {
      if (typeof job.id !== "string") continue;
      const parsed = postingExtractionSchema.safeParse(job.extracted_json);
      if (!parsed.success) continue;
      const match = scoreMatch({
        studentSkills,
        year: stringOrNull(profile.year),
        majors: stringList(profile.majors),
        needsSponsorship: profile.needs_sponsorship === true,
        openToRelocation: profile.open_to_relocation === true,
        preferredLocations: stringList(profile.preferred_locations),
        minPay: numberOrNull(profile.min_pay),
        posting: parsed.data,
        jobLocation: stringOrNull(job.location),
      });
      rows.push({
        user_id: user.id,
        job_id: job.id,
        score: match.score,
        covered_skills: match.covered,
        missing_skills: match.missing,
        preferred_covered: match.preferredCovered,
        preferred_missing: match.preferredMissing,
        hard_mismatch: match.hardMismatch,
        requirement_checks: match.checks,
        computed_at: computedAt,
      });
    }

    if (rows.length === 0) {
      return Response.json(matchRefreshSchema.parse({ updated: 0 }));
    }

    const { data, error } = await supabase
      .from("matches")
      .upsert(rows, { onConflict: "user_id,job_id" })
      .select("job_id");
    if (error || !Array.isArray(data)) {
      return jsonError("Could not save matches", 500);
    }
    const body = matchRefreshSchema.safeParse({ updated: data.length });
    if (!body.success) return jsonError("Could not save matches", 500);
    return Response.json(body.data);
  } catch {
    return jsonError("Could not score jobs", 500);
  }
}
