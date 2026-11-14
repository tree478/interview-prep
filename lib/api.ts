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

import { createBrowserClient } from "@supabase/ssr";
import { z } from "zod";
import {
  applicationSchema,
  atsReportSchema,
  botRunSchema,
  experienceRowSchema,
  feedItemSchema,
  interviewQuestionSchema,
  parsedResumeSchema,
  profileRowSchema,
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

// ---------------------------------------------------------------- auth (A-2)
//
// Auth is separate from USE_MOCKS: real Supabase sign-in turns on as soon as
// the two public Supabase values are in .env.local, even while the data
// routes are still mocked. Without them, sign-up/log-in are simulated so the
// flow can still be clicked through.
//
// These two values are public on purpose (the NEXT_PUBLIC_ prefix ships them
// to the browser). The publishable key only allows what row-level security
// permits. Server-only secrets never appear in this file.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const AUTH_ENABLED = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

// TODO(supabase): move to lib/supabase/client.ts once it exists (owner: Miranda).
// createBrowserClient returns the same instance on every call in the browser,
// and stores the session in cookies so the server (proxy.ts, API routes) sees it.
function browserSupabase() {
  return createBrowserClient(SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY!);
}

/** Turns Supabase's technical auth errors into messages a student can act on. */
function friendlyAuthError(message: string): string {
  if (/database error saving new user/i.test(message)) {
    // Miranda's trigger raised: the email isn't @umass.edu.
    return "Only @umass.edu email addresses can sign up.";
  }
  if (/invalid login credentials/i.test(message)) return "Email or password is incorrect.";
  if (/email not confirmed/i.test(message)) return "Confirm your email first. Check your UMass inbox for the link.";
  if (/already registered|already exists/i.test(message)) {
    return "An account with this email already exists. Try logging in.";
  }
  if (/password/i.test(message)) return message; // e.g. Supabase's own password rules
  return "Something went wrong. Please try again.";
}

export async function signUp(input: { fullName: string; email: string; password: string }) {
  if (!AUTH_ENABLED) {
    await sleep(MOCK_DELAY_MS);
    return { needsEmailConfirmation: false };
  }
  const { data, error } = await browserSupabase().auth.signUp({
    email: input.email.trim(),
    password: input.password,
    // The DB trigger copies full_name from here into the new profiles row.
    options: { data: { full_name: input.fullName.trim() } },
  });
  if (error) throw new ApiError(friendlyAuthError(error.message));
  // No session means the project requires clicking a confirmation email first.
  return { needsEmailConfirmation: !data.session };
}

export async function signIn(input: { email: string; password: string }) {
  if (!AUTH_ENABLED) {
    await sleep(MOCK_DELAY_MS);
    return;
  }
  const { error } = await browserSupabase().auth.signInWithPassword({
    email: input.email.trim(),
    password: input.password,
  });
  if (error) throw new ApiError(friendlyAuthError(error.message));
}

export async function signOut() {
  if (!AUTH_ENABLED) return;
  const { error } = await browserSupabase().auth.signOut();
  if (error) throw new ApiError("Could not log out. Please try again.");
}

// ---------------------------------------------------------------- profile (A-3, A-4)
//
// The profile is read and written straight from the browser with the user's
// own Supabase session (no API route), so row-level security guarantees each
// student can only touch their own rows.

export type ProfileUpdate = {
  full_name: string;
  year: string | null;
  majors: string[];
  minors: string[];
  honors: string[];
  clubs: { name: string; role: string | null }[];
  skills: string[];
  interests: string[];
};
export type ExperienceInsert = {
  user_id: string;
  company: string;
  position: string;
  start_date: string | null;
  end_date: string | null;
  bullets: string[];
  skills: string[];
};

async function currentUserId(): Promise<string> {
  const { data, error } = await browserSupabase().auth.getUser();
  if (error || !data.user) throw new ApiError("You're logged out. Log in again to continue.");
  return data.user.id;
}

/** The signed-in student's profile row and experiences. */
export async function getMyProfile() {
  if (!AUTH_ENABLED) {
    await sleep(MOCK_DELAY_MS);
    return mockProfile();
  }
  const supabase = browserSupabase();
  const userId = await currentUserId();
  const [profileRes, experiencesRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("user_id", userId).single(),
    supabase.from("experiences").select("*").eq("user_id", userId),
  ]);
  if (profileRes.error) throw new ApiError("Could not load your profile.");
  if (experiencesRes.error) throw new ApiError("Could not load your experiences.");
  return {
    userId,
    profile: parseOrThrow(profileRowSchema, profileRes.data, "profiles"),
    experiences: parseOrThrow(z.array(experienceRowSchema), experiencesRes.data, "experiences"),
  };
}

/**
 * Saves the profile fields and replaces the student's experiences.
 * New experience rows are inserted first and the old ones deleted only after
 * that succeeds, so a failed save never leaves the student with none.
 */
export async function saveMyProfile(profile: ProfileUpdate, buildExperiences: (userId: string) => ExperienceInsert[]) {
  if (!AUTH_ENABLED) {
    await sleep(MOCK_DELAY_MS);
    return;
  }
  const supabase = browserSupabase();
  const userId = await currentUserId();

  const profileRes = await supabase.from("profiles").update(profile).eq("user_id", userId);
  if (profileRes.error) throw new ApiError("Could not save your profile. Please try again.");

  const rows = buildExperiences(userId);
  let keepIds: string[] = [];
  if (rows.length) {
    const inserted = await supabase.from("experiences").insert(rows).select("id");
    if (inserted.error) throw new ApiError("Could not save your experiences. Please try again.");
    keepIds = (inserted.data ?? []).map((r) => r.id as string);
  }
  let cleanup = supabase.from("experiences").delete().eq("user_id", userId);
  if (keepIds.length) cleanup = cleanup.not("id", "in", `(${keepIds.join(",")})`);
  const deleted = await cleanup;
  if (deleted.error) throw new ApiError("Saved, but old experiences could not be removed. Try saving again.");
}

function mockProfile() {
  const { parsed } = resumeMock;
  return {
    userId: "mock-user",
    profile: parseOrThrow(profileRowSchema, {
      user_id: "00000000-0000-4000-8000-000000000000",
      full_name: "Sam Minuteman",
      email: "sam@umass.edu",
      year: parsed.academics.year,
      majors: parsed.academics.majors,
      minors: parsed.academics.minors,
      honors: parsed.academics.honors,
      clubs: parsed.academics.clubs,
      skills: parsed.skills,
      interests: parsed.interests,
      needs_sponsorship: false,
      open_to_relocation: false,
      preferred_locations: [],
      min_pay: null,
    }, "mock profile"),
    experiences: parsed.experiences.map((e, i) =>
      parseOrThrow(experienceRowSchema, {
        ...e,
        id: `00000000-0000-4000-8000-00000000000${i + 1}`,
        user_id: "00000000-0000-4000-8000-000000000000",
        start_date: e.start_date ? `${e.start_date}-01` : null,
        end_date: e.end_date ? `${e.end_date}-01` : null,
      }, "mock experience"),
    ),
  };
}
