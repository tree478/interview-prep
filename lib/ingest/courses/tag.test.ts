import { describe, expect, it, vi } from 'vitest';
import type { callGeminiJSON } from '../../ai/gemini';
import type { ParsedCourse } from './parse';
import { BATCH_GAP_MS, RATE_LIMIT_WAIT_MS, tagCourses, type TagReport } from './tag';

function course(n: number): ParsedCourse {
  return {
    code: `COMPSCI ${100 + n}`,
    title: `Course ${n}`,
    url: 'https://example.edu',
    instructors: [],
    prereqs: null,
    description: `Description ${n}`,
    level: 100,
    credits: 3,
    anchor: String(n),
  };
}

type Reply = { courses: { code: string; skills: string[] }[] };
type Handler = (prompt: string, call: number) => Reply | Error;

function fake(handler: Handler) {
  let call = 0;
  const fn = vi.fn(async (_schema: unknown, prompt: string) => {
    const out = handler(prompt, call++);
    if (out instanceof Error) throw out;
    return out;
  });
  return { gemini: fn as unknown as typeof callGeminiJSON, fn };
}

const codesIn = (prompt: string) => [...prompt.matchAll(/^\[([^\]]+)\] /gm)].map((m) => m[1]);
const freshReport = (): TagReport => ({ errors: [], skillless: [], geminiCalls: 0 });

describe('tagCourses', () => {
  it('canonicalizes tags, drops off-list ones and ignores unknown codes', async () => {
    const { gemini } = fake((p) => ({
      courses: [
        ...codesIn(p).map((code) => ({ code, skills: ['python', 'Machine Learning', 'Quantum Basket Weaving'] })),
        { code: 'COMPSCI 999', skills: ['Python'] },
      ],
    }));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const map = await tagCourses([course(1), course(2)], { gemini, sleep });
    expect([...map.keys()].sort()).toEqual(['COMPSCI 101', 'COMPSCI 102']);
    for (const skills of map.values()) {
      expect(skills).toContain('Python');
      expect(skills).not.toContain('Quantum Basket Weaving');
    }
  });

  it('sends batches of 20, paced 4 s apart', async () => {
    const { gemini, fn } = fake((p) => ({ courses: codesIn(p).map((code) => ({ code, skills: ['Python'] })) }));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const courses = Array.from({ length: 45 }, (_, i) => course(i));
    const map = await tagCourses(courses, { gemini, sleep });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(codesIn(fn.mock.calls[0][1] as string)).toHaveLength(20);
    expect(codesIn(fn.mock.calls[2][1] as string)).toHaveLength(5);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([BATCH_GAP_MS, BATCH_GAP_MS]);
    expect(map.size).toBe(45);
  });

  it('puts only canonical skill names in the prompt', async () => {
    const { gemini, fn } = fake((p) => ({ courses: codesIn(p).map((code) => ({ code, skills: ['Python'] })) }));
    await tagCourses([course(1)], { gemini, sleep: async () => {} });
    const prompt = fn.mock.calls[0][1] as string;
    expect(prompt).toContain('- Machine learning');
    expect(prompt).toContain("Never add skills that aren't listed");
    expect(prompt).toContain('[COMPSCI 101] Course 1');
  });

  it('retries a course with 0 skills on its own, then reports it as skill-less', async () => {
    const { gemini, fn } = fake((p) => ({
      courses: codesIn(p).map((code) => ({ code, skills: code === 'COMPSCI 102' ? [] : ['Python'] })),
    }));
    const report = freshReport();
    const map = await tagCourses([course(1), course(2)], { gemini, sleep: async () => {}, report });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(codesIn(fn.mock.calls[1][1] as string)).toEqual(['COMPSCI 102']);
    expect(map.get('COMPSCI 102')).toEqual([]);
    expect(report.skillless).toEqual(['COMPSCI 102']);
    expect(report.geminiCalls).toBe(2);
  });

  it('keeps tags when the solo retry finds some, and treats a skipped course as 0 skills', async () => {
    const { gemini } = fake((p, call) => ({
      courses: call === 0 ? [{ code: 'COMPSCI 101', skills: ['Python'] }] : codesIn(p).map((code) => ({ code, skills: ['Java'] })),
    }));
    const report = freshReport();
    const map = await tagCourses([course(1), course(2)], { gemini, sleep: async () => {}, report });
    expect(map.get('COMPSCI 102')).toEqual(['Java']);
    expect(report.skillless).toEqual([]);
  });

  it('retries a throwing batch once, then leaves its courses out and reports an error', async () => {
    const { gemini, fn } = fake(() => new Error('boom'));
    const report = freshReport();
    const map = await tagCourses([course(1), course(2)], { gemini, sleep: async () => {}, report });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(map.size).toBe(0);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain('boom');
  });

  it('succeeds when the retry works', async () => {
    const { gemini } = fake((p, call) =>
      call === 0 ? new Error('flaky') : { courses: codesIn(p).map((code) => ({ code, skills: ['Python'] })) },
    );
    const report = freshReport();
    const map = await tagCourses([course(1)], { gemini, sleep: async () => {}, report });
    expect(map.get('COMPSCI 101')).toEqual(['Python']);
    expect(report.errors).toEqual([]);
  });

  it('waits 30 s before retrying a rate-limit error', async () => {
    const { gemini } = fake((p, call) =>
      call === 0 ? new Error('429 RESOURCE_EXHAUSTED') : { courses: codesIn(p).map((code) => ({ code, skills: ['Python'] })) },
    );
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    await tagCourses([course(1)], { gemini, sleep });
    expect(sleep.mock.calls.map((c) => c[0])).toContain(RATE_LIMIT_WAIT_MS);
  });

  it('redacts API keys from reported errors', async () => {
    const { gemini } = fake(() => new Error('fetch failed https://x.test/v1?key=SECRET123&alt=json'));
    const report = freshReport();
    await tagCourses([course(1)], { gemini, sleep: async () => {}, report });
    expect(report.errors.join(' ')).not.toContain('SECRET123');
  });

  it('stops starting new calls near the deadline and reports it', async () => {
    const { gemini, fn } = fake((p) => ({ courses: codesIn(p).map((code) => ({ code, skills: ['Python'] })) }));
    const report = freshReport();
    const map = await tagCourses([course(1)], { gemini, sleep: async () => {}, report, deadline: Date.now() + 1_000 });
    expect(fn).not.toHaveBeenCalled();
    expect(map.size).toBe(0);
    expect(report.errors[0]).toMatch(/Ran out of time/);
  });
});
