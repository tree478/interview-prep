import resumeMock from "@/mocks/resume.json";
import { PageHeader } from "@/components/page-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Profile (PROF-1, PROF-3). A-1 version: read-only view of the mock profile.
// A-3/A-4 replace this with an editable form that reads and saves the
// `profiles` and `experiences` tables through Supabase.
//
// This is a Server Component (no "use client") because it has no
// interactivity yet. It will become a Client Component once it has a form.
export default function ProfilePage() {
  const { academics, experiences, skills, interests } = resumeMock.parsed;
  return (
    <>
      <PageHeader title="Profile" description="Filled in from your resume. Editing arrives in the next step." />
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader><CardTitle>Academics</CardTitle></CardHeader>
          <CardContent className="grid gap-1 text-sm">
            <p>Year: {academics.year ?? "—"}</p>
            <p>Majors: {academics.majors.join(", ") || "—"}</p>
            <p>Minors: {academics.minors.join(", ") || "—"}</p>
            <p>Honors: {academics.honors.join(", ") || "—"}</p>
            <p>
              Clubs: {academics.clubs.map((c) => (c.role ? `${c.name} (${c.role})` : c.name)).join(", ") || "—"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Experience</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            {experiences.map((exp) => (
              <div key={exp.company + exp.position}>
                <p className="font-medium">{exp.position} · {exp.company}</p>
                <p className="text-muted-foreground">{exp.start_date ?? "?"} – {exp.end_date ?? "Present"}</p>
                <ul className="mt-1 list-disc pl-5">
                  {exp.bullets.map((b) => <li key={b}>{b}</li>)}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Skills and interests</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              {skills.map((s) => <Badge key={s} variant="secondary">{s}</Badge>)}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {interests.map((s) => <Badge key={s} variant="outline">{s}</Badge>)}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
