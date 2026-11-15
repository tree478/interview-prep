"use client";

import { useEffect, useRef, useState } from "react";
import { getBotRuns, refreshCourses, runScout } from "@/lib/api";
import type { BotRun } from "@/lib/types";
import { useApi } from "@/components/use-api";
import { ErrorMessage, LoadingCards, PageHeader } from "@/components/page-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const POLL_RUNNING_MS = 3_000;
const POLL_IDLE_MS = 30_000;

// Bot activity panel (JOB-4, GAP-2b). Start a scout or course run, then poll
// until that row leaves "running" — no full page reload.
export default function BotPage() {
  const runs = useApi(getBotRuns, []);
  const [scoutPending, setScoutPending] = useState(false);
  const [coursesPending, setCoursesPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Blocks a second click in the gap before the list shows the running row.
  const holdScout = useRef(false);
  const holdCourses = useRef(false);

  const list = runs.status === "success" ? runs.data : undefined;
  const scoutRunning = list?.some((run) => run.kind === "scout" && run.status === "running") ?? false;
  const coursesRunning = list?.some((run) => run.kind === "courses" && run.status === "running") ?? false;
  const pollMs = list?.some((run) => run.status === "running") ? POLL_RUNNING_MS : POLL_IDLE_MS;

  const reloadRef = useRef(runs.reload);
  reloadRef.current = runs.reload;

  useEffect(() => {
    const timer = window.setInterval(() => reloadRef.current(), pollMs);
    return () => window.clearInterval(timer);
  }, [pollMs]);

  useEffect(() => {
    if (holdScout.current && (scoutRunning || runs.status === "error")) {
      holdScout.current = false;
      setScoutPending(false);
    }
    if (holdCourses.current && (coursesRunning || runs.status === "error")) {
      holdCourses.current = false;
      setCoursesPending(false);
    }
  }, [scoutRunning, coursesRunning, runs.status]);

  async function onRunScout() {
    if (holdScout.current || scoutRunning) return;
    holdScout.current = true;
    setScoutPending(true);
    setActionError(null);
    try {
      await runScout();
      runs.reload();
    } catch (err) {
      holdScout.current = false;
      setScoutPending(false);
      setActionError(err instanceof Error ? err.message : "Could not start run");
    }
  }

  async function onRefreshCourses() {
    if (holdCourses.current || coursesRunning) return;
    holdCourses.current = true;
    setCoursesPending(true);
    setActionError(null);
    try {
      await refreshCourses();
      runs.reload();
    } catch (err) {
      holdCourses.current = false;
      setCoursesPending(false);
      setActionError(err instanceof Error ? err.message : "Could not start run");
    }
  }

  return (
    <>
      <PageHeader title="Bot activity" description="What the Grok Scout Bot checked, why, and what it found.">
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => void onRunScout()} disabled={scoutPending || scoutRunning}>
            Run Scout now
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void onRefreshCourses()}
            disabled={coursesPending || coursesRunning}
          >
            Refresh courses
          </Button>
        </div>
      </PageHeader>
      {actionError && (
        <div role="alert" className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {actionError}
        </div>
      )}
      {runs.status === "loading" && <LoadingCards count={3} />}
      {runs.status === "error" && <ErrorMessage message={runs.error} onRetry={runs.reload} />}
      {runs.status === "success" && runs.data.length === 0 && (
        <p className="text-sm text-muted-foreground">No bot runs yet</p>
      )}
      {runs.status === "success" && runs.data.length > 0 && (
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
