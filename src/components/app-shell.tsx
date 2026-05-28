"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import type { Locale, ShellDict } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import type { UserRole } from "@/lib/auth";
import { NotificationBell } from "@/features/notifications";
import { DesktopSidebar } from "@/components/desktop-sidebar";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { GlobalSearch } from "@/features/search";
import { getDesktopNavLabels } from "@/lib/nav-labels";
import { createClient } from "@/lib/supabase/client";

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
    <div className="min-h-screen bg-brand-warm-100">
      <DesktopSidebar locale={locale} userRole={userRole} />

      <div className="lg:pl-60">
        <header className="sticky top-0 z-sticky border-b border-brand-warm-300 bg-white/90 shadow-[0_1px_2px_rgba(36,33,31,0.04)] backdrop-blur-xl">
          <div className="mx-auto flex h-14 max-w-[1480px] items-center justify-between px-4 sm:px-6 lg:px-8">
            <div className="flex flex-1 items-center gap-4">
              <p className="hidden text-[12px] font-bold tracking-[0.04em] text-brand-neutral-900 sm:block">{labels.building}</p>
              <div className="flex-1 flex justify-center sm:justify-start">
                <GlobalSearch locale={locale} />
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <NotificationBell notifications={notifications} t={notifT} locale={locale} />
              <Link
                className="rounded-xl border border-brand-warm-300 bg-white px-3 py-1.5 text-xs font-bold text-brand-ink-900 shadow-sm transition-colors duration-fast hover:border-brand-indigo-200 hover:bg-brand-indigo-50 active:scale-95"
                href={routeFor(otherLocale, pathname)}
                aria-label={locale === "zh" ? "Switch to French" : "切换到中文"}
              >
                {otherLocale.toUpperCase()}
              </Link>
              {roleLabel && (
                <span className="hidden rounded-full bg-brand-indigo-50 px-3 py-1 text-xs font-bold text-brand-indigo-800 ring-1 ring-inset ring-brand-indigo-200 sm:inline-flex">
                  {userDisplayName || roleLabel}
                </span>
              )}
              {userRole && (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-xl p-2 text-brand-neutral-700 transition-colors duration-fast hover:bg-brand-red-50 hover:text-brand-red-600"
                  aria-label={locale === "zh" ? "登出" : "Deconnexion"}
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
