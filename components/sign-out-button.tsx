"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Logout01Icon } from "@hugeicons/core-free-icons";
import { signOut } from "@/lib/api";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      await signOut();
      router.push("/login");
      router.refresh(); // drop anything rendered for the old session
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not log out");
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm whitespace-nowrap text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:opacity-50 md:mt-auto"
    >
      <HugeiconsIcon icon={Logout01Icon} size={16} aria-hidden="true" />
      {busy ? "Logging out…" : "Log out"}
    </button>
  );
}
