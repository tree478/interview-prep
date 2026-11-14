import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const generateContent = vi.hoisted(() => vi.fn());

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

import { AIError, callGeminiJSON } from "./gemini";

const schema = z.object({ ok: z.literal(true) });

function apiError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

afterEach(() => {
  generateContent.mockReset();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function ready(): void {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubEnv("GEMINI_MODEL", "test-model");
}

describe("callGeminiJSON", () => {
  it("retries a 503 once after a short backoff and keeps the same prompt", async () => {
    ready();
    vi.useFakeTimers();
    generateContent
      .mockRejectedValueOnce(apiError(503))
      .mockResolvedValueOnce({ text: '{"ok":true}' });

    const pending = callGeminiJSON(schema, "reply");
    await vi.advanceTimersByTimeAsync(499);
    expect(generateContent).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ ok: true });
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[0]?.[0].contents).toBe("reply");
    expect(generateContent.mock.calls[1]?.[0].contents).toBe("reply");
  });

  it("retries a 429 once and then throws", async () => {
    ready();
    vi.useFakeTimers();
    generateContent.mockRejectedValue(apiError(429));

    const pending = callGeminiJSON(schema, "reply");
    const failed = expect(pending).rejects.toBeInstanceOf(AIError);
    await vi.advanceTimersByTimeAsync(500);
    await failed;
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 500", async () => {
    ready();
    generateContent.mockRejectedValueOnce(apiError(500));

    await expect(callGeminiJSON(schema, "reply")).rejects.toBeInstanceOf(AIError);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("still retries invalid JSON once with a validation note", async () => {
    ready();
    generateContent
      .mockResolvedValueOnce({ text: "not json" })
      .mockResolvedValueOnce({ text: '{"ok":true}' });

    await expect(callGeminiJSON(schema, "reply")).resolves.toEqual({ ok: true });
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(String(generateContent.mock.calls[1]?.[0].contents)).toContain(
      "failed validation",
    );
  });
});
