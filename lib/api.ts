// The one place the UI talks to the backend.
//
// Every page calls these functions instead of calling fetch() itself. Each
// function either returns mock data from mocks/*.json or calls the real API
// route, depending on NEXT_PUBLIC_USE_MOCKS. To switch the whole app to the
// real backend, set NEXT_PUBLIC_USE_MOCKS=false in .env.local.
//
// Every response, mock or real, is checked with the zod schema from
// lib/types.ts. If the backend sends a different shape than we expect, we get
// a clear error here instead of a confusing crash deep inside a component.

import { z } from "zod";
import {
  applicationSchema,
  atsReportSchema,
  botRunSchema,
  feedItemSchema,
  interviewQuestionSchema,
  parsedResumeSchema,
  starFeedbackSchema,
  tailorResultSchema,
  umassResourceSchema,
  type RoleType,
  type Sponsorship,
  type Stage,
} from "@/lib/types";

import applicationsMock from "@/mocks/applications.json";
import atsMock from "@/mocks/ats.json";
import botRunsMock from "@/mocks/bot-runs.json";
import feedMock from "@/mocks/feed.json";
import gapsMock from "@/mocks/gaps.json";
import interviewMock from "@/mocks/interview.json";
import resumeMock from "@/mocks/resume.json";
import tailorMock from "@/mocks/tailor.json";

// Mocks are on unless someone explicitly turns them off.
export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS !== "false";

// Route response wrappers. These compose the shared schemas from lib/types.ts
// into the exact response shapes listed in TASKS.md §2.
// TODO(types): ask Miranda to move these into lib/types.ts.
const resumeUploadSchema = z.object({
  resumeId: z.string(),
  parsed: parsedResumeSchema,
  ats: atsReportSchema,
});
const gapsResponseSchema = z.object({
  gaps: z.array(
    z.object({ skill: z.string(), resources: z.array(umassResourceSchema) }),
  ),
});
export type GapsResponse = z.infer<typeof gapsResponseSchema>;

const okSchema = z.object({ ok: z.literal(true) });
const runIdSchema = z.object({ runId: z.string() });

/** Thrown when a request fails. `message` is safe to show to the user. */
export class ApiError extends Error {}

const MOCK_DELAY_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Core helper. In mock mode, waits a moment (so loading states are visible)
 * and returns `mock`. Otherwise calls the real route. Either way, the result
 * is validated with `schema`.
 */
async function call<T>(
  schema: z.ZodType<T>,
  path: string,
  options: { method?: "GET" | "POST" | "PATCH"; body?: unknown; mock: unknown },
): Promise<T> {
  if (USE_MOCKS) {
    await sleep(MOCK_DELAY_MS);
    return parseOrThrow(schema, options.mock, path);
  }

  const isForm = options.body instanceof FormData;
  const res = await fetch(path, {
    method: options.method ?? "GET",
    headers: options.body && !isForm ? { "Content-Type": "application/json" } : undefined,
    body: isForm
      ? (options.body as FormData)
      : options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined,
  });

  // Our routes return { error: string } on failure (CLAUDE.md rule).
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      json && typeof json === "object" && "error" in json && typeof json.error === "string"
        ? json.error
        : `Request failed (${res.status})`;
    throw new ApiError(message);
  }
  return parseOrThrow(schema, json, path);
}

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown, path: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    // Log details for us; show a short message to the user.
    console.error(`Unexpected response shape from ${path}`, result.error);
    throw new ApiError(`Unexpected response from ${path}`);
  }
  return result.data;
}

// ---------------------------------------------------------------- feed

export type FeedFilters = {
  location?: string;
  sponsorship?: Sponsorship;
  roleType?: RoleType;
};

export function getFeed(filters: FeedFilters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();

  // In mock mode, apply the filters ourselves so the UI behaves realistically.
  const mock = feedMock.filter(
    ({ job }) =>
      (!filters.location ||
        (job.location ?? "").toLowerCase().includes(filters.location.toLowerCase())) &&
      (!filters.sponsorship || job.sponsorship === filters.sponsorship) &&
      (!filters.roleType || job.roleType === filters.roleType),
  );

  return call(z.array(feedItemSchema), `/api/feed${qs ? `?${qs}` : ""}`, { mock });
}

/** Finds one job from the feed. There is no single-job route in the contract yet. */
export async function getFeedItem(jobId: string) {
  const feed = await getFeed();
  const item = feed.find((f) => f.job.id === jobId);
  if (!item) throw new ApiError("Job not found");
  return item;
}

export function refreshMatches() {
  return call(z.object({ updated: z.number() }), "/api/match", {
    method: "POST",
    body: {},
    mock: { updated: feedMock.length },
  });
}

// ---------------------------------------------------------------- resume

export function uploadResume(file: File) {
  const form = new FormData();
  form.append("file", file);
  return call(resumeUploadSchema, "/api/resume", { method: "POST", body: form, mock: resumeMock });
}

// ---------------------------------------------------------------- job detail

export function getGaps(jobId: string) {
  return call(gapsResponseSchema, "/api/gaps", { method: "POST", body: { jobId }, mock: gapsMock });
}

export function getAts(jobId: string) {
  return call(atsReportSchema, "/api/ats", { method: "POST", body: { jobId }, mock: atsMock });
}

export function tailor(jobId: string) {
  return call(tailorResultSchema, "/api/tailor", { method: "POST", body: { jobId }, mock: tailorMock });
}

export function saveTailorDecisions(
  tailoringId: string,
  decisions: { id: string; status: "accepted" | "rejected" }[],
) {
  return call(okSchema, "/api/tailor", {
    method: "PATCH",
    body: { tailoringId, decisions },
    mock: { ok: true },
  });
}

// ---------------------------------------------------------------- tracker

export function getApplications() {
  return call(z.array(applicationSchema), "/api/applications", { mock: applicationsMock });
}

export function addApplication(jobId: string) {
  return call(okSchema, "/api/applications", { method: "POST", body: { jobId }, mock: { ok: true } });
}

export function updateApplication(update: { id: string; stage?: Stage; deadline?: string | null }) {
  return call(okSchema, "/api/applications", { method: "PATCH", body: update, mock: { ok: true } });
}

// ---------------------------------------------------------------- bot activity

export function getBotRuns() {
  return call(z.array(botRunSchema), "/api/ingest/runs", { mock: botRunsMock });
}

export function runScout() {
  return call(runIdSchema, "/api/ingest/run", {
    method: "POST",
    body: { trigger: "manual" },
    mock: { runId: "run-mock" },
  });
}

export function refreshCourses() {
  return call(runIdSchema, "/api/ingest/courses", { method: "POST", mock: { runId: "run-mock" } });
}

// ---------------------------------------------------------------- interview

export function getInterviewQuestions(jobId: string) {
  return call(z.array(interviewQuestionSchema), "/api/interview", {
    method: "POST",
    body: { jobId, action: "questions" },
    mock: interviewMock.questions,
  });
}

export function gradeAnswer(jobId: string, questionId: string, question: string, answer: string) {
  return call(starFeedbackSchema, "/api/interview", {
    method: "POST",
    body: { jobId, action: "grade", questionId, question, answer },
    mock: interviewMock.feedback,
  });
}
