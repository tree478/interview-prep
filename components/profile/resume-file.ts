// Checks a chosen résumé file before we upload it (AUTH-3).
// Pure function (no React, no browser APIs beyond reading name/type/size),
// so it's unit tested in resume-file.test.ts.

export const MAX_RESUME_MB = 5;
export const MAX_RESUME_BYTES = MAX_RESUME_MB * 1024 * 1024;

/** Returns an error message to show the student, or null if the file is fine. */
export function checkResumeFile(file: { name: string; type: string; size: number }): string | null {
  // Some browsers/OSes leave `type` empty, so also accept a .pdf extension.
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) return "That isn't a PDF. Export your résumé as a PDF and try again.";
  if (file.size === 0) return "That file is empty. Try exporting the PDF again.";
  if (file.size > MAX_RESUME_BYTES) return `That file is over ${MAX_RESUME_MB} MB. Try a smaller PDF.`;
  return null;
}
