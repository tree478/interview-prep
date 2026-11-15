import Link from "next/link";
import { Button } from "@/components/ui/button";

// Home page. Server Component: static content, no interactivity.
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <p className="text-sm font-medium text-muted-foreground">For UMass Amherst students</p>
      <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        A career coach that knows UMass
      </h1>
      <p className="mt-4 max-w-xl text-lg leading-snug text-balance">
        UMass students send one generic resume to dozens of postings and cannot tell which roles they qualify for or how to close the gap.
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
