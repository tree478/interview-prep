// The one place the UI talks to the backend.
//
// Every page calls these functions instead of calling fetch() itself. Each
// function either returns mock data from mocks/*.json or calls the real API
// route, depending on NEXT_PUBLIC_USE_MOCKS. To switch the whole app to the
// real backend, set NEXT_PUBLIC_USE_MOCKS=false in .env.local. A few calls
// whose routes are finished pass `live: true` and always use the real route.
//
// Every response, mock or real, is checked with the zod schema from
// lib/types.ts. If the backend sends a different shape than we expect, we get
// a clear error here instead of a confusing crash deep inside a component.

import { z } from "zod";
import {
  applicationSchema,
  atsReportSchema,
  botRunSchema,
  experienceRowSchema,
  feedItemSchema,
  gapsResponseSchema,
  interviewQuestionSchema,
  matchRefreshSchema,
  okSchema,
  profileRowSchema,
  resumeUploadSchema,
  runIdSchema,
  starFeedbackSchema,
  tailoringRowSchema,
  tailorResultSchema,
  type RoleType,
  type Sponsorship,
  type Stage,
  type TailorDecision,
  type TailorResult,
} from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

import atsMock from "@/mocks/ats.json";
import botRunsMock from "@/mocks/bot-runs.json";
import feedMock from "@/mocks/feed.json";
import gapsMock from "@/mocks/gaps.json";
import interviewMock from "@/mocks/interview.json";
import resumeMock from "@/mocks/resume.json";
import tailorMock from "@/mocks/tailor.json";

// Mocks are on unless someone explicitly turns them off.
export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS !== "false";

// Mock id for the bot buttons. lib/types.ts requires run ids to be UUIDs.
const MOCK_RUN = { runId: "00000000-0000-4000-8000-0000000000b1" };

/** Thrown when a request fails. `message` is safe to show to the user. */
export class ApiError extends Error {
  /** HTTP status when the error came from a route (e.g. 401), so pages can react to it. */
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const LOGGED_OUT_MESSAGE = "You're logged out. Log in again to continue.";

const MOCK_DELAY_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Core helper. In mock mode, waits a moment (so loading states are visible)
 * and returns `mock`. Otherwise calls the real route. `live: true` skips the
 * mock and always calls the real route. Either way, the result is validated
 * with `schema`.
 */
async function call<T>(
  schema: z.ZodType<T>,
  path: string,
  options:
    | { method?: "GET" | "POST" | "PATCH"; body?: unknown; mock: unknown; live?: false }
    | { method?: "GET" | "POST" | "PATCH"; body?: unknown; live: true },
): Promise<T> {
  if (USE_MOCKS && !options.live) {
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
    // 401 means no valid session (routes say "Not signed in"); say what to do instead.
    if (res.status === 401) throw new ApiError(LOGGED_OUT_MESSAGE, 401);
    const message =
      json && typeof json === "object" && "error" in json && typeof json.error === "string"
        ? json.error
        : `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
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
  // location, then sponsorship, then role type. Blank values are left off.
  if (filters.location) params.set("location", filters.location);
  if (filters.sponsorship) params.set("sponsorship", filters.sponsorship);
  if (filters.roleType) params.set("roleType", filters.roleType);
  const qs = params.toString();

  // Always real (live: true), even with mocks on: GET /api/feed is finished and
  // returns FeedItem[] (same schema), already sorted with hard mismatches last.
  // Saving the profile rescores through the real POST /api/match, so a mocked
  // feed would never show the result (e.g. sponsorship hard-mismatch badges).
  return call(z.array(feedItemSchema), `/api/feed${qs ? `?${qs}` : ""}`, { live: true });
}

/**
 * Finds one job. There is no single-job route.
 * Mock ids such as job-02 are not in the live feed. With mocks on, those ids
 * come from mocks/feed.json. Real uuid jobs still come from GET /api/feed.
 */
export async function getFeedItem(jobId: string) {
  if (USE_MOCKS) {
    const mocks = parseOrThrow(z.array(feedItemSchema), feedMock, "mocks/feed.json");
    const mockItem = mocks.find((item) => item.job.id === jobId);
    if (mockItem) return mockItem;
  }
  const feed = await getFeed();
  const item = feed.find((f) => f.job.id === jobId);
  if (!item) throw new ApiError("Job not found");
  return item;
}

// Always real (live: true), even with mocks on: Miranda's POST /api/match is
// finished, and a mocked rescore would hide whether the saved profile works.
export function refreshMatches() {
  return call(matchRefreshSchema, "/api/match", { method: "POST", body: {}, live: true });
}

// ---------------------------------------------------------------- resume

// Always real (live: true), even with mocks on: POST /api/resume is finished,
// and only the real route stores the PDF and actually reads the student's résumé.
// It needs a signed-in user (401 "Not signed in" otherwise).
export function uploadResume(file: File) {
  const form = new FormData();
  form.append("file", file);
  return call(resumeUploadSchema, "/api/resume", { method: "POST", body: form, live: true });
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

const TAILOR_STORAGE_PREFIX = "umass-cc:tailor:";

function tailorStorageKey(jobId: string) {
  return `${TAILOR_STORAGE_PREFIX}${jobId}`;
}

function readMockTailoring(jobId: string): TailorResult | null {
  if (typeof window === "undefined") return null;
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(tailorStorageKey(jobId));
  } catch {
    throw new ApiError("Could not load saved tailoring.");
  }
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    throw new ApiError("Could not load saved tailoring.");
  }
  return parseOrThrow(tailorResultSchema, json, "saved tailoring");
}

function writeMockTailoring(jobId: string, result: TailorResult) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(tailorStorageKey(jobId), JSON.stringify(result));
  } catch {
    throw new ApiError("Could not save decisions.");
  }
}

/**
 * Latest tailoring for this job, or null when the student has not run one.
 * There is no GET /api/tailor. Mock mode reads sessionStorage. Real mode
 * reads the newest tailorings row for this user and job. Blocked reasons are
 * only on the POST response, so a row comes back with an empty blocked list.
 */
export async function getLatestTailoring(jobId: string): Promise<TailorResult | null> {
  if (USE_MOCKS) return readMockTailoring(jobId);
  if (!AUTH_ENABLED) return null;

  const supabase = createClient();
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("tailorings")
    .select("id, user_id, job_id, resume_id, bullet_diffs, rejected_count, created_at")
    .eq("user_id", userId)
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ApiError("Could not load saved tailoring.");
  if (!data) return null;

  const row = parseOrThrow(tailoringRowSchema, data, "tailorings");
  return {
    tailoringId: row.id,
    diffs: row.bullet_diffs,
    blocked: [],
    rejectedCount: row.rejected_count,
  };
}

/**
 * Saves accept/reject decisions. Mock mode does not call PATCH: the mock
 * tailoring id is not a uuid. `snapshot` is the full result (statuses and
 * blocked reasons) written to sessionStorage after that mock save succeeds.
 * Real mode ignores `snapshot`; PATCH already stores bullet_diffs.
 */
export async function saveTailorDecisions(
  tailoringId: string,
  decisions: TailorDecision[],
  snapshot?: { jobId: string; result: TailorResult },
) {
  const ok = await call(okSchema, "/api/tailor", {
    method: "PATCH",
    body: { tailoringId, decisions },
    mock: { ok: true },
  });
  if (USE_MOCKS && snapshot) writeMockTailoring(snapshot.jobId, snapshot.result);
  return ok;
}

// ---------------------------------------------------------------- tracker

// Always real (live: true), even with mocks on. A mocked board would hide a
// save from the feed, and the tracker reads the same /api/applications rows.
export function getApplications() {
  return call(z.array(applicationSchema), "/api/applications", { live: true });
}

export function addApplication(jobId: string) {
  return call(okSchema, "/api/applications", { method: "POST", body: { jobId }, live: true });
}

export function updateApplication(update: { id: string; stage?: Stage; deadline?: string | null }) {
  return call(okSchema, "/api/applications", { method: "PATCH", body: update, live: true });
}

// ---------------------------------------------------------------- bot activity

export function getBotRuns() {
  return call(z.array(botRunSchema), "/api/ingest/runs", { mock: botRunsMock });
}

export function runScout() {
  return call(runIdSchema, "/api/ingest/run", {
    method: "POST",
    body: { trigger: "manual" },
    mock: MOCK_RUN,
  });
}

export function refreshCourses() {
  return call(runIdSchema, "/api/ingest/courses", { method: "POST", mock: MOCK_RUN });
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

// createClient() (lib/supabase/client.ts) keeps the session in cookies so the
// server (proxy.ts, API routes) sees it. It throws if the Supabase values are
// missing, so every function below checks AUTH_ENABLED before calling it.

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
  const { data, error } = await createClient().auth.signUp({
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
  const { error } = await createClient().auth.signInWithPassword({
    email: input.email.trim(),
    password: input.password,
  });
  if (error) throw new ApiError(friendlyAuthError(error.message));
}

export async function signOut() {
  if (!AUTH_ENABLED) return;
  const { error } = await createClient().auth.signOut();
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
  // Job preferences (PROF-3). POST /api/match reads these; needs_sponsorship drives hard mismatches.
  needs_sponsorship: boolean;
  open_to_relocation: boolean;
  preferred_locations: string[];
  /** Minimum yearly pay in USD (lib/match/score.ts compares it with yearly posting pay). */
  min_pay: number | null;
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
  const { data, error } = await createClient().auth.getUser();
  if (error || !data.user) throw new ApiError(LOGGED_OUT_MESSAGE, 401);
  return data.user.id;
}

/** The signed-in student's profile row and experiences. */
export async function getMyProfile() {
  if (!AUTH_ENABLED) {
    await sleep(MOCK_DELAY_MS);
    return mockProfile();
  }
  const supabase = createClient();
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
  const supabase = createClient();
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
