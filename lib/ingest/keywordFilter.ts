import type { RoleType } from '../types';

// Keyword check for early-career roles (internships, co-ops, new grad).
// C-4 uses this as the fallback role filter when Grok fails or returns invalid JSON.
const EARLY_CAREER =
  /\b(intern|internship|co-?op|new grad|graduate|entry[- ]level|university|early career|junior)\b/i;

export function isEarlyCareer(title: string): boolean {
  return EARLY_CAREER.test(title);
}

const INTERN = /\b(intern|internship|co-?op)\b/i;
const NEW_GRAD = /\b(new grad|graduate|entry[- ]level|university|early career|junior)\b/i;
const RECRUITING = /\b(recruit(er|ing)?|talent acquisition|sourcer)\b/i;

export function classifyByKeyword(title: string): RoleType {
  if (RECRUITING.test(title)) return 'other';
  if (INTERN.test(title)) return 'internship';
  if (NEW_GRAD.test(title)) return 'new_grad';
  return 'other';
}
