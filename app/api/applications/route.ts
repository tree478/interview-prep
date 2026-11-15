import { createClient } from "@/lib/supabase/server";
import {
  applicationSchema,
  okSchema,
  stageSchema,
  type Application,
  type RoleType,
  type Sponsorship,
  type Stage,
} from "@/lib/types";
import { z } from "zod";

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function embeddedJob(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return asRecord(value[0]);
  return asRecord(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// Date columns come back as YYYY-MM-DD. A timestamptz would start the same way.
function dateOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match?.[1] ?? null;
}

function scoreNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRoleType(value: unknown): value is RoleType {
  return value === "internship" || value === "new_grad" || value === "other";
}

function roleTypeOf(column: unknown, extracted: unknown): RoleType {
  if (isRoleType(column)) return column;
  const fromExtraction = asRecord(extracted)?.roleType;
  if (isRoleType(fromExtraction)) return fromExtraction;
  return "other";
}

function sponsorshipOf(extracted: unknown): Sponsorship {
  const value = asRecord(extracted)?.sponsorship;
  if (value === "yes" || value === "no" || value === "unknown") return value;
  return "unknown";
}

function isUniqueViolation(error: { code?: string }): boolean {
  return error.code === "23505";
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

const postBodySchema = z.object({
  jobId: z.uuid(),
});

const patchBodySchema = z
  .object({
    id: z.uuid(),
    stage: stageSchema.optional(),
    deadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
  })
  .refine((body) => body.stage !== undefined || body.deadline !== undefined);

export async function GET(): Promise<Response> {
  try {
    const auth = await requireUser();
    if (auth instanceof Response) return auth;

    const { data, error } = await auth.supabase
      .from("applications")
      .select(
        `
        id,
        stage,
        deadline,
        deadline_source,
        updated_at,
        jobs (
          id,
          company,
          title,
          location,
          url,
          role_type,
          posted_at,
          deadline,
          extracted_json
        )
      `,
      )
      .eq("user_id", auth.userId);
    if (error) return jsonError("Could not load applications", 500);

    const rows = Array.isArray(data) ? data : [];
    const jobIds: string[] = [];
    for (const row of rows) {
      const record = asRecord(row);
      const job = embeddedJob(record?.jobs);
      const jobId = job?.id;
      if (typeof jobId === "string") jobIds.push(jobId);
    }

    const scores = new Map<string, number | null>();
    if (jobIds.length > 0) {
      const { data: matchRows, error: matchError } = await auth.supabase
        .from("matches")
        .select("job_id, score")
        .eq("user_id", auth.userId)
        .in("job_id", jobIds);
      if (matchError) return jsonError("Could not load applications", 500);
      for (const match of matchRows ?? []) {
        const record = asRecord(match);
        const jobId = record?.job_id;
        if (typeof jobId !== "string") continue;
        scores.set(jobId, scoreNumber(record?.score));
      }
    }

    const applications: Application[] = [];
    for (const row of rows) {
      const record = asRecord(row);
      const job = embeddedJob(record?.jobs);
      if (!record || !job) {
        console.error("Dropping application row with no job", record?.id);
        continue;
      }
      const jobId = typeof job.id === "string" ? job.id : null;
      const candidate = {
        id: record.id,
        stage: record.stage,
        deadline: dateOrNull(record.deadline),
        deadlineSource: record.deadline_source ?? null,
        matchScore: jobId ? (scores.get(jobId) ?? null) : null,
        updatedAt: record.updated_at,
        job: {
          id: job.id,
          company: job.company,
          title: job.title,
          location: stringOrNull(job.location),
          url: job.url,
          roleType: roleTypeOf(job.role_type, job.extracted_json),
          sponsorship: sponsorshipOf(job.extracted_json),
          postedAt: stringOrNull(job.posted_at),
          deadline: dateOrNull(job.deadline),
        },
      };
      const parsed = applicationSchema.safeParse(candidate);
      if (!parsed.success) {
        console.error("applicationSchema rejected row", record.id, parsed.error);
        continue;
      }
      applications.push(parsed.data);
    }

    return Response.json(applications);
  } catch {
    return jsonError("Could not load applications", 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requireUser();
    if (auth instanceof Response) return auth;

    const body = await readBody(request, postBodySchema);
    if (body instanceof Response) return body;

    const { data: existing, error: existingError } = await auth.supabase
      .from("applications")
      .select("id")
      .eq("user_id", auth.userId)
      .eq("job_id", body.jobId)
      .maybeSingle();
    if (existingError) return jsonError("Could not save application", 500);
    if (existing) return Response.json(okSchema.parse({ ok: true }));

    const { data: job, error: jobError } = await auth.supabase
      .from("jobs")
      .select("deadline")
      .eq("id", body.jobId)
      .maybeSingle();
    if (jobError) return jsonError("Could not save application", 500);
    const jobRow = asRecord(job);
    if (!jobRow) return jsonError("Job not found", 404);

    const postingDeadline = dateOrNull(jobRow.deadline);
    const { error: insertError } = await auth.supabase.from("applications").insert({
      user_id: auth.userId,
      job_id: body.jobId,
      stage: "saved",
      deadline: postingDeadline,
      deadline_source: postingDeadline ? "posting" : null,
    });
    if (insertError) {
      if (isUniqueViolation(insertError)) {
        return Response.json(okSchema.parse({ ok: true }));
      }
      return jsonError("Could not save application", 500);
    }

    return Response.json(okSchema.parse({ ok: true }));
  } catch {
    return jsonError("Could not save application", 500);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const auth = await requireUser();
    if (auth instanceof Response) return auth;

    const body = await readBody(request, patchBodySchema);
    if (body instanceof Response) return body;

    const changes: {
      updated_at: string;
      stage?: Stage;
      deadline?: string | null;
      deadline_source?: "user" | null;
    } = { updated_at: new Date().toISOString() };
    if (body.stage !== undefined) changes.stage = body.stage;
    if (body.deadline !== undefined) {
      changes.deadline = body.deadline;
      changes.deadline_source = body.deadline === null ? null : "user";
    }

    const { data: updated, error } = await auth.supabase
      .from("applications")
      .update(changes)
      .eq("id", body.id)
      .eq("user_id", auth.userId)
      .select("id")
      .maybeSingle();
    if (error) return jsonError("Could not update application", 500);
    if (!updated) return jsonError("Application not found", 404);

    return Response.json(okSchema.parse({ ok: true }));
  } catch {
    return jsonError("Could not update application", 500);
  }
}
