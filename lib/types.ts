import { z } from "zod";

// Shared contracts for TASKS.md §2, plus one zod schema per database table.
// Import from here. Do not redefine these types anywhere else.

export const stageSchema = z.enum([
  "saved",
  "applied",
  "interviewing",
  "offer",
]);
export type Stage = z.infer<typeof stageSchema>;

export const roleTypeSchema = z.enum(["internship", "new_grad", "other"]);
export type RoleType = z.infer<typeof roleTypeSchema>;

export const sponsorshipSchema = z.enum(["yes", "no", "unknown"]);
export type Sponsorship = z.infer<typeof sponsorshipSchema>;

const clubSchema = z.object({
  name: z.string(),
  role: z.string().nullable(),
});

const parsedExperienceSchema = z.object({
  company: z.string(),
  position: z.string(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  bullets: z.array(z.string()),
  skills: z.array(z.string()),
});

export const parsedResumeSchema = z.object({
  academics: z.object({
    year: z.string().nullable(),
    majors: z.array(z.string()),
    minors: z.array(z.string()),
    honors: z.array(z.string()),
    clubs: z.array(clubSchema),
  }),
  experiences: z.array(parsedExperienceSchema),
  skills: z.array(z.string()),
  interests: z.array(z.string()).max(10),
});
export type ParsedResume = z.infer<typeof parsedResumeSchema>;

export const jobSummarySchema = z.object({
  id: z.string(),
  company: z.string(),
  title: z.string(),
  location: z.string().nullable(),
  url: z.string(),
  roleType: roleTypeSchema,
  sponsorship: sponsorshipSchema,
  postedAt: z.string().nullable(),
  deadline: z.string().nullable(),
});
export type JobSummary = z.infer<typeof jobSummarySchema>;

export const postingExtractionSchema = z.object({
  requiredSkills: z.array(z.string()),
  preferredSkills: z.array(z.string()),
  majors: z.array(z.string()),
  graduation: z
    .object({
      startYear: z.number().int().nullable(),
      endYear: z.number().int().nullable(),
    })
    .nullable(),
  locations: z.array(z.string()),
  remote: z.boolean(),
  sponsorship: sponsorshipSchema,
  pay: z
    .object({
      min: z.number().nullable(),
      max: z.number().nullable(),
      interval: z.enum(["hour", "year"]).nullable(),
    })
    .nullable(),
  roleType: roleTypeSchema,
});
export type PostingExtraction = z.infer<typeof postingExtractionSchema>;

export const requirementCheckSchema = z.object({
  name: z.enum(["major", "grad_year", "location", "sponsorship", "pay"]),
  passed: z.boolean(),
  detail: z.string(),
});
export type RequirementCheck = z.infer<typeof requirementCheckSchema>;

export const matchResultSchema = z.object({
  // 0–100. Null means N/A (MATCH-6): the posting listed no required skills.
  score: z.number().min(0).max(100).nullable(),
  covered: z.array(z.string()),
  missing: z.array(z.string()),
  // Not in PRD §7.2. The match card needs preferred-skill coverage.
  preferredCovered: z.array(z.string()),
  preferredMissing: z.array(z.string()),
  checks: z.array(requirementCheckSchema),
  // Not in PRD §7.2. Set when MATCH-4 caps the score, otherwise null.
  hardMismatch: z.string().nullable(),
});
export type MatchResult = z.infer<typeof matchResultSchema>;

export const feedItemSchema = z.object({
  job: jobSummarySchema,
  match: matchResultSchema,
});
export type FeedItem = z.infer<typeof feedItemSchema>;

export const umassResourceSchema = z.object({
  id: z.string(),
  type: z.enum(["course", "lab"]),
  name: z.string(),
  url: z.string(),
  description: z.string(),
  code: z.string().optional(),
  instructors: z.array(z.string()).optional(),
  faculty: z
    .array(
      z.object({
        name: z.string(),
        profile_url: z.string(),
      }),
    )
    .optional(),
});
export type UmassResource = z.infer<typeof umassResourceSchema>;

export const gapsRequestSchema = z.object({
  jobId: z.uuid(),
});
export type GapsRequest = z.infer<typeof gapsRequestSchema>;

export const atsRequestSchema = z.object({
  jobId: z.uuid(),
});
export type AtsRequest = z.infer<typeof atsRequestSchema>;

export const gapSchema = z.object({
  skill: z.string(),
  resources: z.array(umassResourceSchema),
});
export type Gap = z.infer<typeof gapSchema>;

export const gapsResponseSchema = z.object({
  gaps: z.array(gapSchema),
});
export type GapsResponse = z.infer<typeof gapsResponseSchema>;

export const atsReportSchema = z.object({
  missingSections: z.array(z.enum(["Education", "Experience", "Skills"])),
  // 0–1. Null when no job was given.
  keywordCoverage: z.number().min(0).max(1).nullable(),
  issues: z.array(
    z.object({
      type: z.enum(["missing_section", "low_keyword_coverage"]),
      detail: z.string(),
    }),
  ),
});
export type AtsReport = z.infer<typeof atsReportSchema>;

export const bulletDiffSchema = z.object({
  id: z.string(),
  experienceIndex: z.number().int(),
  before: z.string(),
  after: z.string(),
  status: z.enum(["proposed", "accepted", "rejected"]),
});
export type BulletDiff = z.infer<typeof bulletDiffSchema>;

export const tailorResultSchema = z.object({
  tailoringId: z.string(),
  diffs: z.array(bulletDiffSchema),
  blocked: z.array(
    z.object({
      before: z.string(),
      attempted: z.string(),
      reason: z.string(),
    }),
  ),
  rejectedCount: z.number().int(),
});
export type TailorResult = z.infer<typeof tailorResultSchema>;

export const applicationSchema = z.object({
  id: z.string(),
  job: jobSummarySchema,
  stage: stageSchema,
  deadline: z.string().nullable(),
  deadlineSource: z.enum(["user", "posting"]).nullable(),
  matchScore: z.number().nullable(),
  updatedAt: z.string(),
});
export type Application = z.infer<typeof applicationSchema>;

const companySelectionSchema = z.object({
  company: z.string(),
  reason: z.string(),
  fallback: z.boolean(),
});

const courseStatsSchema = z.object({
  found: z.number(),
  added: z.number(),
  changed: z.number(),
  removed: z.number(),
  unchanged: z.boolean(),
});

export const botRunSchema = z.object({
  id: z.string(),
  kind: z.enum(["scout", "courses"]),
  status: z.enum(["running", "done", "failed"]),
  trigger: z.enum(["cron", "manual"]),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  companiesSelected: z.array(companySelectionSchema),
  jobsAdded: z.number(),
  jobsExtracted: z.number(),
  courseStats: courseStatsSchema.optional(),
  errors: z.array(z.string()),
});
export type BotRun = z.infer<typeof botRunSchema>;

export const interviewQuestionSchema = z.object({
  id: z.string(),
  type: z.enum(["behavioral", "resume"]),
  text: z.string(),
});
export type InterviewQuestion = z.infer<typeof interviewQuestionSchema>;

export const starPartSchema = z.object({
  rating: z.literal([1, 2, 3, 4, 5]),
  comment: z.string(),
});
export type StarPart = z.infer<typeof starPartSchema>;

export const starFeedbackSchema = z.object({
  situation: starPartSchema,
  task: starPartSchema,
  action: starPartSchema,
  result: starPartSchema,
  improvement: z.string(),
});
export type StarFeedback = z.infer<typeof starFeedbackSchema>;

// JOB-3a. Counts only — there is no user id in this result.
export const companyEngagementCountSchema = z.object({
  company: z.string(),
  saves: z.number().int().nonnegative(),
  applications: z.number().int().nonnegative(),
});
export type CompanyEngagementCount = z.infer<typeof companyEngagementCountSchema>;

// Database rows. Field names match the columns in
// supabase/migrations/20261114120000_init.sql.

export const profileRowSchema = z.object({
  user_id: z.uuid(),
  full_name: z.string(),
  email: z.string(),
  year: z.string().nullable(),
  majors: z.array(z.string()),
  minors: z.array(z.string()),
  honors: z.array(z.string()),
  clubs: z.array(clubSchema),
  skills: z.array(z.string()),
  interests: z.array(z.string()).max(10),
  needs_sponsorship: z.boolean(),
  open_to_relocation: z.boolean(),
  preferred_locations: z.array(z.string()),
  min_pay: z.number().nullable(),
});
export type ProfileRow = z.infer<typeof profileRowSchema>;

export const experienceRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  company: z.string(),
  position: z.string(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  bullets: z.array(z.string()),
  skills: z.array(z.string()),
});
export type ExperienceRow = z.infer<typeof experienceRowSchema>;

export const resumeRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  storage_path: z.string().nullable(),
  raw_text: z.string().nullable(),
  parsed_json: parsedResumeSchema.nullable(),
  ats_report: atsReportSchema.nullable(),
  uploaded_at: z.string(),
});
export type ResumeRow = z.infer<typeof resumeRowSchema>;

export const skillRowSchema = z.object({
  id: z.uuid(),
  canonical_name: z.string(),
  aliases: z.array(z.string()),
  category: z.string(),
  // Not in PRD §7.2. True only for C, R, and Go.
  whole_word_case_sensitive: z.boolean(),
});
export type SkillRow = z.infer<typeof skillRowSchema>;

export const companyRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  source: z.enum(["greenhouse", "lever"]),
  slug: z.string(),
  active: z.boolean(),
  last_checked_at: z.string().nullable(),
  last_postings_found: z.number().int().nullable(),
});
export type CompanyRow = z.infer<typeof companyRowSchema>;

export const jobRowSchema = z.object({
  id: z.uuid(),
  source: z.enum(["greenhouse", "lever"]),
  external_id: z.string(),
  company: z.string(),
  title: z.string(),
  location: z.string().nullable(),
  url: z.string(),
  description: z.string().nullable(),
  posted_at: z.string().nullable(),
  deadline: z.string().nullable(),
  extracted_json: postingExtractionSchema.nullable(),
  extraction_status: z.enum(["pending", "done", "failed"]),
  dropped_skills: z.array(z.string()),
  ingested_by_run_id: z.uuid().nullable(),
  role_type: roleTypeSchema.nullable(),
  extraction_attempts: z.number().int(),
});
export type JobRow = z.infer<typeof jobRowSchema>;

export const matchRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  job_id: z.uuid(),
  score: z.number().nullable(),
  covered_skills: z.array(z.string()),
  missing_skills: z.array(z.string()),
  // Not in PRD §7.2. Stored for MatchResult.preferredCovered / preferredMissing / hardMismatch.
  preferred_covered: z.array(z.string()),
  preferred_missing: z.array(z.string()),
  hard_mismatch: z.string().nullable(),
  requirement_checks: z.array(requirementCheckSchema),
  computed_at: z.string(),
});
export type MatchRow = z.infer<typeof matchRowSchema>;

export const umassResourceRowSchema = z.object({
  id: z.uuid(),
  type: z.enum(["course", "lab"]),
  name: z.string(),
  url: z.string(),
  skills: z.array(z.string()),
  description: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()),
  source_url: z.string().nullable(),
  content_hash: z.string().nullable(),
  active: z.boolean(),
  last_checked_at: z.string().nullable(),
});
export type UmassResourceRow = z.infer<typeof umassResourceRowSchema>;

export const applicationRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  job_id: z.uuid(),
  stage: stageSchema,
  deadline: z.string().nullable(),
  deadline_source: z.enum(["user", "posting"]).nullable(),
  notes: z.string().nullable(),
  updated_at: z.string(),
});
export type ApplicationRow = z.infer<typeof applicationRowSchema>;

export const tailoringRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  job_id: z.uuid(),
  resume_id: z.uuid(),
  bullet_diffs: z.array(bulletDiffSchema),
  rejected_count: z.number().int(),
  created_at: z.string(),
});
export type TailoringRow = z.infer<typeof tailoringRowSchema>;

export const interviewSessionRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  job_id: z.uuid(),
  questions: z.array(interviewQuestionSchema).nullable(),
  answers: z.unknown().nullable(),
  feedback: z.unknown().nullable(),
  created_at: z.string(),
});
export type InterviewSessionRow = z.infer<typeof interviewSessionRowSchema>;

export const botRunRowSchema = z.object({
  id: z.uuid(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  trigger: z.enum(["cron", "manual"]),
  kind: z.enum(["scout", "courses"]),
  status: z.enum(["running", "done", "failed"]),
  companies_selected: z.array(companySelectionSchema),
  companies_checked: z.number().int(),
  jobs_added: z.number().int(),
  jobs_extracted: z.number().int(),
  briefs_written: z.number().int(),
  course_stats: courseStatsSchema.nullable(),
  errors: z.array(z.string()),
});
export type BotRunRow = z.infer<typeof botRunRowSchema>;

export const companyBriefRowSchema = z.object({
  company: z.string(),
  summary: z.string().nullable(),
  talking_points: z.array(z.string()),
  generated_at: z.string(),
});
export type CompanyBriefRow = z.infer<typeof companyBriefRowSchema>;
