import { describe, expect, it } from "vitest";
import { z } from "zod";
import { callGeminiJSON } from "./gemini";

const live =
  process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL ? describe : describe.skip;

live("callGeminiJSON", () => {
  it("returns { ok: true }", async () => {
    const result = await callGeminiJSON(
      z.object({ ok: z.literal(true) }),
      'reply with {"ok": true}.',
    );
    expect(result).toEqual({ ok: true });
  }, 45_000);
});
