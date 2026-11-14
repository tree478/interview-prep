"use client";

import { getBotRuns } from "@/lib/api";
import type { BotRun } from "@/lib/types";
import { useApi } from "@/components/use-api";
import { ErrorMessage, LoadingCards, PageHeader } from "@/components/page-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

// Bot activity panel (JOB-4). A-8 adds the Run Scout / Refresh courses
// buttons and polling while a run is in progress.
export default function BotPage() {
  const runs = useApi(getBotRuns, []);
  return (
    <>
      <PageHeader title="Bot activity" description="What the Grok Scout Bot checked, why, and what it found." />
      {runs.status === "loading" && <LoadingCards count={3} />}
      {runs.status === "error" && <ErrorMessage message={runs.error} onRetry={runs.reload} />}
      {runs.status === "success" && (
        <ul className="flex flex-col gap-3">
          {runs.data.map((run) => (
            <li key={run.id}>
              <RunCard run={run} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function RunCard({ run }: { run: BotRun }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{run.kind === "scout" ? "Scout run" : "Course sync"}</span>
          <Badge variant={run.status === "failed" ? "destructive" : run.status === "running" ? "default" : "secondary"}>
            {run.status}
          </Badge>
          <Badge variant="outline">{run.trigger}</Badge>
          <span className="text-muted-foreground">{new Date(run.startedAt).toLocaleString()}</span>
        </div>

        {run.kind === "scout" && (
          <p>
            {run.jobsAdded} postings added · {run.jobsExtracted} extracted
          </p>
        )}
        {run.courseStats && (
          <p>
            {run.courseStats.unchanged
              ? `No changes (${run.courseStats.found} courses)`
              : `${run.courseStats.found} found · ${run.courseStats.added} added · ${run.courseStats.changed} changed · ${run.courseStats.removed} removed`}
          </p>
        )}

        {run.companiesSelected.length > 0 && (
          <ul className="flex flex-col gap-1">
            {run.companiesSelected.map((c) => (
              <li key={c.company}>
                <span className="font-medium">{c.company}</span>
                {c.fallback && <Badge variant="outline" className="ml-1">fallback</Badge>}
                <span className="text-muted-foreground"> · {c.reason}</span>
              </li>
            ))}
          </ul>
        )}

        {run.errors.length > 0 && (
          <details className="text-destructive">
            <summary className="cursor-pointer">{run.errors.length} error{run.errors.length === 1 ? "" : "s"}</summary>
            <ul className="mt-1 list-disc pl-5">
              {run.errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
