"use client";

import Link from "next/link";
import { use, useState } from "react";
import { getInterviewQuestions, gradeAnswer } from "@/lib/api";
import type { InterviewQuestion, StarFeedback } from "@/lib/types";
import { useApi } from "@/components/use-api";
import { ErrorMessage, LoadingCards, PageHeader } from "@/components/page-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Interview prep (PREP-1/2/3): pick a question, answer it, get STAR feedback.
export default function InterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const questions = useApi(() => getInterviewQuestions(id), [id]);
  const [selected, setSelected] = useState<InterviewQuestion | null>(null);

  return (
    <>
      <Link href={`/dashboard/jobs/${id}`} className="text-sm text-muted-foreground hover:underline">
        ← Back to job
      </Link>
      <PageHeader title="Practice interview" description="Answer in text. Feedback follows the STAR method." />

      {questions.status === "loading" && <LoadingCards count={3} />}
      {questions.status === "error" && <ErrorMessage message={questions.error} onRetry={questions.reload} />}
      {questions.status === "success" && (
        <div className="flex flex-col gap-6">
          <ul className="flex flex-col gap-2">
            {questions.data.map((q) => (
              <li key={q.id}>
                <button
                  onClick={() => setSelected(q)}
                  aria-pressed={selected?.id === q.id}
                  className="w-full rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted/50 aria-pressed:border-primary aria-pressed:bg-muted"
                >
                  <Badge variant="outline" className="mb-1">
                    {q.type === "behavioral" ? "Behavioral" : "From your resume"}
                  </Badge>
                  <p>{q.text}</p>
                </button>
              </li>
            ))}
          </ul>
          {/* `key` resets the answer box when you pick a different question. */}
          {selected && <AnswerBox key={selected.id} jobId={id} question={selected} />}
        </div>
      )}
    </>
  );
}

function AnswerBox({ jobId, question }: { jobId: string; question: InterviewQuestion }) {
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<StarFeedback | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault(); // stop the browser from reloading the page on form submit
    setStatus("loading");
    try {
      setFeedback(await gradeAnswer(jobId, question.id, question.text, answer));
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <Label htmlFor="answer">Your answer</Label>
        <Textarea id="answer" rows={6} value={answer} onChange={(e) => setAnswer(e.target.value)} />
        <Button type="submit" className="w-fit" disabled={!answer.trim() || status === "loading"}>
          {status === "loading" ? "Grading…" : "Get feedback"}
        </Button>
      </form>
      {status === "error" && <ErrorMessage message={error} />}
      {feedback && <StarCard feedback={feedback} />}
    </div>
  );
}

function StarCard({ feedback }: { feedback: StarFeedback }) {
  const parts = [
    ["Situation", feedback.situation],
    ["Task", feedback.task],
    ["Action", feedback.action],
    ["Result", feedback.result],
  ] as const;
  return (
    <Card>
      <CardHeader><CardTitle>STAR feedback</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <dl className="grid gap-3 sm:grid-cols-2">
          {parts.map(([label, part]) => (
            <div key={label} className="rounded-lg border p-3">
              <dt className="flex justify-between font-medium">
                {label}
                <span className="tabular-nums" aria-label={`${part.rating} out of 5`}>{part.rating}/5</span>
              </dt>
              <dd className="mt-1 text-muted-foreground">{part.comment}</dd>
            </div>
          ))}
        </dl>
        <p className="rounded-md bg-muted p-3">
          <span className="font-medium">Suggested improvement: </span>
          {feedback.improvement}
        </p>
      </CardContent>
    </Card>
  );
}
