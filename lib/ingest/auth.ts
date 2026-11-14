// SERVER-ONLY. Request auth for /api/ingest/run.
import { timingSafeEqual } from 'node:crypto';

export function safeEqual(a: string | undefined, b: string | null): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** 'cron' when a valid CRON_SECRET bearer or INGEST_KEY header is present, otherwise null. */
export function secretAuth(
  headers: Headers,
  env: { CRON_SECRET?: string; INGEST_KEY?: string } = process.env,
): 'cron' | null {
  const bearer = headers.get('authorization')?.replace(/^Bearer /, '') ?? null;
  if (safeEqual(env.CRON_SECRET, bearer)) return 'cron';
  if (safeEqual(env.INGEST_KEY, headers.get('x-ingest-key'))) return 'cron';
  return null;
}
