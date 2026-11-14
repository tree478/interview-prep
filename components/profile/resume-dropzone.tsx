"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { FileUploadIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { MAX_RESUME_MB, checkResumeFile } from "./resume-file";

// Drag a PDF here or click to choose one (AUTH-3).
// It's a real <input type="file"> inside a <label>, so it also works by
// keyboard (Tab to it, press Enter/Space) and with screen readers.
export function ResumeDropzone({ onFile, disabled }: { onFile: (file: File) => void; disabled?: boolean }) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function accept(file: File | undefined) {
    if (!file) return;
    const problem = checkResumeFile(file);
    setError(problem);
    if (problem) return;
    onFile(file);
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor="resume-file"
        onDragOver={(e) => {
          e.preventDefault(); // required, or the browser won't allow a drop here
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault(); // stop the browser from opening the PDF itself
          setDragging(false);
          if (!disabled) accept(e.dataTransfer.files[0]);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors",
          "has-[:focus-visible]:border-ring has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/30",
          dragging ? "border-primary bg-muted" : "border-border hover:bg-muted/50",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <HugeiconsIcon icon={FileUploadIcon} size={32} aria-hidden="true" className="text-muted-foreground" />
        <span className="text-sm font-medium">Drop your résumé PDF here, or click to choose a file</span>
        <span className="text-xs text-muted-foreground">PDF only, up to {MAX_RESUME_MB} MB. Stored privately; only you can see it.</span>
        <input
          id="resume-file"
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          disabled={disabled}
          aria-describedby={error ? "resume-file-error" : undefined}
          onChange={(e) => {
            accept(e.target.files?.[0]);
            e.target.value = ""; // allow choosing the same file again after an error
          }}
        />
      </label>
      {error && (
        <p id="resume-file-error" role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
