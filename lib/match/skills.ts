import rawSkills from "../../data/skills.json";

type SkillEntry = {
  canonical_name: string;
  aliases: string[];
  category: string;
  whole_word_case_sensitive?: boolean;
};

const exactName = new Map<string, string>();
const foldedName = new Map<string, string>();

for (const skill of rawSkills as SkillEntry[]) {
  if (skill.whole_word_case_sensitive) {
    if (!exactName.has(skill.canonical_name)) {
      exactName.set(skill.canonical_name, skill.canonical_name);
    }
  } else {
    const key = skill.canonical_name.toLowerCase();
    if (!foldedName.has(key)) foldedName.set(key, skill.canonical_name);
  }

  for (const alias of skill.aliases) {
    const key = alias.toLowerCase();
    if (!foldedName.has(key)) foldedName.set(key, skill.canonical_name);
  }
}

export function canonicalize(raw: string[]): {
  canonical: string[];
  dropped: string[];
} {
  const canonical: string[] = [];
  const seen = new Set<string>();
  const dropped: string[] = [];

  for (const entry of raw) {
    const trimmed = entry.trim();
    if (!trimmed) {
      dropped.push(trimmed);
      continue;
    }

    const match = exactName.get(trimmed) ?? foldedName.get(trimmed.toLowerCase());
    if (!match) {
      dropped.push(trimmed);
      continue;
    }
    if (seen.has(match)) continue;
    seen.add(match);
    canonical.push(match);
  }

  return { canonical, dropped };
}
