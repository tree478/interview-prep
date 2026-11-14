import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { callGrokJSON, GrokError } from './grok';

const schema = z.object({ n: z.number() });
const opts = { system: 's', user: 'u', name: 'test' };

function fakeClient(contents: string[]) {
  const create = vi.fn(async () => ({ choices: [{ message: { content: contents.shift() ?? '' } }] }));
  return { client: { chat: { completions: { create } } } as never, create };
}

afterEach(() => vi.unstubAllEnvs());

describe('callGrokJSON', () => {
  it('throws without calling the client when the key is missing', async () => {
    vi.stubEnv('XAI_API_KEY', '');
    const { create } = fakeClient([]);
    await expect(callGrokJSON(schema, opts)).rejects.toThrow('XAI_API_KEY not set');
    expect(create).not.toHaveBeenCalled();
  });
  it('retries once after invalid JSON', async () => {
    vi.stubEnv('XAI_API_KEY', 'k');
    const { client, create } = fakeClient(['not json', '{"n":1}']);
    await expect(callGrokJSON(schema, opts, { client })).resolves.toEqual({ n: 1 });
    expect(create).toHaveBeenCalledTimes(2);
  });
  it('throws GrokError after two invalid responses', async () => {
    vi.stubEnv('XAI_API_KEY', 'k');
    const { client, create } = fakeClient(['{"n":"x"}', '{}']);
    await expect(callGrokJSON(schema, opts, { client })).rejects.toBeInstanceOf(GrokError);
    expect(create).toHaveBeenCalledTimes(2);
  });
  it('wraps network errors without leaking the key', async () => {
    vi.stubEnv('XAI_API_KEY', 'secret-key');
    const create = vi.fn(async () => {
      throw new Error('boom secret-key');
    });
    const client = { chat: { completions: { create } } } as never;
    const err = await callGrokJSON(schema, opts, { client }).catch((e) => e);
    expect(err).toBeInstanceOf(GrokError);
    expect(err.message).not.toContain('secret-key');
    expect(create).toHaveBeenCalledTimes(1);
  });
});
