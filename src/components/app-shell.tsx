"use client";

import Link from "next/link";
import { LogOut } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import type { UserRole } from "@/lib/auth";
import { NotificationBell } from "@/features/notifications";
import { DesktopSidebar } from "@/components/desktop-sidebar";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { GlobalSearch } from "@/features/search";
import { getDesktopNavLabels } from "@/lib/nav-labels";
import { createClient } from "@/lib/supabase/client";

export function AppShell({
  children, locale = "zh", userRole, userDisplayName, notifications = [],
}: {
  children: React.ReactNode; locale?: Locale; userRole?: UserRole; userDisplayName?: string;
  notifications?: { id: string; title: string; body: string; read_at: string | null; created_at: string; due_at: string | null }[];
}) {
  const labels = getDesktopNavLabels(locale);
  const otherLocale: Locale = locale === "zh" ? "fr" : "zh";
  const roleLabel = userRole ? labels.roles[userRole] : "";

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen bg-transparent">
      <DesktopSidebar locale={locale} userRole={userRole} />

      <div className="lg:pl-60">
        <header className="sticky top-0 z-sticky border-b border-slate-200 bg-white/90 shadow-[0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur-xl">
          <div className="mx-auto flex h-14 max-w-[1480px] items-center justify-between px-4 sm:px-6 lg:px-8">
            <div className="flex flex-1 items-center gap-4">
              <p className="hidden text-[12px] font-bold tracking-[0.04em] text-slate-600 sm:block">{labels.building}</p>
              <div className="flex-1 flex justify-center sm:justify-start">
                <GlobalSearch locale={locale} />
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <NotificationBell notifications={notifications} locale={locale} />
              <Link
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 shadow-sm transition-colors duration-[100ms] hover:bg-slate-50 active:scale-95"
                href={routeFor(otherLocale, "/")}
              >
                {otherLocale.toUpperCase()}
              </Link>
              {roleLabel && (
                <span className="hidden rounded-full bg-brand-orange-50 px-3 py-1 text-[11px] font-bold text-brand-orange-700 ring-1 ring-inset ring-brand-orange-200 sm:inline-flex">
                  {userDisplayName ? `${roleLabel} · ${userDisplayName}` : roleLabel}
                </span>
              )}
              {userRole && (
                <button
                  onClick={handleLogout}
                  className="rounded-xl p-2 text-slate-400 transition-colors duration-[100ms] hover:bg-red-50 hover:text-red-600"
                  title={locale === "zh" ? "登出" : "Deconnexion"}
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1480px] px-4 py-6 pb-20 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>

      <MobileBottomNav locale={locale} userRole={userRole} />
    </div>
  );
}
