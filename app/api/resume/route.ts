import { AIError } from "@/lib/ai/gemini";
import { extractTextFromPdf, parseResume } from "@/lib/resume/parse";
import { buildAtsReport } from "@/lib/resume/sections";
import { createClient } from "@/lib/supabase/server";
import { resumeUploadSchema } from "@/lib/types";

export const maxDuration = 30;

const BUCKET = "resumes";
const MAX_PDF_BYTES = 8 * 1024 * 1024;

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

function isPdf(file: File): boolean {
  return (
    file.type.toLowerCase() === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  );
}

export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Not signed in", 401);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError("Missing file", 400);
  }

  const entry = formData.get("file");
  if (!(entry instanceof File)) {
    return jsonError("Missing file", 400);
  }
  if (!isPdf(entry)) {
    return jsonError("File must be a PDF", 400);
  }
  if (entry.size > MAX_PDF_BYTES) {
    return jsonError("PDF must be 8 MB or smaller", 400);
  }

  const bytes = new Uint8Array(await entry.arrayBuffer());
  let rawText: string;
  try {
    rawText = await extractTextFromPdf(bytes);
  } catch {
    return jsonError("Could not read text from this PDF", 422);
  }
  if (rawText.trim() === "") {
    return jsonError("Could not read text from this PDF", 422);
  }

  const storagePath = `${user.id}/${crypto.randomUUID()}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType: "application/pdf" });
  if (uploadError) {
    return jsonError("Could not store resume", 500);
  }

  let parsed;
  try {
    parsed = await parseResume(rawText);
  } catch (err) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    if (err instanceof AIError) {
      return jsonError(err.message, 422);
    }
    return jsonError("Could not parse resume", 500);
  }

  const ats = buildAtsReport(rawText);
  const { data: row, error: insertError } = await supabase
    .from("resumes")
    .insert({
      user_id: user.id,
      storage_path: storagePath,
      raw_text: rawText,
      parsed_json: parsed,
      ats_report: ats,
    })
    .select("id")
    .single();

  if (insertError || !row || typeof row.id !== "string") {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return jsonError("Could not save resume", 500);
  }

  const body = resumeUploadSchema.safeParse({ resumeId: row.id, parsed, ats });
  if (!body.success) return jsonError("Could not save resume", 500);
  return Response.json(body.data);
}
