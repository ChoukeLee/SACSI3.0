"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import type { UserRole } from "@/lib/auth";
import type { ShellDict } from "@/lib/i18n";

export function AppShellWrapper({
  children,
  userRole,
  userDisplayName,
  notifications = [],
  notifT,
  notifTFr,
}: {
  children: React.ReactNode;
  userRole?: UserRole;
  userDisplayName?: string;
  notifications?: { id: string; title: string; body: string; read_at: string | null; created_at: string; due_at: string | null }[];
  notifT: ShellDict["notifications"];
  notifTFr: ShellDict["notifications"];
}) {
  const pathname = usePathname();
  const locale = pathname.startsWith("/fr") ? "fr" : "zh";

  return (
    <AppShell locale={locale} userRole={userRole} userDisplayName={userDisplayName} notifications={notifications} notifT={locale === "fr" ? notifTFr : notifT}>
      {children}
    </AppShell>
  );
}
