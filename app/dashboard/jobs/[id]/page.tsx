"use client";

import Link from "next/link";
import { use, useState } from "react";
import { getAts, getFeedItem, getGaps, tailor } from "@/lib/api";
import type { TailorResult } from "@/lib/types";
import { useApi } from "@/components/use-api";
import { ErrorMessage, LoadingCards } from "@/components/page-state";
import { MatchReasons, ScoreBadge } from "@/components/match-summary";
import { AddToTrackerButton } from "@/components/add-to-tracker-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Job detail (A-6): score, gap plan, ATS check, tailoring.
// A-1 version: renders each panel from mocks. A-6 adds word-level diff
// highlighting and saving accept/reject decisions.
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
  // This one waits for a button click, so it doesn't use useApi.
  const [result, setResult] = useState<TailorResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  async function run() {
    setStatus("loading");
    try {
      setResult(await tailor(jobId));
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tailor your resume</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {!result && (
          <Button onClick={run} disabled={status === "loading"} className="w-fit">
            {status === "loading" ? "Rewriting bullets…" : "Tailor bullets for this job"}
          </Button>
        )}
        {status === "error" && <ErrorMessage message={error} onRetry={run} />}
        {result && (
          <>
            <ul className="flex flex-col gap-3">
              {result.diffs.map((d) => (
                <li key={d.id} className="rounded-lg border p-3">
                  <p className="text-muted-foreground line-through">{d.before}</p>
                  <p className="mt-1">{d.after}</p>
                </li>
              ))}
            </ul>
            {result.blocked.length > 0 && (
              <details className="rounded-lg border border-amber-500/40 p-3">
                <summary className="cursor-pointer font-medium">
                  {result.blocked.length} rewrite{result.blocked.length === 1 ? "" : "s"} blocked
                </summary>
                <ul className="mt-2 flex flex-col gap-2">
                  {result.blocked.map((b) => (
                    <li key={b.attempted}>
                      <p className="text-muted-foreground">{b.attempted}</p>
                      <p className="font-medium">{b.reason}</p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
