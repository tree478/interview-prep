import { AIError } from "@/lib/ai/gemini";
import {
  applyDecisions,
  collectBullets,
  emphasisSkills,
  knownEmployers,
  tailorBullets,
} from "@/lib/ai/tailor";
import { createClient } from "@/lib/supabase/server";
import {
  bulletDiffSchema,
  okSchema,
  postingExtractionSchema,
  tailorPatchSchema,
  tailorRequestSchema,
  tailorResultSchema,
} from "@/lib/types";
import { z } from "zod";

export const maxDuration = 15;

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function requireUser(): Promise<
  | {
      supabase: Awaited<ReturnType<typeof createClient>>;
      userId: string;
    }
  | Response
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Not signed in", 401);
  return { supabase, userId: user.id };
}

async function readBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid request", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid request", 400);
  return parsed.data;
}

function experiencesFrom(rows: unknown): {
  company: string;
  position: string;
  bullets: string[];
  skills: string[];
}[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const item = record(row);
    return {
      company: typeof item?.company === "string" ? item.company : "",
      position: typeof item?.position === "string" ? item.position : "",
      bullets: stringList(item?.bullets),
      skills: stringList(item?.skills),
    };
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requireUser();
    if (auth instanceof Response) return auth;

    const body = await readBody(request, tailorRequestSchema);
    if (body instanceof Response) return body;

    const { data: resume, error: resumeError } = await auth.supabase
      .from("resumes")
      .select("id")
      .eq("user_id", auth.userId)
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (resumeError) return jsonError("Could not load resume", 500);
    if (!resume || typeof resume.id !== "string") {
      return jsonError("Resume not found", 404);
    }

    const { data: job, error: jobError } = await auth.supabase
      .from("jobs")
      .select("company, title, extraction_status, extracted_json")
      .eq("id", body.jobId)
      .maybeSingle();
    if (jobError) return jsonError("Could not load job", 500);
    const jobRow = record(job);
    if (!jobRow) return jsonError("Job not found", 404);
    if (typeof jobRow.company !== "string" || typeof jobRow.title !== "string") {
      return jsonError("Could not load job", 500);
    }

    const extraction = postingExtractionSchema.safeParse(jobRow.extracted_json);
    if (jobRow.extraction_status !== "done" || !extraction.success) {
      return jsonError("Posting is not extracted", 409);
    }

    const { data: profile, error: profileError } = await auth.supabase
      .from("profiles")
      .select("skills, interests")
      .eq("user_id", auth.userId)
      .maybeSingle();
    if (profileError) return jsonError("Could not load profile", 500);
    const profileRow = record(profile);
    const profileSkills = stringList(profileRow?.skills);
    const interests = stringList(profileRow?.interests).flatMap((interest) => {
      const trimmed = interest.trim();
      return trimmed ? [trimmed] : [];
    });

    const { data: experienceRows, error: experienceError } = await auth.supabase
      .from("experiences")
      .select("company, position, bullets, skills")
      .eq("user_id", auth.userId)
      .order("id", { ascending: true });
    if (experienceError) return jsonError("Could not load experiences", 500);
    const experiences = experiencesFrom(experienceRows);
    const bullets = collectBullets(experiences);
    if (bullets.length === 0) return jsonError("No bullets to tailor", 404);

    let tailored;
    try {
      tailored = await tailorBullets({
        jobTitle: jobRow.title,
        company: jobRow.company,
        emphasis: emphasisSkills(
          [...profileSkills, ...experiences.flatMap((experience) => experience.skills)],
          extraction.data,
        ),
        interests,
        bullets,
        knownEmployers: knownEmployers([
          ...experiences.map((experience) => experience.company),
          jobRow.company,
        ]),
      });
    } catch (err) {
      if (err instanceof AIError) return jsonError(err.message, 502);
      return jsonError("Could not tailor resume", 500);
    }

    const { data: saved, error: insertError } = await auth.supabase
      .from("tailorings")
      .insert({
        user_id: auth.userId,
        job_id: body.jobId,
        resume_id: resume.id,
        bullet_diffs: tailored.diffs,
        rejected_count: tailored.rejectedCount,
      })
      .select("id")
      .single();
    if (insertError || !saved || typeof saved.id !== "string") {
      return jsonError("Could not save tailoring", 500);
    }

    const result = tailorResultSchema.safeParse({
      tailoringId: saved.id,
      diffs: tailored.diffs,
      blocked: tailored.blocked,
      rejectedCount: tailored.rejectedCount,
    });
    if (!result.success) return jsonError("Could not save tailoring", 500);
    return Response.json(result.data);
  } catch {
    return jsonError("Could not tailor resume", 500);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const auth = await requireUser();
    if (auth instanceof Response) return auth;

    const body = await readBody(request, tailorPatchSchema);
    if (body instanceof Response) return body;

    const { data: row, error: loadError } = await auth.supabase
      .from("tailorings")
      .select("bullet_diffs")
      .eq("id", body.tailoringId)
      .eq("user_id", auth.userId)
      .maybeSingle();
    if (loadError) return jsonError("Could not load tailoring", 500);
    if (!row) return jsonError("Tailoring not found", 404);

    const stored = z.array(bulletDiffSchema).safeParse(row.bullet_diffs);
    if (!stored.success) return jsonError("Could not read tailoring", 500);

    const applied = applyDecisions(stored.data, body.decisions);
    if ("error" in applied) return jsonError(applied.error, 400);

    const { data: updated, error: updateError } = await auth.supabase
      .from("tailorings")
      .update({ bullet_diffs: applied.diffs })
      .eq("id", body.tailoringId)
      .eq("user_id", auth.userId)
      .select("id")
      .maybeSingle();
    if (updateError || !updated) return jsonError("Could not save decisions", 500);

    return Response.json(okSchema.parse({ ok: true }));
  } catch {
    return jsonError("Could not save decisions", 500);
  }
}
