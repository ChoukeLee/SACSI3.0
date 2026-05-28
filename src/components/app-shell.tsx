"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import type { Locale, ShellDict } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import type { UserRole } from "@/lib/auth";
import { NotificationBell } from "@/features/notifications";
import { GlobalSearch } from "@/features/search";
import { createClient } from "@/lib/supabase/client";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";

export function AppShell({
  children, locale = "zh", userRole, userDisplayName, notifications = [], notifT,
}: {
  children: React.ReactNode; locale?: Locale; userRole?: UserRole; userDisplayName?: string;
  notifications?: { id: string; title: string; body: string; read_at: string | null; created_at: string; due_at: string | null }[];
  notifT: ShellDict["notifications"];
}) {
  const pathname = usePathname();
  const otherLocale: Locale = locale === "zh" ? "fr" : "zh";
  const roleLabel = userRole ? (locale === "zh" ? { admin: "管理员", boss: "老板", finance: "财务", front_desk: "前台" }[userRole] : { admin: "Admin", boss: "Proprio", finance: "Compta", front_desk: "Reception" }[userRole]) : "";

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <SidebarProvider defaultOpen>
      <AppSidebar locale={locale} userRole={userRole} />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60">
          <div className="flex w-full items-center justify-between px-4">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="hidden lg:flex" />
              <span className="text-xs font-semibold text-muted-foreground">{locale === "zh" ? "SASCI11 · 11#" : "SASCI11 · Phase 1"}</span>
            </div>
            <div className="flex flex-1 justify-center px-4">
              <div className="w-full max-w-md">
                <GlobalSearch locale={locale} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <NotificationBell notifications={notifications} t={notifT} locale={locale} />
              <Link href={routeFor(otherLocale, pathname)} className="rounded-md border px-2.5 py-1.5 text-xs font-semibold hover:bg-accent">
                {otherLocale.toUpperCase()}
              </Link>
              {roleLabel && (
                <span className="hidden rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground sm:inline-flex">
                  {userDisplayName || roleLabel}
                </span>
              )}
              <button onClick={handleLogout} className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={locale === "zh" ? "登出" : "Deconnexion"}>
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>
        <main className="flex-1 p-4 pb-20 sm:p-6 lg:p-8">{children}</main>
      </SidebarInset>
      <MobileBottomNav locale={locale} userRole={userRole} />
    </SidebarProvider>
  );
}
