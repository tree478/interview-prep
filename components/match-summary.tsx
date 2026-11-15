import type { MatchResult } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// The big "82%" number. Color gives a quick read; the number is the real info.
export function ScoreBadge({ score, className }: { score: number | null; className?: string }) {
  const tone =
    score === null
      ? "bg-muted text-muted-foreground"
      : score >= 75
        ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
        : score >= 50
          ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
          : "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200";
  return (
    <div
      className={cn("flex size-16 shrink-0 flex-col items-center justify-center rounded-lg", tone, className)}
      aria-label={score === null ? "Match score not available" : `Match score ${score} percent`}
    >
      <span className="text-xl font-semibold tabular-nums">{score === null ? "N/A" : `${score}%`}</span>
      <span className="text-[0.625rem] uppercase tracking-wide opacity-70">match</span>
    </div>
  );
}

// The explanation under the score (MATCH-4, MATCH-5, MATCH-6).
export function MatchReasons({ match }: { match: MatchResult }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      {match.hardMismatch && (
        <Badge variant="destructive" className="h-auto py-1 text-xs whitespace-normal">
          Hard mismatch: {match.hardMismatch}
        </Badge>
      )}

      {match.score === null && (
        <p className="text-muted-foreground">No required skills listed</p>
      )}

      {match.covered.length > 0 && (
        <p>
          <span className="font-medium text-emerald-700 dark:text-emerald-400">Has </span>
          {match.covered.join(", ")}
        </p>
      )}
      {match.missing.length > 0 && (
        <p>
          <span className="font-medium text-rose-700 dark:text-rose-400">Missing </span>
          {match.missing.join(", ")}
        </p>
      )}
      {(match.preferredCovered.length > 0 || match.preferredMissing.length > 0) && (
        <p className="text-muted-foreground">
          Preferred:{" "}
          {[
            ...match.preferredCovered.map((s) => `✓ ${s}`),
            ...match.preferredMissing.map((s) => `✗ ${s}`),
          ].join(", ")}
        </p>
      )}

      {match.checks.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Requirement checks">
          {match.checks.map((check) => (
            <li key={check.name}>
              <Badge variant={check.passed ? "secondary" : "outline"} title={check.detail}>
                {check.passed ? "✓" : "✗"} {CHECK_LABELS[check.name]}
                <span className="sr-only">: {check.detail}</span>
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const CHECK_LABELS: Record<MatchResult["checks"][number]["name"], string> = {
  major: "Major",
  grad_year: "Grad year",
  location: "Location",
  sponsorship: "Sponsorship",
  pay: "Pay",
};
