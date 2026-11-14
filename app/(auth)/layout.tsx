import Link from "next/link";

// Wraps /login and /signup (the "(auth)" group doesn't appear in the URL).
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-6 text-sm font-semibold">
        UMass Career Coach
      </Link>
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">{children}</div>
    </main>
  );
}
