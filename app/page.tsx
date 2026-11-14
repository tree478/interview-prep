import Link from "next/link";
import { Button } from "@/components/ui/button";

// Home page. Server Component: static content, no interactivity.
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <p className="text-sm font-medium text-muted-foreground">For UMass Amherst students</p>
      <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
        Your career coach that knows UMass
      </h1>
      <p className="mt-4 max-w-xl text-base text-muted-foreground">
        See real internships ranked by how well you match, close each gap with a CICS course or lab,
        and tailor your resume without inventing a thing.
      </p>
      <div className="mt-8 flex gap-3">
        <Button asChild size="lg">
          <Link href="/signup">Get started</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/login">Log in</Link>
        </Button>
      </div>
    </main>
  );
}
