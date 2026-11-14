"use client";

import Link from "next/link";
import { useState } from "react";
import { getFeed, type FeedFilters } from "@/lib/api";
import type { FeedItem } from "@/lib/types";
import { useApi } from "@/components/use-api";
import { ErrorMessage, LoadingCards, PageHeader } from "@/components/page-state";
import { MatchReasons, ScoreBadge } from "@/components/match-summary";
import { AddToTrackerButton } from "@/components/add-to-tracker-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Job feed (JOB-5). The server already sorts by score, so we keep its order.
export default function FeedPage() {
  const [filters, setFilters] = useState<FeedFilters>({});
  // Re-fetch whenever a filter changes.
  const feed = useApi(() => getFeed(filters), [filters.location, filters.sponsorship, filters.roleType]);

  return (
    <>
      <PageHeader title="Job feed" description="Real Greenhouse and Lever postings, ranked by how well they match your resume." />

      <FeedFilterBar filters={filters} onChange={setFilters} />

      {feed.status === "loading" && <LoadingCards count={4} />}
      {feed.status === "error" && <ErrorMessage message={feed.error} onRetry={feed.reload} />}
      {feed.status === "success" &&
        (feed.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No postings match these filters.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {feed.data.map((item) => (
              <li key={item.job.id}>
                <FeedCard item={item} />
              </li>
            ))}
          </ul>
        ))}
    </>
  );
}

function FeedCard({ item }: { item: FeedItem }) {
  const { job, match } = item;
  return (
    <Card className={match.hardMismatch ? "border-destructive/40" : undefined}>
      <CardContent className="flex gap-4">
        <ScoreBadge score={match.score} />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div>
            <h2 className="font-medium leading-snug">{job.title}</h2>
            <p className="text-sm text-muted-foreground">
              {job.company} · {job.location ?? "Location not listed"}
              {job.deadline && ` · Apply by ${job.deadline}`}
            </p>
          </div>
          <MatchReasons match={match} />
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href={`/dashboard/jobs/${job.id}`}>See gaps &amp; tailor</Link>
            </Button>
            <AddToTrackerButton jobId={job.id} />
            <Button asChild size="sm" variant="ghost">
              <a href={job.url} target="_blank" rel="noopener noreferrer">
                View posting ↗
              </a>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FeedFilterBar({ filters, onChange }: { filters: FeedFilters; onChange: (f: FeedFilters) => void }) {
  // Native <select> elements are keyboard and screen-reader friendly out of the box.
  const selectClass = "h-7 rounded-md border bg-transparent px-2 text-xs";
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="f-location">Location</Label>
        <Input
          id="f-location"
          placeholder="e.g. Boston"
          className="w-40"
          value={filters.location ?? ""}
          onChange={(e) => onChange({ ...filters, location: e.target.value || undefined })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="f-sponsorship">Sponsorship</Label>
        <select
          id="f-sponsorship"
          className={selectClass}
          value={filters.sponsorship ?? ""}
          onChange={(e) =>
            onChange({ ...filters, sponsorship: (e.target.value || undefined) as FeedFilters["sponsorship"] })
          }
        >
          <option value="">Any</option>
          <option value="yes">Sponsors</option>
          <option value="no">Won&apos;t sponsor</option>
          <option value="unknown">Unknown</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="f-role">Role type</Label>
        <select
          id="f-role"
          className={selectClass}
          value={filters.roleType ?? ""}
          onChange={(e) =>
            onChange({ ...filters, roleType: (e.target.value || undefined) as FeedFilters["roleType"] })
          }
        >
          <option value="">Any</option>
          <option value="internship">Internship</option>
          <option value="new_grad">New grad</option>
          <option value="other">Other</option>
        </select>
      </div>
    </div>
  );
}
