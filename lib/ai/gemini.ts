import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

export class AIError extends Error {}

const TRANSIENT_BACKOFF_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function transientStatus(err: unknown): 429 | 503 | null {
  let current: unknown = err;
  for (let depth = 0; current != null && depth < 4; depth += 1) {
    if (typeof current === "object") {
      const record = current as { status?: unknown; code?: unknown };
      if (record.status === 429 || record.status === 503) return record.status;
      if (record.code === 429 || record.code === 503) return record.code;
    }
    const message =
      current instanceof Error
        ? current.message
        : typeof current === "string"
          ? current
          : "";
    if (/\b503\b/.test(message)) return 503;
    if (/\b429\b/.test(message)) return 429;
    current = current instanceof Error ? current.cause : undefined;
  }
  return null;
}

function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Gemini request failed";
}

export async function callGeminiJSON<T>(
  schema: z.ZodType<T>,
  prompt: string,
  opts?: { timeoutMs?: number },
): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GEMINI_MODEL?.trim();
  if (!apiKey || !model) {
    const missing = [
      !apiKey ? "GEMINI_API_KEY" : null,
      !model ? "GEMINI_MODEL" : null,
    ].filter((name): name is string => name !== null);
    throw new AIError(
      missing.length === 1
        ? `${missing[0]} is not set`
        : `${missing.join(" and ")} are not set`,
    );
  }

  const ai = new GoogleGenAI({ apiKey });
  const jsonSchema = z.toJSONSchema(schema);
  const timeoutMs = opts?.timeoutMs ?? 20_000;

  const request = (contents: string) =>
    ai.models.generateContent({
      model,
      contents,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: jsonSchema,
        abortSignal: AbortSignal.timeout(timeoutMs),
      },
    });

  const run = async (contents: string): Promise<T> => {
    let text: string | undefined;
    try {
      let response;
      try {
        response = await request(contents);
      } catch (err) {
        if (transientStatus(err) == null) throw err;
        await delay(TRANSIENT_BACKOFF_MS);
        response = await request(contents);
      }
      text = response.text;
    } catch (err) {
      throw err instanceof AIError ? err : new AIError(errorText(err), { cause: err });
    }

    if (typeof text !== "string") {
      throw new Error("Gemini returned no text");
    }
    return schema.parse(JSON.parse(text));
  };

  try {
    return await run(prompt);
  } catch (err) {
    if (err instanceof AIError) throw err;
    const reason = errorText(err);
    try {
      return await run(
        `${prompt}\n\nThe previous response failed validation: ${reason}\nReturn only JSON matching the schema.`,
      );
    } catch (retryErr) {
      if (retryErr instanceof AIError) throw retryErr;
      throw new AIError(
        `Gemini response failed validation: ${errorText(retryErr)}`,
        { cause: retryErr },
      );
    }
  }
}
