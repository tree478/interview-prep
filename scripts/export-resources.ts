// Exports the active synced CICS courses from umass_resources to data/umass_resources.json
// (the fallback seed C-7 loads). Labs already in the file are kept unchanged.
// Uses the service-role key from .env.local; never printed.
// Usage: npx tsx scripts/export-resources.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAdminClient } from '../lib/ingest/admin';

const FILE = join(process.cwd(), 'data/umass_resources.json');

interface SeedEntry {
  type: 'course' | 'lab';
  name: string;
  url: string;
  skills: string[];
  description: string | null;
  meta: Record<string, unknown>;
  source_url: string | null;
}

const code = (e: SeedEntry) => String(e.meta?.code ?? '');

async function main() {
  process.loadEnvFile('.env.local');
  const db = createAdminClient();
  const { data, error } = await db
    .from('umass_resources')
    .select('type,name,url,skills,description,meta,source_url')
    .eq('type', 'course')
    .eq('active', true);
  if (error) {
    console.error(`Could not read umass_resources: ${error.message}`);
    process.exit(1);
  }
  const courses: SeedEntry[] = (data ?? []).map((r) => ({
    type: 'course',
    name: r.name,
    url: r.url,
    skills: r.skills ?? [],
    description: r.description ?? null,
    meta: r.meta ?? {},
    source_url: r.source_url ?? null,
  }));
  courses.sort((a, b) => code(a).localeCompare(code(b), 'en', { numeric: true }) || a.name.localeCompare(b.name));

  let labs: SeedEntry[] = [];
  if (existsSync(FILE)) {
    const old = JSON.parse(readFileSync(FILE, 'utf8')) as SeedEntry[];
    labs = old.filter((e) => e.type === 'lab');
  }
  writeFileSync(FILE, JSON.stringify([...courses, ...labs], null, 2) + '\n');
  console.log(`wrote ${courses.length} courses, kept ${labs.length} labs -> data/umass_resources.json`);
}

main().catch((e) => {
  console.error('export-resources failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
