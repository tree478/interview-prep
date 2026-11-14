import { selectGaps, type GapResourceRow } from "@/lib/gaps/select";
import { createClient } from "@/lib/supabase/server";
import { gapsRequestSchema, gapsResponseSchema } from "@/lib/types";

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function resourceRow(value: unknown): GapResourceRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const { id, type, name, url, active } = row;
  if (typeof id !== "string" || typeof name !== "string" || typeof url !== "string") {
    return null;
  }
  if (type !== "course" && type !== "lab") return null;
  if (active !== true) return null;
  const description = row.description;
  return {
    id,
    type,
    name,
    url,
    description: typeof description === "string" ? description : null,
    skills: stringList(row.skills),
    meta: record(row.meta),
    active,
  };
}

export async function POST(request: Request): Promise<Response> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return jsonError("Not signed in", 401);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid request", 400);
    }
    const parsed = gapsRequestSchema.safeParse(body);
    if (!parsed.success) return jsonError("Invalid request", 400);

    const { data: match, error: matchError } = await supabase
      .from("matches")
      .select("missing_skills, preferred_missing")
      .eq("user_id", user.id)
      .eq("job_id", parsed.data.jobId)
      .maybeSingle();
    if (matchError) return jsonError("Could not load match", 500);
    if (!match) return jsonError("Match not found", 404);

    const missingSkills = stringList(match.missing_skills);
    const preferredMissing = stringList(match.preferred_missing);
    // Same order, blank skip, and dedupe as the response body.
    const skills = selectGaps({
      missingSkills,
      preferredMissing,
      resources: [],
    }).map((gap) => gap.skill);
    if (skills.length === 0) return Response.json({ gaps: [] });

    const { data: rows, error: resourcesError } = await supabase
      .from("umass_resources")
      .select("id, type, name, url, description, skills, meta, active")
      .eq("active", true)
      .overlaps("skills", skills);
    if (resourcesError) return jsonError("Could not load resources", 500);

    const gaps = selectGaps({
      missingSkills,
      preferredMissing,
      resources: (Array.isArray(rows) ? rows : []).flatMap((row) => {
        const resource = resourceRow(row);
        return resource ? [resource] : [];
      }),
    });
    const response = gapsResponseSchema.safeParse({ gaps });
    if (!response.success) return jsonError("Could not build gap plan", 500);
    return Response.json(response.data);
  } catch {
    return jsonError("Could not build gap plan", 500);
  }
}
