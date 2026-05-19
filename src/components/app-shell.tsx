"use client";

import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import type { UserRole } from "@/lib/auth";
import { NotificationBell } from "@/features/notifications";
import { DesktopSidebar } from "@/components/desktop-sidebar";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { getDesktopNavLabels } from "@/lib/nav-labels";

export function AppShell({
  children, locale = "zh", userRole, notifications = [],
}: {
  children: React.ReactNode; locale?: Locale; userRole?: UserRole;
  notifications?: { id: string; title: string; body: string; read_at: string | null; created_at: string; due_at: string | null }[];
}) {
  const labels = getDesktopNavLabels(locale);
  const otherLocale: Locale = locale === "zh" ? "fr" : "zh";
  const roleLabel = userRole ? labels.roles[userRole] : labels.roles.admin;

  return (
    <div className="min-h-screen bg-brand-warm">
      {/* Desktop sidebar — self-contained client component, uses usePathname internally */}
      <DesktopSidebar locale={locale} />

      {/* Main area */}
      <div className="lg:pl-56">
        {/* Header — no backdrop-blur for GPU perf, solid bg */}
        <header className="sticky top-0 z-sticky border-b border-brand-warm-400 bg-white">
          <div className="flex h-11 items-center justify-between px-4 sm:px-6 lg:px-8">
            <p className="text-[12px] font-medium text-brand-ink-500">{labels.building}</p>
            <div className="flex items-center gap-2 sm:gap-3">
              <NotificationBell notifications={notifications} locale={locale} />
              <Link
                className="rounded-md border border-brand-warm-400 px-2.5 py-1 text-[11px] font-semibold text-brand-ink-600 transition-colors duration-[100ms] hover:bg-brand-warm-100 hover:text-brand-ink-800 active:scale-95"
                href={routeFor(otherLocale, "/")}
              >
                {otherLocale.toUpperCase()}
              </Link>
              <span className="hidden rounded-full bg-brand-orange-50 px-2.5 py-0.5 text-[10px] font-semibold text-brand-orange-600 ring-1 ring-inset ring-brand-orange-200/50 sm:inline-flex">
                {roleLabel}
              </span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="px-4 py-5 pb-20 sm:px-6 lg:px-8 lg:py-7">{children}</main>
      </div>

      {/* Mobile bottom nav — self-contained client component */}
      <MobileBottomNav locale={locale} />
    </div>
  );
}
