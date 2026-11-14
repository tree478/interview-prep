"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { addApplication } from "@/lib/api";

// TAILOR-5: shown on feed cards and the job detail page.
export function AddToTrackerButton({ jobId, size = "sm" }: { jobId: string; size?: "sm" | "default" }) {
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  async function handleClick() {
    setState("saving");
    try {
      await addApplication(jobId);
      setState("saved");
      toast.success("Added to your tracker");
    } catch (err) {
      setState("idle");
      toast.error(err instanceof Error ? err.message : "Could not add to tracker");
    }
  }

  return (
    <Button variant="outline" size={size} onClick={handleClick} disabled={state !== "idle"}>
      {state === "saved" ? "In tracker ✓" : state === "saving" ? "Adding…" : "Add to tracker"}
    </Button>
  );
}
