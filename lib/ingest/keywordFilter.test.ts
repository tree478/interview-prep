import { describe, expect, it } from 'vitest';
import { isEarlyCareer } from './keywordFilter';

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
