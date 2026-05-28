"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import type { Locale, ShellDict } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import type { UserRole } from "@/lib/auth";
import { NotificationBell } from "@/features/notifications";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { GlobalSearch } from "@/features/search";
import { getDesktopNavLabels } from "@/lib/nav-labels";
import { createClient } from "@/lib/supabase/client";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";

export function AppShell({
  children, locale = "zh", userRole, userDisplayName, notifications = [], notifT,
}: {
  children: React.ReactNode; locale?: Locale; userRole?: UserRole; userDisplayName?: string;
  notifications?: { id: string; title: string; body: string; read_at: string | null; created_at: string; due_at: string | null }[];
  notifT: ShellDict["notifications"];
}) {
  const pathname = usePathname();
  const labels = getDesktopNavLabels(locale);
  const otherLocale: Locale = locale === "zh" ? "fr" : "zh";
  const roleLabel = userRole ? labels.roles[userRole] : "";

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <SidebarProvider defaultOpen>
      <AppSidebar locale={locale} userRole={userRole} />
      <SidebarInset>
        <header className="sticky top-0 z-sticky flex h-14 shrink-0 items-center gap-2 border-b border-brand-warm-200 bg-white/95 backdrop-blur transition-[width,height] ease-linear">
          <div className="flex w-full items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="hidden lg:flex" />
              <p className="text-xs font-bold tracking-[0.04em] text-brand-ink-500">{labels.building}</p>
            </div>
            <div className="flex flex-1 items-center justify-center gap-4 px-4">
              <div className="w-full max-w-md">
                <GlobalSearch locale={locale} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <NotificationBell notifications={notifications} t={notifT} locale={locale} />
              <Link
                className="rounded-lg border border-brand-warm-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-brand-ink-700 shadow-sm transition-colors hover:border-brand-indigo-200 hover:bg-brand-indigo-50"
                href={routeFor(otherLocale, pathname)}
              >
                {otherLocale.toUpperCase()}
              </Link>
              {roleLabel && (
                <span className="hidden rounded-full bg-brand-indigo-50 px-2.5 py-1 text-xs font-semibold text-brand-indigo-700 ring-1 ring-inset ring-brand-indigo-200 sm:inline-flex">
                  {userDisplayName || roleLabel}
                </span>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-lg p-2 text-brand-ink-400 transition-colors hover:bg-brand-red-50 hover:text-brand-red-600"
                aria-label={locale === "zh" ? "登出" : "Deconnexion"}
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>
        <main className="p-4 pb-20 sm:p-6 lg:p-8">{children}</main>
      </SidebarInset>
      <MobileBottomNav locale={locale} userRole={userRole} />
    </SidebarProvider>
  );
}
