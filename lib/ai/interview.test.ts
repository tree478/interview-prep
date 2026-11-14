import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { AIError } from "./gemini";
import {
  generateQuestions,
  gradeAnswer,
  interviewRequestSchema,
  type GeminiJSON,
  type InterviewExperience,
} from "./interview";
import { starFeedbackSchema } from "../types";

/** Fake callGeminiJSON: validates a canned response with the schema it is given, like the real one. */
function fakeGemini(output: unknown, calls: string[] = []): GeminiJSON {
  return (async (schema, prompt) => {
    calls.push(prompt);
    return schema.parse(output);
  }) as GeminiJSON;
}

const job = {
  title: "Software Engineering Intern",
  company: "Acme",
  location: "Boston, MA",
  description: "Build internal tools in TypeScript and PostgreSQL.",
  extracted: null,
};

const experiences: InterviewExperience[] = [
  { company: "Campus IT", position: "Help Desk Assistant", bullets: ["Resolved 40 tickets a week"], skills: [] },
  { company: "Robotics Club", position: "Software Lead", bullets: ["Wrote the ROS navigation stack"], skills: ["Python"] },
];

const threeBehavioral = ["Q1?", "Q2?", "Q3?"];

const part = (rating: number) => ({ rating, comment: "Clear." });
const feedback = {
  situation: part(4),
  task: part(3),
  action: part(5),
  result: part(1),
  improvement: "Add the measurable result, if you have one.",
};
const gradeInput = { question: "Tell me about a time...", answer: "I did a thing.", job };

describe("generateQuestions", () => {
  it("returns 3 behavioral and 2 resume questions with server ids", async () => {
    const gemini = fakeGemini({
      behavioral: threeBehavioral,
      resume: [
        { experienceIndex: 0, text: "At Campus IT..." },
        { experienceIndex: 1, text: "As Software Lead..." },
      ],
    });
    const qs = await generateQuestions({ job, experiences }, { gemini });
    expect(qs.map((q) => q.id)).toEqual(["b1", "b2", "b3", "r1", "r2"]);
    expect(qs.map((q) => q.type)).toEqual(["behavioral", "behavioral", "behavioral", "resume", "resume"]);
    expect(qs[3].text).toBe("At Campus IT...");
  });

  it("asks for 5 behavioral questions and no resume questions when there are no experiences", async () => {
    const calls: string[] = [];
    const gemini = fakeGemini({ behavioral: ["A?", "B?", "C?", "D?", "E?"] }, calls);
    const qs = await generateQuestions({ job, experiences: [] }, { gemini });
    expect(qs.map((q) => q.id)).toEqual(["b1", "b2", "b3", "b4", "b5"]);
    expect(qs.every((q) => q.type === "behavioral")).toBe(true);
    expect(calls[0]).toContain("exactly 5 behavioral");
    expect(calls[0]).not.toContain("resume questions");
  });

  it("drops resume questions whose experienceIndex is out of range", async () => {
    const gemini = fakeGemini({
      behavioral: threeBehavioral,
      resume: [
        { experienceIndex: 5, text: "Invented?" },
        { experienceIndex: 1, text: "As Software Lead..." },
      ],
    });
    const qs = await generateQuestions({ job, experiences }, { gemini });
    expect(qs.filter((q) => q.type === "resume")).toEqual([
      { id: "r1", type: "resume", text: "As Software Lead..." },
    ]);
  });

  it("surfaces invalid model output as an error", async () => {
    const gemini = fakeGemini({ behavioral: ["Only one?"], resume: [] });
    await expect(generateQuestions({ job, experiences }, { gemini })).rejects.toBeInstanceOf(ZodError);
  });

  it("surfaces an AIError from the Gemini helper", async () => {
    const gemini = (async () => {
      throw new AIError("timeout");
    }) as GeminiJSON;
    await expect(generateQuestions({ job, experiences }, { gemini })).rejects.toBeInstanceOf(AIError);
  });

  it("caps the description at 8,000 characters", async () => {
    const calls: string[] = [];
    const gemini = fakeGemini({ behavioral: threeBehavioral, resume: [{ experienceIndex: 0, text: "a" }, { experienceIndex: 0, text: "b" }] }, calls);
    await generateQuestions({ job: { ...job, description: "x".repeat(9_000) + "TAIL" }, experiences }, { gemini });
    expect(calls[0]).toContain("x".repeat(8_000));
    expect(calls[0]).not.toContain("x".repeat(8_001));
    expect(calls[0]).not.toContain("TAIL");
  });
});

describe("gradeAnswer", () => {
  it("returns feedback that passes starFeedbackSchema", async () => {
    const result = await gradeAnswer(gradeInput, { gemini: fakeGemini(feedback) });
    expect(starFeedbackSchema.parse(result)).toEqual(feedback);
  });

  it.each([0, 6])("rejects a rating of %i", async (rating) => {
    const gemini = fakeGemini({ ...feedback, task: part(rating) });
    await expect(gradeAnswer(gradeInput, { gemini })).rejects.toBeInstanceOf(ZodError);
  });

  it("enforces the shared schema even if the helper returns unvalidated output", async () => {
    const gemini = (async () => ({ ...feedback, result: part(6) })) as unknown as GeminiJSON;
    await expect(gradeAnswer(gradeInput, { gemini })).rejects.toBeInstanceOf(ZodError);
  });

  it("rejects output with a missing STAR part", async () => {
    const { result: _omit, ...missing } = feedback;
    void _omit;
    await expect(gradeAnswer(gradeInput, { gemini: fakeGemini(missing) })).rejects.toBeInstanceOf(ZodError);
  });
});

describe("interviewRequestSchema", () => {
  const jobId = "6f1c0b9e-2c1a-4d3e-9f4a-1b2c3d4e5f60";
  const grade = { jobId, action: "grade", questionId: "b1", question: "Tell me about a time...", answer: "I did X." };

  it("accepts valid questions and grade bodies", () => {
    expect(interviewRequestSchema.safeParse({ jobId, action: "questions" }).success).toBe(true);
    expect(interviewRequestSchema.safeParse(grade).success).toBe(true);
  });

  it("rejects a missing jobId", () => {
    expect(interviewRequestSchema.safeParse({ action: "questions" }).success).toBe(false);
  });

  it("rejects a bad action", () => {
    expect(interviewRequestSchema.safeParse({ jobId, action: "delete" }).success).toBe(false);
  });

  it("rejects an empty answer", () => {
    expect(interviewRequestSchema.safeParse({ ...grade, answer: "" }).success).toBe(false);
    expect(interviewRequestSchema.safeParse({ ...grade, answer: "   " }).success).toBe(false);
  });

  it("rejects a 5,000-character answer", () => {
    expect(interviewRequestSchema.safeParse({ ...grade, answer: "a".repeat(5_000) }).success).toBe(false);
  });
});
