import { buildJobAtsReport, postingSkills } from "@/lib/resume/coverage";
import { missingSections } from "@/lib/resume/sections";
import { createClient } from "@/lib/supabase/server";
import {
  atsReportSchema,
  atsRequestSchema,
  postingExtractionSchema,
} from "@/lib/types";

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
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
    const parsed = atsRequestSchema.safeParse(body);
    if (!parsed.success) return jsonError("Invalid request", 400);

    const { data: resume, error: resumeError } = await supabase
      .from("resumes")
      .select("raw_text, ats_report")
      .eq("user_id", user.id)
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (resumeError) return jsonError("Could not load resume", 500);
    if (!resume) return jsonError("Resume not found", 404);

    const stored = atsReportSchema.safeParse(resume.ats_report);
    const sections = stored.success
      ? stored.data.missingSections
      : typeof resume.raw_text === "string"
        ? missingSections(resume.raw_text)
        : null;
    if (sections === null) return jsonError("Resume not found", 404);

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("extracted_json, extraction_status")
      .eq("id", parsed.data.jobId)
      .maybeSingle();
    if (jobError) return jsonError("Could not load job", 500);
    if (!job) return jsonError("Job not found", 404);

    const extraction = postingExtractionSchema.safeParse(job.extracted_json);
    if (job.extraction_status !== "done" || !extraction.success) {
      return jsonError("Posting is not extracted", 409);
    }

    return Response.json(
      buildJobAtsReport({
        missingSections: sections,
        rawText: typeof resume.raw_text === "string" ? resume.raw_text : "",
        postingSkills: postingSkills(extraction.data),
      }),
    );
  } catch {
    return jsonError("Could not build ATS report", 500);
  }
}
