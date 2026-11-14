// Keyword check for early-career roles (internships, co-ops, new grad).
// C-4 uses this as the fallback role filter when Grok fails or returns invalid JSON.
const EARLY_CAREER =
  /\b(intern|internship|co-?op|new grad|graduate|entry[- ]level|university|early career|junior)\b/i;

export function isEarlyCareer(title: string): boolean {
  return EARLY_CAREER.test(title);
}
