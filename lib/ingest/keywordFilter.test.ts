import { describe, expect, it } from 'vitest';
import { classifyByKeyword, isEarlyCareer } from './keywordFilter';

describe('isEarlyCareer', () => {
  it.each([
    'Software Engineering Intern',
    'Summer 2027 Co-op',
    'New Grad Software Engineer',
    'Entry-Level Analyst',
    'University Graduate, Data',
  ])('accepts %s', (t) => expect(isEarlyCareer(t)).toBe(true));

  it.each(['Senior Software Engineer', 'Internal Tools Engineer', 'Staff Engineer, Infrastructure'])(
    'rejects %s',
    (t) => expect(isEarlyCareer(t)).toBe(false),
  );
});

describe('classifyByKeyword', () => {
  it.each([
    ['Software Engineering Intern', 'internship'],
    ['Summer 2027 Co-op', 'internship'],
    ['Software Engineer, New Grad', 'new_grad'],
    ['University Talent Acquisition Partner', 'other'],
    ['Internal Tools Engineer', 'other'],
    ['Senior Software Engineer', 'other'],
  ])('%s -> %s', (t, expected) => expect(classifyByKeyword(t)).toBe(expected));
});
