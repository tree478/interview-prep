# UMass Career Coach

HackUMass XIV project. A UMass student uploads a résumé, sees real Greenhouse/Lever internships ranked by an explainable match score, gets a gap plan built only from real CICS courses and labs, and tailors résumé bullets without inventing experience. A Grok Scout Bot picks which employers to check and adds postings. The PRD is the source of truth for scope: build P0 only until the full path works end to end.

## Stack
- Next.js App Router, TypeScript strict, Tailwind v4, shadcn/ui (Radix)
- Supabase: Postgres, Auth (email/password, @umass.edu only), private Storage bucket `resumes` (one folder per user id)
- Gemini via `@google/genai` with structured JSON output; zod (v4) validates every response
- Grok: Grok Bot routine (webhook + schedule) for the Scout Bot; xAI API (openai SDK, baseURL https://api.x.ai/v1) only as fallback
- `unpdf` for PDF text, `cheerio` for the CICS course page, `diff` for bullet diffs, `vitest` for tests, ` for scripts
- Vercel hosting + cron

## Commands
- `npm run dev`: http://localhost:3000
- `npm run build`: must pass before every push
- `npx vitest run`: unit tests
- `npx tsx scripts/<name>.ts`: run a script

## Owners (stay in your folders)
- A, frontend: `app/` pages, `components/`, `mocks/`, `lib/api.ts`
- B, résumé + AI core: `lib/resume/`, `lib/match/`, `lib/ai/`, `app/api/resume|match|tailor|gaps|interview/`, `lib/types.ts`, `supabase/schema.sql`
- C, bots + data: `app/api/ingest/` (run, runs, courses, labs), `scripts/`, `data/`
- Shared, ask before changing: `lib/supabase/`, `app/api/applications/`

Only B changes `lib/types.ts` and the schema. Ask B for changes.

## Rules
- Shared types and zod schemas live only in `lib/types.ts`. Import them; never redefine locally.
- Every Gemini output is parsed with its zod schema. On failure retry once, then return `{ error }`.
- Tailoring only rephrases existing bullets. A rewritten bullet is rejected if it has any skill, employer or (normalized) number t in that same original bullet. Retry once, then drop it.
- Skills are mapped to the canonical list (data/skills.json). Off-list skills are dropped from matching and saved in `jobs.dropped_skills`. Short names (C, R, Go) match only as whole, case-sensitive words.
- Gap recommendations come only from `umass_resources` (CICS courses and labs). The model ranks and explains; it never adds resources, faculty or topics.
- Sponsorship and pay are "unknown" unless a posting states them. Never guess.
- Grok never receives résumé text or user identities, only company names and aggregate counts.
- Secrets (`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `INGEST_KEY`, `CRON_SECRET`, Grok Bot keys) are server-only. Never use them in client components or `NEXT_PUBLIC_` vars.
- The service-role Supabase client is only for ingestion and scripts. User data goes through the user's session so row-level security applies.
- API routes return `{ error: string }` with a proper status code on failure.
- Frontend res `mocks/*.json` through `lib/api.ts` until each real endpoint exists.
- Small commits; `npm run build` passes before pushing; no new dependencies without a reason.
