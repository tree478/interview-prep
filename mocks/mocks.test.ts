// Every mock must match the shared schema in lib/types.ts, the same check
// lib/api.ts runs on it at runtime. When Miranda tightens a schema (e.g. ids
// must be UUIDs), this test fails here instead of the page failing in the browser.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  applicationSchema,
  atsReportSchema,
  botRunSchema,
  feedItemSchema,
  gapsResponseSchema,
  interviewQuestionSchema,
  parsedResumeSchema,
  resumeUploadSchema,
  starFeedbackSchema,
  tailorResultSchema,
} from "../lib/types"; // relative: vitest doesn't know the @/ alias

import applications from "./applications.json";
import ats from "./ats.json";
import botRuns from "./bot-runs.json";
import feed from "./feed.json";
import gaps from "./gaps.json";
import interview from "./interview.json";
import resume from "./resume.json";
import tailor from "./tailor.json";

const cases: [string, z.ZodType, unknown][] = [
  ["applications.json", z.array(applicationSchema), applications],
  ["ats.json", atsReportSchema, ats],
  ["bot-runs.json", z.array(botRunSchema), botRuns],
  ["feed.json", z.array(feedItemSchema), feed],
  ["gaps.json", gapsResponseSchema, gaps],
  ["interview.json questions", z.array(interviewQuestionSchema), interview.questions],
  ["interview.json feedback", starFeedbackSchema, interview.feedback],
  ["resume.json", resumeUploadSchema, resume],
  ["resume.json parsed", parsedResumeSchema, resume.parsed],
  ["tailor.json", tailorResultSchema, tailor],
];

describe("mocks match lib/types.ts", () => {
  it.each(cases)("%s", (_name, schema, data) => {
    const result = schema.safeParse(data);
    // Show which fields are wrong if it fails.
    expect(result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)).toEqual([]);
  });
});
