import { describe, expect, it } from "vitest";
import {
  jobRowSchema,
  matchRefreshSchema,
  okSchema,
  resumeUploadSchema,
  runIdSchema,
} from "./types";

const job = {
  id: "00000000-0000-4000-8000-000000000001",
  source: "greenhouse" as const,
  external_id: "1",
  company: "Acme",
  title: "Intern",
  location: null,
  url: "https://example.com/job",
  description: null,
  posted_at: null,
  deadline: null,
  extracted_json: null,
  extraction_status: "done" as const,
  dropped_skills: [],
  ingested_by_run_id: null,
  role_type: "internship" as const,
  extraction_attempts: 1,
  created_at: "2026-11-14T21:00:00.000Z",
};

describe("jobRowSchema", () => {
  it("keeps created_at", () => {
    expect(jobRowSchema.parse(job).created_at).toBe(job.created_at);
  });

  it("rejects a job row that omits created_at", () => {
    const withoutCreatedAt = Object.fromEntries(
      Object.entries(job).filter(([key]) => key !== "created_at"),
    );
    expect(jobRowSchema.safeParse(withoutCreatedAt).success).toBe(false);
  });
});

describe("route response schemas", () => {
  it("accepts the resume, match, tailor, and ingest responses", () => {
    expect(
      resumeUploadSchema.parse({
        resumeId: "00000000-0000-4000-8000-000000000001",
        parsed: {
          academics: {
            year: null,
            majors: [],
            minors: [],
            honors: [],
            clubs: [],
          },
          experiences: [],
          skills: [],
          interests: [],
        },
        ats: { missingSections: [], keywordCoverage: null, issues: [] },
      }).resumeId,
    ).toBe("00000000-0000-4000-8000-000000000001");
    expect(matchRefreshSchema.parse({ updated: 0 }).updated).toBe(0);
    expect(okSchema.parse({ ok: true }).ok).toBe(true);
    expect(
      runIdSchema.parse({ runId: "00000000-0000-4000-8000-000000000002" }).runId,
    ).toBe("00000000-0000-4000-8000-000000000002");
  });
});
