"use client";

import Link from "next/link";
import { getApplications } from "@/lib/api";
import { useApi } from "@/components/use-api";
import { ErrorMessage, LoadingCards, PageHeader } from "@/components/page-state";
import { Card, CardContent } from "@/components/ui/card";

// Interview questions are generated per job, so this page just lets you pick
// one of the jobs in your tracker.
export default function InterviewIndexPage() {
  const apps = useApi(getApplications, []);
  return (
    <>
      <PageHeader title="Interview prep" description="Pick a job from your tracker to practice for." />
      {apps.status === "loading" && <LoadingCards count={3} />}
      {apps.status === "error" && <ErrorMessage message={apps.error} onRetry={apps.reload} />}
      {apps.status === "success" &&
        (apps.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add a job to your tracker from the <Link href="/dashboard" className="underline">feed</Link> first.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {apps.data.map((app) => (
              <li key={app.id}>
                <Link href={`/dashboard/jobs/${app.job.id}/interview`} className="block rounded-xl focus-visible:outline-2">
                  <Card className="transition-colors hover:bg-muted/50">
                    <CardContent className="text-sm">
                      <p className="font-medium">{app.job.title}</p>
                      <p className="text-muted-foreground">{app.job.company}</p>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </>
  );
}
