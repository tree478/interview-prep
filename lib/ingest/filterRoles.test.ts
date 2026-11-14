import { describe, expect, it } from 'vitest';
import { filterRoles } from './filterRoles';

const posts = [
  { title: 'Software Engineering Intern', location: null },
  { title: 'Software Engineer, New Grad', location: 'Boston' },
  { title: 'Senior Software Engineer', location: null },
];

describe('filterRoles', () => {
  it('uses the keyword classifier for an index Grok omits', async () => {
    const grok = async () =>
      ({ labels: [{ i: 0, role_type: 'other' }, { i: 2, role_type: 'other' }] }) as never;
    const r = await filterRoles(posts, { grok });
    expect(r.roleTypes).toEqual(['other', 'new_grad', 'other']);
    expect(r.usedFallback).toBe(false);
  });
  it('uses the keyword classifier for duplicated indexes', async () => {
    const grok = async () =>
      ({ labels: [{ i: 0, role_type: 'other' }, { i: 0, role_type: 'new_grad' }] }) as never;
    expect((await filterRoles([posts[0]], { grok })).roleTypes).toEqual(['internship']);
  });
  it('falls back to keywords for everything when Grok throws', async () => {
    const grok = async () => {
      throw new Error('down');
    };
    const r = await filterRoles(posts, { grok });
    expect(r.roleTypes).toEqual(['internship', 'new_grad', 'other']);
    expect(r.usedFallback).toBe(true);
    expect(r.errors).toEqual(['down']);
  });
});
