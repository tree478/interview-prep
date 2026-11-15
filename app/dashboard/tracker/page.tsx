"use client";

import Link from "next/link";
import { toast } from "sonner";
import { getApplications, updateApplication } from "@/lib/api";
import type { Application, Stage } from "@/lib/types";
import { useApi } from "@/components/use-api";
import { ErrorMessage, LoadingCards, PageHeader } from "@/components/page-state";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const STAGES: { id: Stage; label: string }[] = [
  { id: "saved", label: "Saved" },
  { id: "applied", label: "Applied" },
  { id: "interviewing", label: "Interviewing" },
  { id: "offer", label: "Offer" },
];

// Soonest deadline first; cards with no deadline go last (TRACK-2).
function byDeadline(a: Application, b: Application) {
  if (!a.deadline && !b.deadline) return 0;
  if (!a.deadline) return 1;
  if (!b.deadline) return -1;
  return a.deadline.localeCompare(b.deadline); // ISO dates sort correctly as strings
}

// Application tracker (TRACK-1/2/3/5).
export default function TrackerPage() {
  const apps = useApi(getApplications, []);

  async function changeStage(app: Application, stage: Stage) {
    if (apps.status !== "success") return;
    const previous = apps.data;
    // "Optimistic update": move the card right away, undo if the save fails.
    apps.setData(previous.map((a) => (a.id === app.id ? { ...a, stage } : a)));
    try {
      await updateApplication({ id: app.id, stage });
    } catch (err) {
      apps.setData(previous);
      toast.error(err instanceof Error ? err.message : "Could not update stage");
    }
  }

  async function changeDeadline(app: Application, value: string) {
    if (apps.status !== "success") return;
    const previous = apps.data;
    const deadline = value === "" ? null : value;
    apps.setData(
      previous.map((a) =>
        a.id === app.id
          ? { ...a, deadline, deadlineSource: deadline ? "user" : null }
          : a,
      ),
    );
    try {
      await updateApplication({ id: app.id, deadline });
    } catch (err) {
      apps.setData(previous);
      toast.error(err instanceof Error ? err.message : "Could not update deadline");
    }
  }

  return (
    <>
      <PageHeader title="Application tracker" description="Every application by stage, soonest deadline first." />
      {apps.status === "loading" && <LoadingCards count={2} />}
      {apps.status === "error" && <ErrorMessage message={apps.error} onRetry={apps.reload} />}
      {apps.status === "success" && apps.data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No applications yet. Add a job from the{" "}
          <Link href="/dashboard" className="underline underline-offset-4">
            feed
          </Link>
          .
        </p>
      )}
      {apps.status === "success" && apps.data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STAGES.map((stage) => {
            const cards = apps.data.filter((a) => a.stage === stage.id).sort(byDeadline);
            return (
              <section key={stage.id} aria-labelledby={`col-${stage.id}`} className="flex flex-col gap-2">
                <h2 id={`col-${stage.id}`} className="text-sm font-medium">
                  {stage.label} <span className="text-muted-foreground">({cards.length})</span>
                </h2>
                {cards.map((app) => (
                  <Card key={app.id} size="sm">
                    <CardContent className="flex flex-col gap-2 text-sm">
                      <Link href={`/dashboard/jobs/${app.job.id}`} className="font-medium leading-snug hover:underline">
                        {app.job.title}
                      </Link>
                      <Link
                        href={`/dashboard/jobs/${app.job.id}/interview`}
                        className="font-medium leading-snug hover:underline"
                      >
                        Practice interview
                      </Link>
                      <p className="text-muted-foreground">
                        {app.job.company}
                        {app.matchScore !== null && ` · ${app.matchScore}% match`}
                      </p>
                      <p className={app.deadline ? undefined : "text-muted-foreground"}>
                        {app.deadline ? `Due ${app.deadline}` : "No deadline"}
                      </p>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor={`deadline-${app.id}`}>Deadline</Label>
                        <Input
                          id={`deadline-${app.id}`}
                          type="date"
                          value={app.deadline ?? ""}
                          onChange={(event) => changeDeadline(app, event.target.value)}
                        />
                      </div>
                      <label className="sr-only" htmlFor={`stage-${app.id}`}>Stage</label>
                      <select
                        id={`stage-${app.id}`}
                        className="h-7 rounded-md border bg-transparent px-2 text-xs"
                        value={app.stage}
                        onChange={(e) => changeStage(app, e.target.value as Stage)}
                      >
                        {STAGES.map((s) => (
                          <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                      </select>
                    </CardContent>
                  </Card>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
