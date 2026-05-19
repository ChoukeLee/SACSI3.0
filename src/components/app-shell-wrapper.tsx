"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import type { UserRole } from "@/lib/auth";

/* PERF: AppShellWrapper reads pathname and renders AppShell with correct locale.
   Placed in root layout so AppShell persists across all page navigations —
   the sidebar, header, and mobile nav are never unmounted. */
export function AppShellWrapper({
  children,
  userRole,
  notifications = [],
}: {
  children: React.ReactNode;
  userRole?: UserRole;
  notifications?: { id: string; title: string; body: string; read_at: string | null; created_at: string; due_at: string | null }[];
}) {
  const pathname = usePathname();
  const locale = pathname.startsWith("/fr") ? "fr" : "zh";

  return (
    <AppShell locale={locale} userRole={userRole} notifications={notifications}>
      {children}
    </AppShell>
  );
}
