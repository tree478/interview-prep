# TASKS.md — UMass Career Coach (HackUMass XIV) · P0 task list

> Source of truth for **who builds what**. The PRD (`PRD.md`) is the source of truth for **what the product does**. If the two disagree, the PRD wins. Raise the conflict with the team and don't guess.

| Person | Role (PRD §8) | Tools | Task prefix |
|---|---|---|---|
| **Brody** | A — Frontend / UX | Claude Code | `A-` |
| **Miranda** | B — Resume and AI core, **schema + types owner** | Cursor Pro | `B-` |
| **Soumya** | C — Bots, data and pitch | Cursor Pro + Claude Code | `C-` |

---

## 0. AGENT BOOTSTRAP — paste this into your agent the first time you open the repo

```text
You are a coding agent on a 3-person, 36-hour hackathon team building "UMass Career Coach"
(Next.js App Router + TypeScript strict + Tailwind + shadcn/ui, Supabase, Gemini, Grok/xAI, Vercel).

STEP 1 — Load context. Read these files fully before doing anything else:
  1. PRD.md (product requirements; requirement IDs like AUTH-1, MATCH-4, TAILOR-3a)
  2. TASKS.md (this task list: owners, folders, contracts, task order)
  3. CLAUDE.md and .cursor/rules/project.mdc (team rules)
  4. lib/types.ts and supabase/migrations/ (if they exist yet)
Then run: git status, git branch --show-current, git log --oneline -15 main

STEP 2 — Identify me. Ask me ONE question: "Are you Brody (A), Miranda (B) or Soumya (C)?"
Wait for the answer. From then on, only my section of TASKS.md is my work.

STEP 3 — Sync my branch. Make sure I'm on my own branch (not main). If it doesn't exist, create it
from main. Then: git fetch origin && git merge origin/main. If there are conflicts, stop and show me.

STEP 4 — Report status in under 15 lines:
  - My tasks, each marked done / in progress / not started (check the checkboxes in my section AND
    whether the files the task creates actually exist).
  - For my next 2 unstarted tasks: are their dependencies done on main? If a dependency isn't on main
    yet, say which mock/contract I should build against instead (TASKS.md §2).
  - Anything on main that looks broken (run `npm run build` once and report errors).

STEP 5 — Wait. When I paste a task ID or task text, do NOT write code yet. Produce a BUILD PROMPT
for that task that includes:
  - Goal (1–2 sentences) and the PRD requirement IDs it covers
  - Exact files to create/edit (ONLY inside my owned folders, TASKS.md §1)
  - The relevant types/contracts copied from lib/types.ts or TASKS.md §2
  - Step-by-step implementation plan
  - Hard rules that apply (below)
  - "Done when" checks copied from the task, plus how to verify each one
Show me the prompt. I will either hand it to a builder agent or tell you to execute it.

HARD RULES (always, for every task):
  - Edit only files in my owned folders (TASKS.md §1). If a change is needed in someone else's
    folder, stop and write me a short message I can send to that owner.
  - Shared types live ONLY in lib/types.ts (owner: Miranda). Others import from it, never redefine.
    If a type is missing, use a local type with a // TODO(types) comment and tell me.
  - Every Gemini/Grok response: structured JSON output -> parsed with a zod schema -> on failure retry
    once -> then return a clear error. Never use raw model JSON.
  - Resume tailoring may only rephrase an existing bullet. It never adds skills, employers or numbers.
  - API keys (GEMINI_API_KEY, XAI_API_KEY, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET) are server-only.
    Never import them in client components or prefix them with NEXT_PUBLIC_.
  - No resume text or user identities are ever sent to Grok.
  - Small commits with the task ID in the message ("B-4: match scoring"). Run `npm run build`
    before every push. Open a small PR to main every 2–3 hours, after merging origin/main locally.
  - When a task is done, tick its checkbox in MY section of TASKS.md only (avoids merge conflicts).
  - Don't add dependencies without saying so in the PR description.
  - P1/P2 items are out of scope unless TASKS.md says otherwise.
```

---

## 1. Folder ownership (who may edit what)

| Path | Owner | Notes |
|---|---|---|
| `app/(auth)/**`, `app/(dashboard)/**`, all `app/**/page.tsx`, `layout.tsx` | Brody | All pages and UI |
| `components/**` | Brody | |
| `mocks/**` | Brody | Mock JSON matching `lib/types.ts` |
| `app/api/applications/**` | Brody | Tracker CRUD. PRD says A/B, moved to Brody to unload Miranda |
| `lib/types.ts` | **Miranda only** | Everyone else asks Miranda for changes |
| `supabase/migrations/**` | **Miranda only** | Schema, RLS, triggers |
| `lib/ai/**` (except `lib/ai/interview.ts`), `lib/resume/**`, `lib/match/**`, `lib/gaps/**` | Miranda | |
| `app/api/resume`, `match`, `feed`, `gaps`, `ats`, `tailor` | Miranda | |
| `app/api/ingest/**`, `lib/ingest/**` | Soumya | Scout Bot, Grok client, course sync |
| `app/api/interview/**`, `lib/ai/interview.ts` | Soumya | Moved from Miranda (demo-optional, unloads Miranda) |
| `scripts/**`, `data/**`, `vercel.json` | Soumya | Seeds, backfill, reset-demo, cron |
| `docs/**` (Devpost draft, screenshots) | Soumya | |
| `lib/supabase/**` (clients) | Already done in setup. Changes go through Miranda | |

---

## 2. Contracts (build against these NOW, before the real code exists)

Miranda turns these into `lib/types.ts` in **B-1**. Until then, Brody mocks them and Soumya codes against them. If Miranda changes a shape, she posts the change in the team chat.

```ts
// ---- shared
type Stage = 'saved' | 'applied' | 'interviewing' | 'offer';
type RoleType = 'internship' | 'new_grad' | 'other';
type Sponsorship = 'yes' | 'no' | 'unknown';

interface ParsedResume {
  academics: { year: string | null; majors: string[]; minors: string[]; honors: string[];
               clubs: { name: string; role: string | null }[] };
  experiences: { company: string; position: string; start_date: string | null;
                 end_date: string | null; bullets: string[]; skills: string[] }[];
  skills: string[];      // canonical names, no cap (UI shows top 20 + "Show all")
  interests: string[];   // max 10
}

interface JobSummary { id: string; company: string; title: string; location: string | null;
  url: string; roleType: RoleType; sponsorship: Sponsorship; postedAt: string | null;
  deadline: string | null; }

interface RequirementCheck { name: 'major' | 'grad_year' | 'location' | 'sponsorship' | 'pay';
  passed: boolean; detail: string; }

interface MatchResult {
  score: number | null;            // 0–100; null = "N/A" (MATCH-6)
  covered: string[]; missing: string[];                    // required skills
  preferredCovered: string[]; preferredMissing: string[];
  checks: RequirementCheck[];
  hardMismatch: string | null;     // e.g. "Needs sponsorship; posting won't sponsor" (MATCH-4)
}
interface FeedItem { job: JobSummary; match: MatchResult; }

interface UmassResource { id: string; type: 'course' | 'lab'; name: string; url: string;
  description: string; code?: string; instructors?: string[];
  faculty?: { name: string; profile_url: string }[]; }

interface AtsReport { missingSections: ('Education' | 'Experience' | 'Skills')[];
  keywordCoverage: number | null;  // 0–1, null if no job given
  issues: { type: 'missing_section' | 'low_keyword_coverage'; detail: string }[]; }

interface BulletDiff { id: string; experienceIndex: number; before: string; after: string;
  status: 'proposed' | 'accepted' | 'rejected'; }
interface TailorResult { tailoringId: string; diffs: BulletDiff[];
  blocked: { before: string; attempted: string; reason: string }[]; rejectedCount: number; }

interface Application { id: string; job: JobSummary; stage: Stage; deadline: string | null;
  deadlineSource: 'user' | 'posting' | null; matchScore: number | null; updatedAt: string; }

interface BotRun { id: string; kind: 'scout' | 'courses'; status: 'running' | 'done' | 'failed';
  trigger: 'cron' | 'manual'; startedAt: string; finishedAt: string | null;
  companiesSelected: { company: string; reason: string; fallback: boolean }[];
  jobsAdded: number; jobsExtracted: number;
  courseStats?: { found: number; added: number; changed: number; removed: number; unchanged: boolean };
  errors: string[]; }

interface InterviewQuestion { id: string; type: 'behavioral' | 'resume'; text: string; }
interface StarFeedback { situation: StarPart; task: StarPart; action: StarPart; result: StarPart;
  improvement: string; }
interface StarPart { rating: 1 | 2 | 3 | 4 | 5; comment: string; }
```

| Route | Owner | Request → Response |
|---|---|---|
| `POST /api/resume` | Miranda | multipart `file` (PDF) → `{ resumeId, parsed: ParsedResume, ats: AtsReport }` |
| `POST /api/match` | Miranda | `{}` (uses session user) → `{ updated: number }` |
| `GET /api/feed` | Miranda | `?location=&sponsorship=&roleType=` → `FeedItem[]` (sorted per MATCH-4/6) |
| `POST /api/gaps` | Miranda | `{ jobId }` → `{ gaps: { skill: string; resources: UmassResource[] }[] }` |
| `POST /api/ats` | Miranda | `{ jobId }` → `AtsReport` |
| `POST /api/tailor` | Miranda | `{ jobId }` → `TailorResult` |
| `PATCH /api/tailor` | Miranda | `{ tailoringId, decisions: { id, status }[] }` → `{ ok: true }` |
| `GET/POST/PATCH /api/applications` | Brody | GET → `Application[]`; POST `{ jobId }`; PATCH `{ id, stage?, deadline? }` |
| `POST /api/ingest/run` | Soumya | `{ trigger }` → `{ runId }` (returns fast, work continues, UI polls) |
| `GET /api/ingest/runs` | Soumya | → `BotRun[]` (newest first, last 20) |
| `POST /api/ingest/courses` | Soumya | → `{ runId }` |
| `POST /api/interview` | Soumya | `{ jobId, action: 'questions' }` → `InterviewQuestion[]`; `{ jobId, action: 'grade', questionId, question, answer }` → `StarFeedback` |

---

## 3. Timeline and gates

Assumes hacking started **Fri 9:00 pm**, so it's ~hour 12 now (Sat 9 am). Submission is due **Sun 9:00 am**.

| Clock | Hour | Gate / checkpoint |
|---|---|---|
| Sat 11:00 am | 14 | **Contracts gate:** B-1 merged (schema, `lib/types.ts`, `data/skills.json` seeded). Everyone merges main |
| Sat 2:00 pm | 17 | Resume upload → autofill works on main. ≥100 real postings ingested (un-extracted is OK) |
| Sat 5:00 pm | 20 | Feed shows real scores. Gaps + ATS endpoints live. UI wired to real APIs |
| **Sat 9:00 pm** | **24** | **End-to-end gate:** sign-up → score → gaps → ATS → tailor → tracker on the deployed URL. If it fails, all hands fix the core path, no new features |
| Sun 3:00 am | 30 | **Feature freeze.** Interview readiness check (PRD §5.8). Pick driver + narrator |
| Sun 5:00 am | 32 | Backup demo video recorded. Devpost draft complete |
| Sun 8:00 am | 35 | **Submit Devpost** (1 h buffer). Raffle opt-in checked |

---

## 4. Tasks

Format: **ID — title** · PRD refs · depends on · then details and a "Done when" check.
The order within each person's section is the build order.

### Brody (A) — Frontend / UX · Claude Code

- [x] **A-1 — Mocks + app shell** · PRD §4 · depends on: nothing
  - `mocks/` with one JSON file per contract in §2: 12 `FeedItem`s (include 1 hard-mismatch, 1 N/A, scores spread 30–90%), 1 `ParsedResume`, gaps for 3 skills (courses + 1 lab with faculty), 1 `AtsReport` missing Skills, 1 `TailorResult` with 4 diffs + 1 blocked ("added a percentage"), 6 `Application`s across stages, 3 `BotRun`s.
  - `lib/api-client.ts` is not yours. Put a fetch wrapper in `components/lib/api.ts` with a `USE_MOCKS` flag (env `NEXT_PUBLIC_USE_MOCKS`) so every page switches from mocks to real routes with one change.
  - Dashboard layout: sidebar/nav with Feed, Tracker, Profile, Bot activity, Interview. Use shadcn/ui.
  - **Done when:** every page route exists and renders mock data. `npm run build` passes.

- [x] **A-2 — Sign-up + log-in** · AUTH-1, AUTH-2 · depends on: setup (Supabase client)
  - Sign-up form: full name, email, password. Client-side check that the email ends in `@umass.edu`, with an inline error. Miranda's DB trigger (B-1) enforces it server-side too.
  - Log-in form. Session persists (Supabase SSR cookies). Middleware redirects logged-out users from `/dashboard/**` to `/login`.
  - **Done when:** a `@umass.edu` user can sign up, log out and log back in. `test@gmail.com` is refused with a clear message.

- [x] **A-3 — Resume upload + autofill review screen** · AUTH-3, AUTH-4, AUTH-5, PROF-1 · depends on: A-2, contract (real: B-3)
  - After sign-up: PDF drop zone → `POST /api/resume` → loading state ("Reading your resume…", can take up to 20 s) → editable form prefilled from `ParsedResume`.
  - Sections: Academics (year, majors, minors, honors, clubs + e-board role), Experiences (add/remove/edit, bullets editable), Skills (chips, top 20 + "Show all", add/remove), Interests (max 10, enforce).
  - Save writes `profiles` + `experiences` via the Supabase client (RLS protects it), then calls `POST /api/match`, then routes to the feed.
  - Show the ATS `missingSections` result here as a small "possible issues" note (full UI is in A-6).
  - **Done when:** upload → edit one field → save → reload shows saved values. Works on mocks and then on the real route.

- [ ] **A-4 — Profile + job preferences page** · PROF-1, PROF-3 · depends on: A-3
  - Same editable profile as A-3, reachable from the dashboard. Add preferences: needs sponsorship (toggle), open to relocation (toggle), preferred locations (tag input), minimum pay (number).
  - On save, call `POST /api/match` so scores refresh.
  - **Done when:** changing "needs sponsorship" to yes and saving changes the feed (hard-mismatch flags appear).

- [ ] **A-5 — Job feed** · JOB-5, MATCH-4, MATCH-5, MATCH-6 · depends on: A-1, contract (real: B-5)
  - Calls `GET /api/feed`. Keep the server's order (it already sorts). Filters: location, sponsorship, role type → query params.
  - Card: title, company, location, big score ("82%" or "N/A"), bullets "Has Python, React" / "Missing Docker", requirement checks, a red **"Hard mismatch: <reason>"** badge when set, "No required skills listed" when N/A.
  - Buttons on each card: View posting (external), See gaps & tailor (→ job detail), **Add to tracker** (TAILOR-5).
  - **Done when:** the mock feed shows all three card states (normal, hard mismatch, N/A) correctly. Filters change the request.

- [ ] **A-6 — Job detail: gap plan, ATS check, tailoring diff** · GAP-1, ATS-1, ATS-2, TAILOR-1/2/3, TAILOR-5 · depends on: A-5, contracts (real: B-6, B-7, B-8)
  - Route `/dashboard/jobs/[id]`. Top: score card (reuse from A-5).
  - **Gaps panel** (`POST /api/gaps`): per missing skill, course cards (code, title, instructors, link to the CICS page) and lab cards (name, faculty names linked to profiles). If none: "No UMass match found for <skill>".
  - **ATS panel** (`POST /api/ats`): list issues labeled **"Possible issues"**. When any exist, show a callout: "Consider talking to UMass Career Services about your resume" (link to the Career Services site, no booking).
  - **Tailor** button → `POST /api/tailor` → per-bullet before/after diff (highlight changed words), Accept/Reject on each, then save via `PATCH /api/tailor`. Show "**N rewrites blocked**" with each reason (expandable).
  - "Add to application tracker" button here too.
  - **Done when:** all three panels render from mocks and then from real routes for one job, and accept/reject persists on reload.

- [ ] **A-7 — Applications API + tracker board** · TRACK-1, TRACK-2, TRACK-3, TRACK-5, TAILOR-5 · depends on: B-1 (tables)
  - `app/api/applications/route.ts`: GET (user's applications joined with job + match score), POST `{ jobId }` (stage `saved`; prefill deadline from `jobs.deadline` with `deadline_source='posting'`; ignore duplicates), PATCH `{ id, stage?, deadline? }` (a user-set deadline sets `deadline_source='user'`). Validate bodies with zod. Use the session user, never a user id from the body.
  - Board: four columns (Saved, Applied, Interviewing, Offer). Within a column, sort by soonest deadline, with no-deadline cards last labeled "No deadline".
  - Card: title, company, score, deadline date picker, stage dropdown (no drag-and-drop needed).
  - **Done when:** add from feed → appears in Saved → set deadline → card re-sorts → move to Applied → survives reload.

- [ ] **A-8 — Bot activity panel** · JOB-4, GAP-2b · depends on: contract (real: C-5, C-7)
  - Polls `GET /api/ingest/runs` every 3 s while any run has `status: 'running'`, otherwise every 30 s.
  - Buttons: **Run Scout now** (`POST /api/ingest/run { trigger: 'manual' }`) and **Refresh courses** (`POST /api/ingest/courses`). Disable while running.
  - Each run row: time, trigger badge (cron/manual), kind, status, companies Grok chose with the reason for each (mark fallback picks), jobs added, jobs extracted, errors (red, collapsible), course stats for course runs.
  - **Done when:** clicking Run Scout now shows a "running" row that turns into "done" with companies and reasons, without a page refresh.

- [ ] **A-9 — Interview prep UI** · PREP-1, PREP-2, PREP-3 · depends on: contract (real: C-10)
  - From a job detail page or tracker card: "Practice interview" → `/dashboard/jobs/[id]/interview`. Generate questions (behavioral and resume, labeled). Pick one → textarea → Submit → STAR card: four parts, each with a 1–5 rating and a comment, plus a suggested improvement.
  - **Done when:** works end to end on mocks, then on the real route.

- [ ] **A-10 — Wire to real APIs + demo polish** · NFR Accessibility · depends on: the B/C routes being on main
  - Flip `USE_MOCKS` off. Fix shape mismatches by asking Miranda, not by editing types. Add loading/error states for every AI call (show the error message from the route).
  - Polish only the demo path (PRD §11): home page hook line, sign-up, feed, job detail, tracker, bot panel. Labeled form fields, keyboard navigation, contrast.
  - **Done when:** the full PRD §11 demo runs on the deployed URL with mocks off.

### Miranda (B) — Resume and AI core · Cursor

> Take **Cursor Agent-mode screenshots** throughout the day (SpaceXSI prize) and drop them in the team folder for Soumya. Your AI-core work is the strongest evidence that Cursor is the team's core agent.

- [x] **B-1 — Schema, RLS, types, skills seed (CONTRACTS GATE, highest priority)** · PRD §7.2, NFR Privacy, MATCH-2 · depends on: setup · **target Sat 11 am**
  - Migration for every table in PRD §7.2, plus: `bot_runs.kind` (`scout`/`courses`), `bot_runs.status`, `bot_runs.course_stats jsonb`, `bot_runs.jobs_extracted int`, `jobs.role_type`, `jobs.extraction_attempts int`, `matches` unique (`user_id`, `job_id`), `applications` unique (`user_id`, `job_id`), `jobs` unique (`source`, `external_id`), `umass_resources` unique (`type`, `name`).
  - RLS: `profiles`, `experiences`, `resumes`, `matches`, `applications`, `tailorings`, `interview_sessions` are readable/writable only by `auth.uid() = user_id`. `jobs`, `companies`, `skills`, `umass_resources`, `bot_runs`, `company_briefs` are readable by authenticated users and writable only by the service role.
  - Trigger on `auth.users` insert: reject emails not ending in `@umass.edu` (AUTH-1, server-side). Trigger: create a `profiles` row with `full_name` from user metadata.
  - Private storage bucket `resumes` with per-user folder policies.
  - SQL view or RPC for Soumya's JOB-3a: per company, the count of saves/applications (aggregates only, no user ids).
  - `lib/types.ts` from §2 plus DB row types. Seed the `skills` table from `data/skills.json` (Soumya writes the JSON in C-1. If it isn't there yet, seed from Appendix A yourself and tell her).
  - **Done when:** migration applies cleanly to the Supabase project, `lib/types.ts` merged to main, the team is told "contracts are in".

- [x] **B-2 — Gemini helper + skill canonicalizer** · NFR AI validation, MATCH-2 · depends on: B-1
  - `lib/ai/gemini.ts`: `callGeminiJSON<T>(schema: ZodSchema<T>, prompt, opts)` uses structured JSON output (response schema), parses with zod, retries once on parse/validation failure, then throws a typed `AIError` with a readable message. Model from env `GEMINI_MODEL`. Timeout handling.
  - `lib/match/skills.ts`: `canonicalize(raw: string[]): { canonical: string[]; dropped: string[] }` using names + aliases from `data/skills.json`. Case-insensitive, except short names (C, R, Go) match whole-word and case-sensitive (Appendix A rules). Unit tests for "JS"→JavaScript, "Postgres"→PostgreSQL, "go to market"→not Go, "R&D"→not R.
  - **Done when:** tests pass, and a sample call returns a zod-validated object.

- [x] **B-3 — `extractPosting` (unblocks Soumya)** · MATCH-1, MATCH-1a, MATCH-2 · depends on: B-2 · **target Sat noon**
  - `lib/ai/extractPosting.ts`: `extractPosting(job: { title; company; location; description }) → PostingExtraction` (required skills, preferred skills, majors, graduation window, location(s), remote, sponsorship yes/no/unknown, pay range, role type), zod-validated, with skills run through `canonicalize`. Return `dropped` skills separately so Soumya can save `jobs.dropped_skills`.
  - Export the zod schema and type. Tell Soumya the signature as soon as it's merged.
  - **Done when:** it runs on 3 real Greenhouse postings and the output looks right by eye.

- [x] **B-4 — `POST /api/resume`** · AUTH-3, AUTH-4, ATS-1 (sections), NFR Performance · depends on: B-2
  - Upload the PDF to the `resumes` bucket under `{user_id}/`. Extract text with `unpdf` (not pdf-parse). Gemini → `ParsedResume` (zod, canonical skills, interests ≤10). Deterministic section check (Education / Experience / Skills headings in the raw text) → `AtsReport.missingSections`.
  - Save a `resumes` row (`raw_text`, `parsed_json`, `ats_report`). Do **not** write `profiles` here. The UI saves after the user edits (AUTH-5).
  - **Done when:** 3 team resumes parse in under 20 s with ≥80% of fields correct (PRD success metric). Note which fields fail.

- [x] **B-5 — Match scoring + `POST /api/match` + `GET /api/feed`** · MATCH-3, MATCH-4, MATCH-5, MATCH-6, JOB-5, NFR Cost · depends on: B-3, some extracted jobs from C-5
  - `lib/match/score.ts` (pure, unit-tested): score = 0.5R + 0.2P + 0.3Q. If there are no preferred skills or no applicable checks, that weight moves to R. No required skills → `score: null`. Hard mismatch (needs sponsorship + posting says no, or grad year outside window) → cap at 40 with a reason. Use **all** profile skills plus experience skills.
  - `POST /api/match`: recompute for the session user against all `extraction_status='done'` jobs where there's no match row or the profile/job changed since `computed_at`. Upsert `matches`.
  - `GET /api/feed`: join jobs + matches for the user, apply filters, sort: scored (desc) → N/A → hard mismatch last. Hide jobs not extracted. Must load in under 2 s from cached rows.
  - **Done when:** unit tests cover normal / N/A / hard-mismatch / weight redistribution, and the feed returns real scored jobs.

- [ ] **B-6 — `POST /api/gaps`** · GAP-1, GAP-2, NFR Grounded recommendations · depends on: B-5, C-7 (course data) or the C-8 seed
  - Deterministic: for each missing required/preferred skill on the job's match, select `active` `umass_resources` whose `skills[]` contain it. Courses first, then labs. Max 3 per skill. Return "no match" (empty array) rather than anything invented. No Gemini at P0 (GAP-3 is P1).
  - **Done when:** the demo posting's missing skills each return at least one real CICS course or lab.

- [x] **B-7 — `POST /api/ats`** · ATS-1, ATS-2 · depends on: B-4, B-3
  - Reuse `missingSections` from the latest resume. Keyword coverage = the share of the posting's canonical skills (required + preferred) found in the resume raw text via `canonicalize`. Flag `low_keyword_coverage` below 50% (tunable constant). Wording: "possible issue".
  - **Done when:** the demo resume (no Skills section) returns a missing_section issue.

- [x] **B-8 — Number normalization + fabrication check + tests** · TAILOR-3, TAILOR-3a · depends on: B-2
  - `lib/resume/numbers.ts` exactly per TAILOR-3a (commas, written numbers to 999,999 incl. hyphenated and "a dozen", k/m/b, percent/%, ranges split, vague quantities as claims, don't convert "one"/"a"/ordinals).
  - `lib/resume/fabrication.ts`: `checkBullet(original, rewritten, knownEmployers) → { ok; reasons[] }`. Reject if the rewrite has any canonical skill, employer name or normalized number not in **that same original bullet**.
  - **≥20 before/after unit tests** (PRD requirement), including "increased sales by 40%" added from nothing, "5k"↔"5000" being OK, a skill moved from another bullet being rejected.
  - **Done when:** `npm test` is green with ≥20 cases.

- [x] **B-9 — `POST /api/tailor` + `PATCH /api/tailor`** · TAILOR-1, TAILOR-2, TAILOR-3 · depends on: B-8, B-3
  - Gemini rewrites **existing bullets only** to emphasize the posting's skills the student already has (prompt + zod schema returns one rewrite per input bullet id). Run `checkBullet` on each. On fail, retry that bullet once, then drop it into `blocked` with the reason. Save a `tailorings` row (`bullet_diffs`, `rejected_count`). Under 15 s (batch all bullets in one call).
  - PATCH saves accept/reject decisions into `bullet_diffs`.
  - **Done when:** running on the demo posting returns diffs, at least one fabrication is caught in testing, and decisions persist.

- [ ] **B-10 — Integration support + pre-warm** · NFR Performance · depends on: everything above
  - Fix shape mismatches Brody reports (types change only through you). Pre-warm: run match + tailor for the demo user/posting. Help Soumya pick the demo posting (score 75–85%, gaps covered by CICS) plus one hard-mismatch and one N/A posting.
  - **Done when:** the PRD §11 run of show works on the deployed URL twice in a row.

### Soumya (C) — Bots, data and pitch · Cursor + Claude Code

> Use Cursor as the primary agent for your ingest/bot code so the SpaceXSI "Cursor as core agent" claim is true. Take Agent-mode screenshots as you go.

- [x] **C-1 — `data/skills.json` from Appendix A** · MATCH-2 · depends on: nothing · **do first, Miranda needs it for B-1**
  - `[{ canonical_name, aliases[], category }]` for every row in PRD Appendix A. Mark short names (C, R, Go) with `"whole_word_case_sensitive": true`.
  - **Done when:** valid JSON on main, and every Appendix A skill is present (count them).

- [x] **C-2 — Company list (curated + verified)** · JOB-1, open question §10 · depends on: nothing
  - `data/companies.json`: 15–25 companies that hire UMass students, each `{ name, source: 'greenhouse'|'lever', slug }`. Verify every slug actually returns jobs (`boards-api.greenhouse.io/v1/boards/{slug}/jobs`, `api.lever.co/v0/postings/{slug}?mode=json`). Drop empty ones. You need **≥10 companies and ≥100 postings** total (success metric).
  - `scripts/seed-companies.ts` upserts into `companies`.
  - **Done when:** the seed runs and every company returns ≥1 posting.

- [x] **C-3 — Fetchers + de-dupe** · JOB-1, JOB-2 · depends on: C-2, B-1
  - `lib/ingest/greenhouse.ts`, `lib/ingest/lever.ts`: plain `fetch`, normalize to one `RawPosting` shape (source, external_id, company, title, location, url, description as plain text with HTML stripped, posted_at).
  - `lib/ingest/dedupe.ts`: skip if (`source`, `external_id`) exists. Also skip if normalized (title + company + location) exists (lowercase, collapse whitespace, strip punctuation).
  - **Done when:** a dry-run script prints counts per company, and re-running adds 0 duplicates.

- [x] **C-4 — Grok client + company selection + role filter** · JOB-3, JOB-3a, NFR Privacy · depends on: C-3
  - `lib/ingest/grok.ts`: xAI API call with JSON output + zod + one retry (same pattern as Miranda's Gemini helper, your own file).
  - `selectCompanies()`: input = companies table (name, source, last_checked_at, last_postings_found) + Miranda's aggregate save/apply counts. **No resume text, no user ids.** Output = up to 10 `{ company, reason }`. Then force-add any company not checked in 3+ days. On Grok failure/invalid JSON → fall back to the 10 least recently checked, mark `fallback: true` and log an error.
  - `filterRoles(postings)`: Grok labels each title/location as `internship` / `new_grad` / `other`. Keep internship + new_grad. Batch titles only (cheap). On failure, fall back to a keyword filter (intern, co-op, new grad, entry level, university, graduate).
  - **Done when:** both work against the live xAI API, and the fallback path is tested by forcing an invalid response.

- [x] **C-5 — `POST /api/ingest/run` + `GET /api/ingest/runs` + cron** · JOB-3, JOB-4, MATCH-1a, NFR Reliability · depends on: C-4, B-3
  - Create a `bot_runs` row (`status: running`), return `{ runId }` immediately, then continue the work with Next's `after()` (or `waitUntil`) so the button doesn't hang. Set `maxDuration`.
  - Steps: retry failed extractions (once each) → `selectCompanies` → fetch → `filterRoles` → dedupe → insert jobs (`extraction_status: pending`) → call Miranda's `extractPosting` in batches of 5, **max 40 per run** → save `extracted_json`, `dropped_skills`, `role_type`, status done/failed → update `companies.last_checked_at` / `last_postings_found` → finish the run row (companies + reasons, jobs added, extracted, errors).
  - Auth: manual runs need a logged-in user. Cron runs need `Authorization: Bearer ${CRON_SECRET}`.
  - `vercel.json` daily cron → `/api/ingest/run` and `/api/ingest/courses`. Confirm the Hobby plan cron limit.
  - `GET /api/ingest/runs`: last 20 runs, newest first, shaped as `BotRun`.
  - **Done when:** clicking the button (or curl) produces a logged run with Grok's reasons, and new jobs appear with `extraction_status: done`.

- [x] **C-6 — `scripts/backfill-extraction`** · MATCH-1a · depends on: C-5
  - Loops over pending/failed jobs in batches until **≥100 are extracted**, with a delay between batches for rate limits. Prints the top `dropped_skills` so we can decide whether to extend `skills.json`.
  - **Done when:** ≥100 extracted postings from ≥10 companies in the DB. Run this **by Sat 5 pm** so Miranda can test scoring.

- [x] **C-7 — CICS course sync `POST /api/ingest/courses`** · GAP-2, GAP-2a, GAP-2b, GAP-2c · depends on: B-1, B-2 (Gemini helper)
  - Fetch the course descriptions page (URL in PRD GAP-2), hash the content, and skip the parse if the hash is unchanged (log `unchanged: true`). Parse each course: code, title, instructors, prerequisites, description. Gemini tags skills from the canonical list. zod drops tags not on the list.
  - Sanity check: if the fetch/parse fails or returns <50% of last time's course count → keep the existing data, load `data/umass_resources.json` if the table is empty, and log the error. Courses missing from the page → `active=false` (never delete).
  - Log a `bot_runs` row with `kind: 'courses'` and `course_stats`.
  - **Done when:** the courses table is filled, every course has ≥1 skill tag, and a second run logs "unchanged".

- [x] **C-8 — Seed file with courses + hand-checked demo labs** · GAP-1, GAP-2c · depends on: C-7
  - Export the synced courses to `data/umass_resources.json` (the fallback seed). **Add 3–5 CICS research labs by hand** (name, description, URL, research area, faculty names + public CICS profile URLs, canonical skill tags), picked to cover the demo posting's missing skills (e.g. ML, statistics, distributed systems). This is how P0 GAP-1 shows labs while automated lab sync (GAP-2e) stays P1. Never invent faculty or labs: copy from the real CICS pages.
  - `scripts/seed-resources.ts` upserts the file.
  - **Done when:** gaps for ML / statistics / distributed systems each return a course and a lab with faculty.

- [ ] **C-9 — Demo data + `scripts/reset-demo`** · PRD §11 · depends on: C-6, B-5
  - `scripts/reset-demo.ts`: deletes the demo user (auth + all rows + storage files) so sign-up and autofill happen live. Turn off email confirmation for the demo address/project.
  - With Miranda: choose the demo resume (single column, missing a Skills section, parses ≥80%), the demo posting (75–85%, gaps covered by CICS), one hard-mismatch posting and one N/A posting. Write their job ids into `docs/demo.md`.
  - Make sure 3+ Scout runs are already logged before judging.
  - **Done when:** reset → full demo → reset → full demo works twice.

- [ ] **C-10 — Interview API** · PREP-1, PREP-2, PREP-3 · depends on: B-2 (Gemini helper), B-1 · **after C-1…C-8**
  - `lib/ai/interview.ts` + `app/api/interview/route.ts`. `questions`: 3 behavioral questions from the posting + 2 resume questions from the user's experiences (read from the DB with the session user). `grade`: STAR feedback per §2 contract, under 10 s. Uses `callGeminiJSON` + zod.
  - **Done when:** it passes the PRD §5.8 readiness bar 3 times in a row on the demo posting (relevant questions, under 10 s, no zod failures). Report the result at the Sun 3 am check.

- [ ] **C-11 — Pitch, Devpost, prize compliance** · PRD §8 checklist, §10, §11 · depends on: the demo path working
  - `docs/devpost.md`: problem, solution, how it works, **"How we used Cursor and Grok Bot"** (Cursor = core coding agent; Grok decides which employers to check, filters roles, logs reasons), Gemini usage split into advice / analysis / generation, UMass-specific features, challenges, what's next. Note that Claude Code was also used, and make clear Cursor is the core agent.
  - Collect screenshots: Cursor Agent mode (from Miranda and you), bot activity panel, bot runs.
  - **Ask the MLH rep** (if not already done): is the Grok Bot interpretation OK, and is mixing Claude Code with Cursor allowed?
  - Record the **backup demo video by Sun 5 am**. Rehearse the §11 script 3× with the driver + narrator. Prep the judge Q&A (PRD §10).
  - On submission: opt in to the "Make it Legendary with SpaceXSI" raffle. Make sure someone is present for judging.
  - **Done when:** every box in the PRD §8 prize compliance checklist is ticked.

---

## 5. Merge protocol (all three)

1. Before starting a task: `git fetch origin && git merge origin/main` on your branch.
2. Commit small, with the task ID in the message. `npm run build` before every push.
3. PR to main every 2–3 hours (or when a task is done). Title it with the task ID. Another teammate glances at it and merges. Don't let PRs sit.
4. Only Miranda merges anything touching `lib/types.ts` or `supabase/migrations/`.
5. Running Claude Code and Cursor on the same laptop (Soumya): use two git worktrees on two branches, e.g. `git worktree add ../cc-soumya-2 -b soumya-2`, and keep them on separate tasks.
6. Broken main: whoever broke it fixes it before anything else. If it isn't fixed within 15 minutes, revert.

## 6. If you're behind at the Sat 9 pm gate — cut in this order

1. Interview prep stays out of the live demo (it's already demo-optional).
2. Role filter → keyword-only (skip the Grok `filterRoles` call. Grok still picks the companies).
3. Labs → seed file only (already the plan).
4. Feed filters → sponsorship only.
5. Tracker → no date picker, show posting deadline only. **Not recommended**: TRACK-5 is P0 and in the demo.

Never cut: the fabrication check, zod validation, the Grok company selection log, `@umass.edu` sign-up, or CICS gaps. Those are the pitch and the prize requirements.
