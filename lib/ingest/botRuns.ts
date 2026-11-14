import { botRunRowSchema, type BotRun } from '../types';

/** Maps a bot_runs row (snake_case) to the BotRun contract (camelCase). Throws if the row is malformed. */
export function toBotRun(row: unknown): BotRun {
  const r = botRunRowSchema.parse(row);
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    trigger: r.trigger,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    companiesSelected: r.companies_selected,
    jobsAdded: r.jobs_added,
    jobsExtracted: r.jobs_extracted,
    ...(r.course_stats ? { courseStats: r.course_stats } : {}),
    errors: r.errors,
  };
}
