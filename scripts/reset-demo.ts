// Deletes the demo user so sign-up and résumé autofill happen live (PRD §11).
// Reads DEMO_EMAIL from .env.local only. Never accepts an email on the command line.
// Dry run unless --yes. Service-role key is never printed.
// Usage: npx tsx scripts/reset-demo.ts [--yes]
import { createAdminClient } from '../lib/ingest/admin';
import type { SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'resumes';
const USER_TABLES = [
  'profiles',
  'experiences',
  'resumes',
  'matches',
  'applications',
  'tailorings',
  'interview_sessions',
] as const;

type UserTable = (typeof USER_TABLES)[number];
type Counts = Record<UserTable, number> & { storageFiles: number };

function safe(text: string): string {
  let out = text.replace(/([?&]key=)[^&\s"']+/gi, '$1[redacted]');
  for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY', 'INGEST_KEY', 'CRON_SECRET']) {
    const secret = process.env[name]?.trim();
    if (secret) out = out.split(secret).join('[redacted]');
  }
  return out.replace(/\s+/g, ' ').slice(0, 300);
}

function assertArgs(): boolean {
  let yes = false;
  for (const arg of process.argv.slice(2)) {
    if (arg === '--yes') {
      yes = true;
      continue;
    }
    if (arg.startsWith('-')) {
      console.error(`Unknown argument ${arg}.`);
    } else {
      console.error('Do not pass an email on the command line.');
    }
    console.error('Usage: npx tsx scripts/reset-demo.ts [--yes]');
    console.error('The demo email comes only from DEMO_EMAIL in .env.local.');
    process.exit(1);
  }
  return yes;
}

function demoEmail(): string {
  const email = process.env.DEMO_EMAIL?.trim() ?? '';
  if (!email) {
    console.error('Refusing to run: DEMO_EMAIL is not set in .env.local');
    process.exit(1);
  }
  if (!/^[^@\s]+@umass\.edu$/i.test(email)) {
    console.error('Refusing to run: DEMO_EMAIL must be one address ending in @umass.edu');
    process.exit(1);
  }
  return email;
}

async function findDemoUser(db: SupabaseClient, email: string) {
  const want = email.toLowerCase();
  const perPage = 200;
  const found: { id: string; email: string }[] = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`list users: ${safe(error.message)}`);
    for (const user of data.users) {
      const got = user.email?.trim().toLowerCase();
      if (got === want && user.email) found.push({ id: user.id, email: user.email });
    }
    if (data.users.length < perPage) break;
  }
  return found;
}

async function countRows(db: SupabaseClient, table: UserTable, userId: string): Promise<number> {
  const { count, error } = await db
    .from(table)
    .select('user_id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) throw new Error(`count ${table}: ${safe(error.message)}`);
  return count ?? 0;
}

async function listStoragePaths(db: SupabaseClient, userId: string): Promise<string[]> {
  const paths: string[] = [];
  const limit = 100;

  async function walk(prefix: string): Promise<void> {
    let offset = 0;
    for (;;) {
      const { data, error } = await db.storage.from(BUCKET).list(prefix, {
        limit,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw new Error(`list storage: ${safe(error.message)}`);
      const batch = data ?? [];
      for (const item of batch) {
        const path = `${prefix}/${item.name}`;
        if (item.id == null) await walk(path);
        else paths.push(path);
      }
      if (batch.length < limit) break;
      offset += batch.length;
    }
  }

  await walk(userId);
  return paths;
}

async function countsFor(db: SupabaseClient, userId: string): Promise<Counts> {
  const counts = {} as Counts;
  for (const table of USER_TABLES) {
    counts[table] = await countRows(db, table, userId);
  }
  counts.storageFiles = (await listStoragePaths(db, userId)).length;
  return counts;
}

function printCounts(counts: Counts): void {
  for (const table of USER_TABLES) {
    console.log(`  ${table}: ${counts[table]}`);
  }
  console.log(`  storage files: ${counts.storageFiles}`);
}

async function removeStorage(db: SupabaseClient, userId: string): Promise<void> {
  const paths = await listStoragePaths(db, userId);
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const { error } = await db.storage.from(BUCKET).remove(batch);
    if (error) throw new Error(`remove storage: ${safe(error.message)}`);
  }
}

async function main(): Promise<void> {
  const yes = assertArgs();
  process.loadEnvFile('.env.local');
  const email = demoEmail();
  const db = createAdminClient();

  const matches = await findDemoUser(db, email);
  if (matches.length === 0) {
    console.log('demo user not found, nothing to delete');
    return;
  }
  if (matches.length > 1) {
    console.error(`Refusing to run: ${matches.length} auth users match DEMO_EMAIL`);
    process.exit(1);
  }

  const user = matches[0]!;
  if (user.email.trim().toLowerCase() !== email.toLowerCase()) {
    console.error('Refusing to run: found user email does not match DEMO_EMAIL');
    process.exit(1);
  }

  const before = await countsFor(db, user.id);
  console.log('Demo user that would be deleted');
  console.log(`  id: ${user.id}`);
  console.log(`  email: ${user.email}`);
  printCounts(before);
  console.log('Untouched: jobs, companies, umass_resources, bot_runs');

  if (!yes) {
    console.log('Dry run. Re-run with --yes to delete this user.');
    return;
  }

  await removeStorage(db, user.id);
  const { error } = await db.auth.admin.deleteUser(user.id);
  if (error) throw new Error(`delete user: ${safe(error.message)}`);

  const after = await countsFor(db, user.id);
  console.log('Deleted. Counts after delete:');
  printCounts(after);
  const leftover = USER_TABLES.some((table) => after[table] !== 0) || after.storageFiles !== 0;
  if (leftover) {
    console.error('Delete finished but some demo-user rows or files remain');
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : 'reset-demo failed';
  console.error(safe(message));
  process.exit(1);
});
