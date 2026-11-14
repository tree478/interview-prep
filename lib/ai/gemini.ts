import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

export class AIError extends Error {}

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

  const run = async (contents: string): Promise<T> => {
    let text: string | undefined;
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: jsonSchema,
          abortSignal: AbortSignal.timeout(timeoutMs),
        },
      });
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
