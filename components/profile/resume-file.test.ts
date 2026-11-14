import { describe, expect, it } from "vitest";
import { MAX_RESUME_BYTES, MAX_RESUME_MB, checkResumeFile } from "./resume-file";

const pdf = (overrides: Partial<{ name: string; type: string; size: number }> = {}) => ({
  name: "resume.pdf",
  type: "application/pdf",
  size: 200_000,
  ...overrides,
});

describe("checkResumeFile", () => {
  it("accepts a normal PDF", () => {
    expect(checkResumeFile(pdf())).toBeNull();
  });

  it("accepts a .pdf with an empty MIME type", () => {
    expect(checkResumeFile(pdf({ type: "", name: "Resume.PDF" }))).toBeNull();
  });

  it("rejects non-PDFs", () => {
    expect(checkResumeFile(pdf({ name: "resume.docx", type: "application/msword" }))).toMatch(/isn't a PDF/);
    expect(checkResumeFile(pdf({ name: "photo.png", type: "image/png" }))).toMatch(/isn't a PDF/);
  });

  it("rejects empty files", () => {
    expect(checkResumeFile(pdf({ size: 0 }))).toMatch(/empty/);
  });

  it("allows exactly the limit and rejects anything bigger", () => {
    expect(checkResumeFile(pdf({ size: MAX_RESUME_BYTES }))).toBeNull();
    expect(checkResumeFile(pdf({ size: MAX_RESUME_BYTES + 1 }))).toMatch(`over ${MAX_RESUME_MB} MB`);
  });
});
