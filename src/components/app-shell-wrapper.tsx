"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import type { UserRole } from "@/lib/auth";

export function AppShellWrapper({
  children,
  userRole,
  userDisplayName,
}: {
  children: React.ReactNode;
  userRole?: UserRole;
  userDisplayName?: string;
}) {
  const pathname = usePathname();
  const locale = pathname.startsWith("/fr") ? "fr" : "zh";

  if (pathname === "/login") return <>{children}</>;

  return (
    <AppShell locale={locale} userRole={userRole} userDisplayName={userDisplayName}>
      {children}
    </AppShell>
  );
}
