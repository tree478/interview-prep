"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { toast } from "sonner";
import { getAts, getFeedItem, getGaps, getLatestTailoring, saveTailorDecisions, tailor } from "@/lib/api";
import type { BulletDiff, TailorResult } from "@/lib/types";
import { useApi } from "@/components/use-api";
import { BulletDiffView } from "@/components/bullet-diff";
import { ErrorMessage, LoadingCards } from "@/components/page-state";
import { MatchReasons, ScoreBadge } from "@/components/match-summary";
import { AddToTrackerButton } from "@/components/add-to-tracker-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Job detail (A-6): score, gap plan, ATS check, and a per-bullet tailoring diff.
export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); // In Next 16, params is a Promise.
  const item = useApi(() => getFeedItem(id), [id]);

  if (item.status === "loading") return <LoadingCards count={1} />;
  if (item.status === "error") return <ErrorMessage message={item.error} onRetry={item.reload} />;

  const { job, match } = item.data;
  return (
    <div className="flex flex-col gap-6">
      <Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">
        ← Back to feed
      </Link>

      <Card>
        <CardContent className="flex gap-4">
          <ScoreBadge score={match.score} />
          <div className="flex flex-1 flex-col gap-3">
            <div>
              <h1 className="text-xl font-semibold">{job.title}</h1>
              <p className="text-sm text-muted-foreground">
                {job.company} · {job.location ?? "Location not listed"}
              </p>
            </div>
            <MatchReasons match={match} />
            <div className="flex flex-wrap gap-2">
              <AddToTrackerButton jobId={job.id} />
              <Button asChild size="sm" variant="outline">
                <Link href={`/dashboard/jobs/${job.id}/interview`}>Practice interview</Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <a href={job.url} target="_blank" rel="noopener noreferrer">View posting ↗</a>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <GapsPanel jobId={job.id} />
      <AtsPanel jobId={job.id} />
      <TailorPanel jobId={job.id} />
    </div>
  );
}

function GapsPanel({ jobId }: { jobId: string }) {
  const gaps = useApi(() => getGaps(jobId), [jobId]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Close your gaps at UMass</CardTitle>
      </CardHeader>
      <CardContent>
        {gaps.status === "loading" && <LoadingCards count={2} />}
        {gaps.status === "error" && <ErrorMessage message={gaps.error} onRetry={gaps.reload} />}
        {gaps.status === "success" && (
          <div className="flex flex-col gap-5">
            {gaps.data.gaps.map(({ skill, resources }) => (
              <section key={skill}>
                <h3 className="mb-2 text-sm font-medium">{skill}</h3>
                {resources.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No UMass match found for {skill}.</p>
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {resources.map((r) => (
                      <li key={r.id} className="rounded-lg border p-3 text-sm">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          {r.type === "course" ? r.code ?? "Course" : "Research lab"}
                        </p>
                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                          {r.name} ↗
                        </a>
                        <p className="mt-1 text-muted-foreground">{r.description}</p>
                        {r.instructors && r.instructors.length > 0 && (
                          <p className="mt-1">Instructors: {r.instructors.join(", ")}</p>
                        )}
                        {r.faculty && r.faculty.length > 0 && (
                          <p className="mt-1">
                            Faculty:{" "}
                            {r.faculty.map((f, i) => (
                              <span key={f.profile_url + f.name}>
                                {i > 0 && ", "}
                                <a href={f.profile_url} target="_blank" rel="noopener noreferrer" className="underline">
                                  {f.name}
                                </a>
                              </span>
                            ))}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AtsPanel({ jobId }: { jobId: string }) {
  const ats = useApi(() => getAts(jobId), [jobId]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Resume check</CardTitle>
      </CardHeader>
      <CardContent>
        {ats.status === "loading" && <LoadingCards count={1} />}
        {ats.status === "error" && <ErrorMessage message={ats.error} onRetry={ats.reload} />}
        {ats.status === "success" &&
          (ats.data.issues.length === 0 ? (
            <p className="text-sm text-muted-foreground">No possible issues found.</p>
          ) : (
            <div className="flex flex-col gap-3 text-sm">
              <p className="font-medium">Possible issues</p>
              <ul className="list-disc pl-5">
                {ats.data.issues.map((issue) => (
                  <li key={issue.detail}>{issue.detail}</li>
                ))}
              </ul>
              <p className="rounded-md bg-muted p-3">
                Consider talking to{" "}
                <a href="https://www.umass.edu/careers" target="_blank" rel="noopener noreferrer" className="font-medium underline">
                  UMass Career Services
                </a>{" "}
                about your resume.
              </p>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}

function TailorPanel({ jobId }: { jobId: string }) {
  const [result, setResult] = useState<TailorResult | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setRunError("");
    setSaveError("");
    getLatestTailoring(jobId).then(
      (saved) => {
        if (cancelled) return;
        setResult(saved);
        setPhase("ready");
      },
      (err: unknown) => {
        if (cancelled) return;
        setResult(null);
        setLoadError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [jobId, loadAttempt]);

  async function run() {
    setRunning(true);
    setRunError("");
    setSaveError("");
    try {
      setResult(await tailor(jobId));
      setPhase("ready");
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  function choose(id: string, status: "accepted" | "rejected") {
    setResult((current) => {
      if (!current) return current;
      return {
        ...current,
        diffs: current.diffs.map((diff) => (diff.id === id ? { ...diff, status } : diff)),
      };
    });
  }

  async function save() {
    if (!result || saving) return;
    const decisions = decided(result.diffs);
    if (decisions.length === 0) return;
    setSaving(true);
    setSaveError("");
    try {
      await saveTailorDecisions(result.tailoringId, decisions, { jobId, result });
      toast.success("Saved tailoring decisions");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const blockedCount = result ? (result.blocked.length > 0 ? result.blocked.length : result.rejectedCount) : 0;
  const allProposed = !result || result.diffs.every((diff) => diff.status === "proposed");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tailor your resume</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {phase === "loading" && <LoadingCards count={2} />}
        {phase === "error" && (
          <ErrorMessage message={loadError} onRetry={() => setLoadAttempt((n) => n + 1)} />
        )}
        {phase === "ready" && !result && (
          <Button type="button" onClick={run} disabled={running} className="w-fit">
            {running ? "Rewriting bullets…" : "Tailor bullets for this job"}
          </Button>
        )}
        {phase === "ready" && result && (
          <>
            {blockedCount > 0 && (
              <details className="rounded-lg border border-amber-500/40 p-3">
                <summary className="cursor-pointer font-medium">
                  {blockedCount} {blockedCount === 1 ? "rewrite" : "rewrites"} blocked
                </summary>
                {result.blocked.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-2">
                    {result.blocked.map((blocked) => (
                      <li key={blocked.attempted}>
                        <p className="text-muted-foreground">{blocked.attempted}</p>
                        <p className="font-medium">{blocked.reason}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            )}
            <ul className="flex flex-col gap-3">
              {result.diffs.map((diff) => (
                <li key={diff.id} className="rounded-lg border p-3">
                  <BulletDiffView before={diff.before} after={diff.after} />
                  <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Decision for this bullet">
                    <Button
                      type="button"
                      size="sm"
                      variant={diff.status === "accepted" ? "default" : "outline"}
                      aria-pressed={diff.status === "accepted"}
                      disabled={saving || running}
                      onClick={() => choose(diff.id, "accepted")}
                    >
                      Accept
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={diff.status === "rejected" ? "default" : "outline"}
                      aria-pressed={diff.status === "rejected"}
                      disabled={saving || running}
                      onClick={() => choose(diff.id, "rejected")}
                    >
                      Reject
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              onClick={save}
              disabled={allProposed || saving || running}
              className="w-fit"
            >
              {saving ? "Saving…" : "Save"}
            </Button>
            {saveError && <ErrorMessage message={saveError} onRetry={save} />}
            <Button type="button" variant="outline" onClick={run} disabled={running || saving} className="w-fit">
              {running ? "Rewriting bullets…" : "Tailor bullets for this job"}
            </Button>
          </>
        )}
        {phase === "ready" && runError && <ErrorMessage message={runError} onRetry={run} />}
      </CardContent>
    </Card>
  );
}

function decided(diffs: BulletDiff[]): { id: string; status: "accepted" | "rejected" }[] {
  return diffs.flatMap((diff) =>
    diff.status === "proposed" ? [] : [{ id: diff.id, status: diff.status }],
  );
}
