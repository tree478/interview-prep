import { describe, expect, it } from "vitest";
import { AIError } from "./gemini";
import {
  applyDecisions,
  collectBullets,
  emphasisSkills,
  knownEmployers,
  settleRewrites,
  tailorBullets,
  type TailorBullet,
  type TailorCall,
  type TailorInput,
} from "./tailor";
import {
  tailorDecisionSchema,
  tailorPatchSchema,
  tailorRequestSchema,
} from "../types";

const JOB_ID = "11111111-1111-4111-8111-111111111111";

function bullet(
  partial: Partial<TailorBullet> & { id: string; before: string },
): TailorBullet {
  const [experienceIndex, bulletIndex] = partial.id.split(":").map(Number);
  return {
    experienceIndex: Number.isInteger(experienceIndex) ? experienceIndex : 0,
    bulletIndex: Number.isInteger(bulletIndex) ? bulletIndex : 0,
    company: "Campus Lab",
    position: "Research Assistant",
    ...partial,
  };
}

function tailorInput(
  bullets: TailorBullet[],
  extra: Partial<TailorInput> = {},
): TailorInput {
  return {
    jobTitle: "Software Engineer Intern",
    company: "Stripe",
    emphasis: ["Python"],
    interests: ["distributed systems"],
    knownEmployers: ["Campus Lab", "Stripe"],
    bullets,
    ...extra,
  };
}

function scripted(
  responses: ({ rewrites: { id: string; after: string }[] } | Error)[],
): { calls: { prompt: string; timeoutMs?: number }[]; call: TailorCall } {
  const calls: { prompt: string; timeoutMs?: number }[] = [];
  const call = (async (
    _schema: unknown,
    prompt: string,
    opts?: { timeoutMs?: number },
  ) => {
    calls.push({ prompt, timeoutMs: opts?.timeoutMs });
    const next = responses.shift();
    if (!next) throw new Error("unexpected Gemini call");
    if (next instanceof Error) throw next;
    return next;
  }) as TailorCall;
  return { calls, call };
}

describe("collectBullets", () => {
  it("skips blank bullets and keeps the original experience and bullet indexes", () => {
    expect(
      collectBullets([
        {
          company: "Campus Lab",
          position: "Assistant",
          bullets: ["  ", "Led the club"],
        },
        { company: "Skip Co", position: "Intern", bullets: ["", "   "] },
        {
          company: "Stripe",
          position: "Intern",
          bullets: ["Built a Python API", ""],
        },
      ]),
    ).toEqual([
      {
        id: "0:1",
        experienceIndex: 0,
        bulletIndex: 1,
        company: "Campus Lab",
        position: "Assistant",
        before: "Led the club",
      },
      {
        id: "2:0",
        experienceIndex: 2,
        bulletIndex: 0,
        company: "Stripe",
        position: "Intern",
        before: "Built a Python API",
      },
    ]);
  });
});

describe("emphasisSkills", () => {
  it("intersects student skills with required and preferred and drops skills the student lacks", () => {
    expect(
      emphasisSkills(["Docker", "Python", "JS", "Not A Real Skill"], {
        requiredSkills: ["Python", "Kubernetes", "JavaScript"],
        preferredSkills: ["Docker", "Go"],
      }),
    ).toEqual(["Python", "JavaScript", "Docker"]);
  });
});

describe("knownEmployers", () => {
  it("trims and dedupes company names case-insensitively", () => {
    expect(
      knownEmployers(["  Campus Lab ", "campus lab", "", "Stripe", " stripe "]),
    ).toEqual(["Campus Lab", "Stripe"]);
  });
});

describe("settleRewrites", () => {
  it("ignores unknown ids, omits missing and unchanged bullets, and keeps the last duplicate", () => {
    const result = settleRewrites(
      [
        bullet({ id: "0:0", before: "Built a Python API" }),
        bullet({ id: "0:1", before: "Led the club" }),
        bullet({
          id: "1:0",
          experienceIndex: 1,
          before: "Served 5k users",
        }),
      ],
      [
        { id: "nope", after: "Invented a Kubernetes platform and grew sales 40%" },
        { id: "0:0", after: "Built a Python API with Docker" },
        { id: "0:0", after: "Built a Python API for the portal" },
        { id: "1:0", after: "  Served 5k users  " },
      ],
      ["Stripe"],
    );

    expect(result.blocked).toEqual([]);
    expect(result.retry).toEqual([]);
    expect(result.diffs).toEqual([
      {
        id: "0:0",
        experienceIndex: 0,
        before: "Built a Python API",
        after: "Built a Python API for the portal",
        status: "proposed",
      },
    ]);
  });

  it("holds a fabricated number for retry instead of blocking it immediately", () => {
    const result = settleRewrites(
      [bullet({ id: "0:0", before: "Increased sales across the region" })],
      [
        {
          id: "0:0",
          after: "Increased sales by 40% across the region",
        },
      ],
      [],
    );

    expect(result.diffs).toEqual([]);
    expect(result.blocked).toEqual([]);
    expect(result.retry).toEqual([
      {
        id: "0:0",
        before: "Increased sales across the region",
        attempted: "Increased sales by 40% across the region",
        reason: "added number: 40%",
      },
    ]);
  });
});

describe("tailorBullets", () => {
  it("turns a wording-only rewrite into a proposed diff and keeps experienceIndex", async () => {
    const { calls, call } = scripted([
      {
        rewrites: [
          {
            id: "2:0",
            after: "Built a Python API that internal teams use",
          },
        ],
      },
    ]);

    const result = await tailorBullets(
      tailorInput([
        bullet({
          id: "2:0",
          experienceIndex: 2,
          before: "Built a Python API for internal tools",
        }),
      ]),
      call,
    );

    expect(result).toEqual({
      diffs: [
        {
          id: "2:0",
          experienceIndex: 2,
          before: "Built a Python API for internal tools",
          after: "Built a Python API that internal teams use",
          status: "proposed",
        },
      ],
      blocked: [],
      rejectedCount: 0,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.timeoutMs).toBe(8000);
    const prompt = calls[0]?.prompt ?? "";
    expect(prompt).toContain("Software Engineer Intern");
    expect(prompt).toContain("Stripe");
    expect(prompt).toContain("Python");
    expect(prompt).toContain("distributed systems");
    expect(prompt).toContain("2:0");
    expect(prompt).toContain("Campus Lab");
    expect(prompt).toContain("Research Assistant");
    expect(prompt).toContain("Built a Python API for internal tools");
    expect(prompt).toContain(
      "Do not add a skill, tool, employer, or number that is not already in that bullet.",
    );
  });

  it("blocks a 40% fabrication after the retry still adds 40%", async () => {
    const { calls, call } = scripted([
      {
        rewrites: [
          {
            id: "0:0",
            after: "Increased sales by 40% across the region",
          },
          {
            id: "3:1",
            after: "Built a Python API that internal teams use",
          },
        ],
      },
      {
        rewrites: [
          {
            id: "0:0",
            after: "Increased sales by 40% across the region",
          },
        ],
      },
    ]);

    const result = await tailorBullets(
      tailorInput([
        bullet({
          id: "0:0",
          before: "Increased sales across the region",
          company: "Campus Store",
          position: "Seller",
        }),
        bullet({
          id: "3:1",
          experienceIndex: 3,
          bulletIndex: 1,
          before: "Built a Python API for internal tools",
        }),
      ]),
      call,
    );

    expect(result.diffs).toEqual([
      {
        id: "3:1",
        experienceIndex: 3,
        before: "Built a Python API for internal tools",
        after: "Built a Python API that internal teams use",
        status: "proposed",
      },
    ]);
    expect(result.blocked).toEqual([
      {
        before: "Increased sales across the region",
        attempted: "Increased sales by 40% across the region",
        reason: "added number: 40%",
      },
    ]);
    expect(result.rejectedCount).toBe(1);
    expect(result.rejectedCount).toBe(result.blocked.length);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.timeoutMs).toBe(8000);
    expect(calls[1]?.timeoutMs).toBe(5000);
    const retryPrompt = calls[1]?.prompt ?? "";
    expect(retryPrompt).toContain("Increased sales across the region");
    expect(retryPrompt).toContain("Increased sales by 40% across the region");
    expect(retryPrompt).toContain("added number: 40%");
    expect(retryPrompt).toContain("0:0");
    expect(retryPrompt).not.toContain("Built a Python API for internal tools");
    expect(retryPrompt).not.toContain("3:1");
    expect(retryPrompt).toContain(
      "Do not invent metrics, percentages, or counts.",
    );
  });

  it("keeps a clean retry after the first attempt adds a skill", async () => {
    const { calls, call } = scripted([
      {
        rewrites: [
          { id: "0:0", after: "Built a Python API for the lab" },
        ],
      },
      {
        rewrites: [
          {
            id: "0:0",
            after: "Built an API for the lab that the research group uses",
          },
        ],
      },
    ]);

    const result = await tailorBullets(
      tailorInput([
        bullet({ id: "0:0", before: "Built an API for the lab" }),
      ]),
      call,
    );

    expect(calls).toHaveLength(2);
    expect(result.blocked).toEqual([]);
    expect(result.rejectedCount).toBe(0);
    expect(result.diffs).toEqual([
      {
        id: "0:0",
        experienceIndex: 0,
        before: "Built an API for the lab",
        after: "Built an API for the lab that the research group uses",
        status: "proposed",
      },
    ]);
    expect(calls[1]?.prompt).toContain("added skill: Python");
    expect(calls[1]?.prompt).toContain("Built a Python API for the lab");
  });

  it("blocks a skill that exists on another bullet but not this one", async () => {
    const { calls, call } = scripted([
      {
        rewrites: [
          { id: "0:0", after: "Built a Python API for the lab" },
        ],
      },
      {
        rewrites: [
          { id: "0:0", after: "Built a Python API for the lab" },
        ],
      },
    ]);

    const result = await tailorBullets(
      tailorInput([
        bullet({ id: "0:0", before: "Built an API for the lab" }),
        bullet({
          id: "1:0",
          experienceIndex: 1,
          before: "Used Python to parse logs",
          company: "Other Lab",
          position: "Intern",
        }),
      ]),
      call,
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]?.prompt).toContain("Used Python to parse logs");
    expect(calls[1]?.prompt).not.toContain("Used Python to parse logs");
    expect(result.diffs).toEqual([]);
    expect(result.blocked).toEqual([
      {
        before: "Built an API for the lab",
        attempted: "Built a Python API for the lab",
        reason: "added skill: Python",
      },
    ]);
    expect(result.rejectedCount).toBe(result.blocked.length);
  });

  it("accepts 5k rewritten as 5000", async () => {
    const { calls, call } = scripted([
      { rewrites: [{ id: "0:0", after: "Served 5000 users" }] },
    ]);

    const result = await tailorBullets(
      tailorInput([bullet({ id: "0:0", before: "Served 5k users" })]),
      call,
    );

    expect(calls).toHaveLength(1);
    expect(result.blocked).toEqual([]);
    expect(result.rejectedCount).toBe(0);
    expect(result.diffs).toEqual([
      {
        id: "0:0",
        experienceIndex: 0,
        before: "Served 5k users",
        after: "Served 5000 users",
        status: "proposed",
      },
    ]);
  });

  it("blocks an empty rewrite when the retry is also empty", async () => {
    const { calls, call } = scripted([
      { rewrites: [{ id: "0:0", after: "" }] },
      { rewrites: [{ id: "0:0", after: "   " }] },
    ]);

    const result = await tailorBullets(
      tailorInput([bullet({ id: "0:0", before: "Led the club" })]),
      call,
    );

    expect(calls).toHaveLength(2);
    expect(result.diffs).toEqual([]);
    expect(result.blocked).toEqual([
      {
        before: "Led the club",
        attempted: "   ",
        reason: "empty rewrite",
      },
    ]);
    expect(result.rejectedCount).toBe(1);
  });

  it("blocks the first attempt when the retry call throws and keeps diffs that already passed", async () => {
    const { calls, call } = scripted([
      {
        rewrites: [
          {
            id: "0:0",
            after: "Increased sales by 40% across the region",
          },
          {
            id: "1:0",
            after: "Built a Python API that internal teams use",
          },
        ],
      },
      new Error("gemini down"),
    ]);

    const result = await tailorBullets(
      tailorInput([
        bullet({ id: "0:0", before: "Increased sales across the region" }),
        bullet({
          id: "1:0",
          experienceIndex: 1,
          before: "Built a Python API for internal tools",
        }),
      ]),
      call,
    );

    expect(calls).toHaveLength(2);
    expect(result.diffs).toEqual([
      {
        id: "1:0",
        experienceIndex: 1,
        before: "Built a Python API for internal tools",
        after: "Built a Python API that internal teams use",
        status: "proposed",
      },
    ]);
    expect(result.blocked).toEqual([
      {
        before: "Increased sales across the region",
        attempted: "Increased sales by 40% across the region",
        reason: "added number: 40%",
      },
    ]);
    expect(result.rejectedCount).toBe(1);
  });

  it("rethrows a failure from the first Gemini call", async () => {
    const { calls, call } = scripted([new AIError("GEMINI_API_KEY is not set")]);

    await expect(
      tailorBullets(
        tailorInput([bullet({ id: "0:0", before: "Led the club" })]),
        call,
      ),
    ).rejects.toBeInstanceOf(AIError);
    expect(calls).toHaveLength(1);
  });
});

describe("applyDecisions", () => {
  const diffs = [
    {
      id: "0:0",
      experienceIndex: 0,
      before: "Led the club",
      after: "Led the student club",
      status: "proposed" as const,
    },
    {
      id: "1:0",
      experienceIndex: 1,
      before: "Served 5k users",
      after: "Served 5000 users",
      status: "proposed" as const,
    },
  ];

  it("sets status on the chosen bullets and leaves the rest", () => {
    expect(
      applyDecisions(diffs, [
        { id: "0:0", status: "accepted" },
        { id: "1:0", status: "rejected" },
      ]),
    ).toEqual({
      diffs: [
        { ...diffs[0], status: "accepted" },
        { ...diffs[1], status: "rejected" },
      ],
    });
    expect(diffs[0]?.status).toBe("proposed");
  });

  it("returns Unknown bullet when a decision id is missing and lets the last decision win", () => {
    expect(
      applyDecisions(diffs, [{ id: "missing", status: "accepted" }]),
    ).toEqual({ error: "Unknown bullet" });
    expect(
      applyDecisions(diffs, [
        { id: "0:0", status: "rejected" },
        { id: "0:0", status: "accepted" },
      ]),
    ).toEqual({
      diffs: [{ ...diffs[0], status: "accepted" }, diffs[1]],
    });
  });
});

describe("tailor request schemas", () => {
  it("accepts a job id and a patch with accepted or rejected decisions", () => {
    expect(tailorRequestSchema.safeParse({ jobId: JOB_ID }).success).toBe(true);
    expect(tailorRequestSchema.safeParse({ jobId: "job-1" }).success).toBe(false);
    expect(tailorDecisionSchema.safeParse({ id: "", status: "accepted" }).success).toBe(
      false,
    );
    expect(
      tailorDecisionSchema.safeParse({ id: "0:0", status: "proposed" }).success,
    ).toBe(false);
    expect(
      tailorDecisionSchema.safeParse({ id: "0:0", status: "accepted" }).success,
    ).toBe(true);
    expect(
      tailorPatchSchema.safeParse({
        tailoringId: JOB_ID,
        decisions: [],
      }).success,
    ).toBe(false);
    expect(
      tailorPatchSchema.safeParse({
        tailoringId: JOB_ID,
        decisions: [{ id: "0:0", status: "rejected" }],
      }).success,
    ).toBe(true);
  });
});
