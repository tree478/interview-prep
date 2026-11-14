// SERVER-ONLY: reads XAI_API_KEY. Never import this from a client component.
import OpenAI from 'openai';
import { z } from 'zod';

// Confirmed on docs.x.ai/docs/models: grok-4.7 lists structuredOutputs: true.
export const DEFAULT_XAI_MODEL = 'grok-4.7';

export class GrokError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GrokError';
  }
}

export interface GrokOpts {
  system: string;
  user: string;
  /** json_schema name: letters, digits, underscores. */
  name: string;
}

/**
 * Calls xAI with a strict JSON schema, parses and zod-validates the reply.
 * One retry on parse/validation failure; every failure surfaces as GrokError.
 * Note: strict json_schema needs an object at the root, so callers wrap arrays.
 */
export async function callGrokJSON<T>(
  schema: z.ZodType<T>,
  opts: GrokOpts,
  deps: { client?: OpenAI } = {},
): Promise<T> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey && !deps.client) throw new GrokError('XAI_API_KEY not set');
  const client =
    deps.client ?? new OpenAI({ apiKey, baseURL: 'https://api.x.ai/v1', timeout: 30000 });
  const model = process.env.XAI_MODEL ?? DEFAULT_XAI_MODEL;
  const { $schema: _omit, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
  void _omit;

  let lastProblem = 'unknown error';
  for (let attempt = 0; attempt < 2; attempt++) {
    let content: string | null | undefined;
    try {
      const res = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: opts.name, strict: true, schema: jsonSchema },
        },
      });
      content = res.choices[0]?.message?.content;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new GrokError(`xAI request failed: ${msg.replaceAll(apiKey ?? '\0', '[redacted]')}`);
    }
    try {
      const parsed = schema.safeParse(JSON.parse(content ?? ''));
      if (parsed.success) return parsed.data;
      lastProblem = `schema validation failed: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')}`;
    } catch {
      lastProblem = 'response was not valid JSON';
    }
  }
  throw new GrokError(`Grok response invalid after retry: ${lastProblem}`);
}
