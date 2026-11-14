import { Suspense } from "react";
import { AppSidebar, AppSidebarFallback } from "@/components/app-sidebar";

// A layout wraps every page inside its folder. Everything under /dashboard
// gets the sidebar, and `children` is whichever page the URL points to.
// This is a Server Component (no "use client"): it only arranges things.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Suspense fallback={<AppSidebarFallback />}>
        <AppSidebar />
      </Suspense>
      <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
