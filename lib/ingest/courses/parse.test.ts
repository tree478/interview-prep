import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_URL, parseCoursePage } from './parse';

const html = readFileSync(join(__dirname, 'fixtures/courses.html'), 'utf8');
const quiet = () => {};

describe('parseCoursePage', () => {
  const courses = parseCoursePage(html, quiet);
  const byCode = (code: string) => courses.find((c) => c.code === code)!;

  it('parses every course and ignores non-course h2s', () => {
    expect(courses.map((c) => c.code)).toEqual([
      'COMPSCI 589',
      'COMPSCI 701',
      'CICS 110',
      'COMPSCI H230',
      'COMPSCI 590AB',
      'INFO 203',
    ]);
  });

  it('uses the course link when present', () => {
    const c = byCode('COMPSCI 589');
    expect(c.url).toBe('https://people.cs.umass.edu/~bsilva/courses/CMPSCI_589/Spring2026/');
    expect(c.title).toBe('Machine Learning');
    expect(c.anchor).toBe('589');
    expect(c.level).toBe(500);
  });

  it('falls back to the page anchor when the link is empty', () => {
    expect(byCode('CICS 110').url).toBe(`${PAGE_URL}#110`);
  });

  it('splits instructors, and returns [] when there is no h3', () => {
    expect(byCode('COMPSCI 589').instructors).toEqual(['Bruno Castro da Silva']);
    expect(byCode('COMPSCI 701').instructors).toEqual([]);
  });

  it('extracts prerequisites and credits', () => {
    const ml = byCode('COMPSCI 589');
    expect(ml.prereqs).toMatch(/^Undergraduate Prerequisite: MATH 545 and COMPSCI 240/);
    expect(ml.prereqs).not.toMatch(/credits/);
    expect(ml.credits).toBe(3);
    expect(ml.description).toMatch(/^This course will introduce core machine learning/);
    expect(byCode('INFO 203').prereqs).toBeNull();
  });

  it('collapses whitespace and decodes entities', () => {
    for (const c of courses) {
      expect(c.description).not.toMatch(/\s{2,}|\n/);
      expect(c.title).toBe(c.title.trim());
    }
    expect(courses.some((c) => c.description.includes('&amp;'))).toBe(false);
  });

  it('handles honors and multi-letter codes', () => {
    expect(byCode('COMPSCI H230').level).toBe(200);
    expect(byCode('COMPSCI 590AB').title).toBe('Quantum Cryptography');
  });

  it('keeps the first of duplicate codes and warns', () => {
    const dup = `<h2><a href="" name="1">CICS 110: First  </a></h2><p>One. 3 credits.</p>
      <h2><a href="" name="2">CICS 110: Second  </a></h2><p>Two. 3 credits.</p>`;
    const warnings: string[] = [];
    const out = parseCoursePage(dup, (m) => warnings.push(m));
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('First');
    expect(warnings).toHaveLength(1);
  });

  it('uses the trailing credit count only and ignores ranges', () => {
    const page = `<h2><a name="a">CICS 111: A</a></h2><p>Takes 1-3 credits.</p>
      <h2><a name="b">CICS 112: B</a></h2><p>The 3 credit option is X. Prerequisites: CICS 110. 4 credits.</p>`;
    const [a, b] = parseCoursePage(page, quiet);
    expect(a.credits).toBeNull();
    expect(b.credits).toBe(4);
    expect(b.prereqs).toBe('Prerequisites: CICS 110.');
  });

  it('returns [] for a page with no courses', () => {
    expect(parseCoursePage('<html><body><h2>Main Menu</h2></body></html>', quiet)).toEqual([]);
  });
});
