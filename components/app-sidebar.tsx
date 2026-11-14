"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Briefcase01Icon,
  BubbleChatQuestionIcon,
  KanbanIcon,
  Robot01Icon,
  UserCircleIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { SignOutButton } from "@/components/sign-out-button";

const NAV = [
  { href: "/dashboard", label: "Job feed", icon: Briefcase01Icon },
  { href: "/dashboard/tracker", label: "Tracker", icon: KanbanIcon },
  { href: "/dashboard/interview", label: "Interview prep", icon: BubbleChatQuestionIcon },
  { href: "/dashboard/bot", label: "Bot activity", icon: Robot01Icon },
  { href: "/dashboard/profile", label: "Profile", icon: UserCircleIcon },
];

function isActive(pathname: string, href: string) {
  // "/dashboard" is the feed, and job detail pages belong to it too.
  if (href === "/dashboard") return pathname === "/dashboard" || pathname.startsWith("/dashboard/jobs");
  return pathname.startsWith(href);
}

// The sidebar with the current page highlighted. usePathname() reads the URL,
// so the layout wraps this in <Suspense> (see app/dashboard/layout.tsx).
export function AppSidebar() {
  return <SidebarNav pathname={usePathname()} />;
}

// Same sidebar with nothing highlighted. Shown for a split second while
// AppSidebar is waiting for the URL.
export function AppSidebarFallback() {
  return <SidebarNav pathname={null} />;
}

function SidebarNav({ pathname }: { pathname: string | null }) {
  return (
    <nav
      aria-label="Main"
      className="flex shrink-0 gap-1 overflow-x-auto border-b bg-sidebar p-2 md:h-screen md:w-56 md:flex-col md:border-r md:border-b-0 md:p-3 md:sticky md:top-0"
    >
      <Link href="/dashboard" className="mb-0 hidden px-2 py-3 text-sm font-semibold md:block">
        UMass Career Coach
      </Link>
      {NAV.map(({ href, label, icon }) => {
        const active = pathname !== null && isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm whitespace-nowrap text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
            )}
          >
            <HugeiconsIcon icon={icon} size={16} aria-hidden="true" />
            {label}
          </Link>
        );
      })}
      <SignOutButton />
    </nav>
  );
}
