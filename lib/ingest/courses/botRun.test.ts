import { describe, expect, it } from 'vitest';
import { toBotRun } from '../botRuns';
import { botRunSchema } from '../../types';

describe('courses bot_runs row -> BotRun', () => {
  it('maps course_stats to courseStats', () => {
    const run = toBotRun({
      id: '5a1f6a52-6d3b-4d7e-9a53-2f2d1f0e8c11',
      started_at: '2026-11-14T12:00:00Z',
      finished_at: '2026-11-14T12:00:09Z',
      trigger: 'cron',
      kind: 'courses',
      status: 'done',
      companies_selected: [],
      companies_checked: 0,
      jobs_added: 0,
      jobs_extracted: 0,
      briefs_written: 0,
      course_stats: { found: 105, added: 0, changed: 0, removed: 0, unchanged: true },
      errors: [],
    });
    expect(botRunSchema.parse(run).courseStats).toEqual({
      found: 105,
      added: 0,
      changed: 0,
      removed: 0,
      unchanged: true,
    });
    expect(run.kind).toBe('courses');
  });
});
