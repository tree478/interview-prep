import type { Gap, UmassResource } from "../types";

export type GapResourceRow = {
  id: string;
  type: "course" | "lab";
  name: string;
  url: string;
  description: string | null;
  skills: string[];
  meta: Record<string, unknown>;
  active: boolean;
};

const MAX_RESOURCES = 3;

const TYPE_ORDER: Record<GapResourceRow["type"], number> = {
  course: 0,
  lab: 1,
};

function orderedSkills(missingSkills: string[], preferredMissing: string[]): string[] {
  const seen = new Set<string>();
  const skills: string[] = [];
  for (const skill of [...missingSkills, ...preferredMissing]) {
    if (skill.trim() === "" || seen.has(skill)) continue;
    seen.add(skill);
    skills.push(skill);
  }
  return skills;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function readFaculty(
  value: unknown,
): { name: string; profile_url: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const faculty: { name: string; profile_url: string }[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== "string" || typeof record.profile_url !== "string") {
      continue;
    }
    faculty.push({ name: record.name, profile_url: record.profile_url });
  }
  return faculty.length > 0 ? faculty : undefined;
}

function toResource(row: GapResourceRow): UmassResource {
  const description = row.description ?? "";
  if (row.type === "course") {
    const code = row.meta.code;
    const instructors = row.meta.instructors;
    return {
      id: row.id,
      type: "course",
      name: row.name,
      url: row.url,
      description,
      ...(typeof code === "string" ? { code } : {}),
      ...(isStringArray(instructors) ? { instructors } : {}),
    };
  }
  const faculty = readFaculty(row.meta.faculty);
  return {
    id: row.id,
    type: "lab",
    name: row.name,
    url: row.url,
    description,
    ...(faculty ? { faculty } : {}),
  };
}

function compareResources(a: GapResourceRow, b: GapResourceRow): number {
  const byType = TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
  if (byType !== 0) return byType;
  return a.name.localeCompare(b.name);
}

function hasFaculty(row: GapResourceRow): boolean {
  return readFaculty(row.meta.faculty) !== undefined;
}

function pickResources(rows: GapResourceRow[]): GapResourceRow[] {
  const facultyLab = rows.find((row) => row.type === "lab" && hasFaculty(row));
  if (!facultyLab) return rows.slice(0, MAX_RESOURCES);
  const rest = rows.filter((row) => row !== facultyLab);
  return [...rest.slice(0, MAX_RESOURCES - 1), facultyLab].sort(compareResources);
}

export function selectGaps(input: {
  missingSkills: string[];
  preferredMissing: string[];
  resources: GapResourceRow[];
}): Gap[] {
  return orderedSkills(input.missingSkills, input.preferredMissing).map((skill) => ({
    skill,
    resources: pickResources(
      input.resources
        .filter((row) => row.active === true && row.skills.includes(skill))
        .sort(compareResources),
    ).map(toResource),
  }));
}
