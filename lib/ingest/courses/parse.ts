// SERVER-ONLY. Parses the CICS course descriptions page (GAP-2a).
import * as cheerio from 'cheerio';

export const PAGE_URL = 'https://content.cs.umass.edu/content/spring-2026-course-descriptions';
export const SEMESTER = 'Spring 2026';
export const USER_AGENT = 'UMass Career Coach (HackUMass student project)';

// TODO(types): ingest-only shape. The shared contract is UmassResource in lib/types.ts (B owns it).
export interface ParsedCourse {
  /** e.g. "COMPSCI 589" */
  code: string;
  title: string;
  url: string;
  instructors: string[];
  prereqs: string | null;
  description: string;
  /** 589 -> 500 */
  level: number;
  credits: number | null;
  anchor: string;
}

// The page also has honors colloquia (H230) and multi-letter codes (590AB), so allow both.
const HEADING = /^([A-Z][A-Z&-]*)\s+(H?\d{3}[A-Z0-9]*)\s*:\s*(.*)$/;
const PREREQ = /\b(?:Undergraduate |Graduate )?Prerequisites?:/;
const TRAILING_CREDITS = /(?<![\d-])(\d+)\s+credits?\.?\s*$/;

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

export function parseCoursePage(
  html: string,
  warn: (message: string) => void = (m) => console.warn(m),
): ParsedCourse[] {
  const $ = cheerio.load(html);
  const courses: ParsedCourse[] = [];
  const seen = new Set<string>();

  $('h2').each((_, el) => {
    const heading = $(el);
    const m = HEADING.exec(collapse(heading.text()));
    if (!m) return; // "Main Menu", "2026 Spring", footer, ...

    const code = `${m[1]} ${m[2]}`;
    const title = m[3].trim();
    if (!title) return;
    if (seen.has(code)) {
      warn(`Duplicate course code ${code} on the page; keeping the first`);
      return;
    }
    seen.add(code);

    const link = heading.find('a').first();
    const href = link.attr('href')?.trim() ?? '';
    const anchor = link.attr('name')?.trim() ?? '';
    const url = href || (anchor ? `${PAGE_URL}#${anchor}` : PAGE_URL);

    const body = heading.nextUntil('h2');
    const h3 = collapse(body.filter('h3').first().text());
    const instructors = /^Instructor\(s\):/i.test(h3)
      ? h3
          .replace(/^Instructor\(s\):\s*/i, '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const description = collapse(
      body
        .filter('p')
        .map((_, p) => $(p).text())
        .get()
        .join(' '),
    );
    const prereqAt = description.search(PREREQ);
    const prereqs =
      prereqAt >= 0
        ? description
            .slice(prereqAt)
            .replace(TRAILING_CREDITS, '')
            .trim() || null
        : null;
    const credits = TRAILING_CREDITS.exec(description);

    courses.push({
      code,
      title,
      url,
      instructors,
      prereqs,
      description,
      level: Math.floor(Number(/\d{3}/.exec(m[2])![0]) / 100) * 100,
      credits: credits ? Number(credits[1]) : null,
      anchor,
    });
  });

  return courses;
}
