"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote,
  BarChart3,
  Building2,
  CalendarDays,
  FileSignature,
  Home,
  Settings,
  Users,
} from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries, routeFor } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/auth";
import { NotificationBell } from "@/features/notifications";

const navItems = [
  { key: "dashboard", href: "/", icon: Home },
  { key: "units", href: "/units", icon: Building2 },
  { key: "dailyRentals", href: "/daily-rentals", icon: CalendarDays },
  { key: "dailyOccupancy", href: "/daily-rentals/overview", icon: CalendarDays },
  { key: "leases", href: "/leases", icon: FileSignature },
  { key: "sales", href: "/sales", icon: Building2 },
  { key: "customers", href: "/customers", icon: Users },
  { key: "finance", href: "/finance", icon: Banknote },
  { key: "reports", href: "/reports", icon: BarChart3 },
  { key: "settings", href: "/settings", icon: Settings },
] as const;

export function AppShell({
  children,
  locale = "zh",
  userRole,
  notifications = [],
}: {
  children: React.ReactNode;
  locale?: Locale;
  userRole?: UserRole;
  notifications?: { id: string; title: string; body: string; read_at: string | null; created_at: string; due_at: string | null }[];
}) {
  const t = dictionaries[locale].shell;
  const otherLocale: Locale = locale === "zh" ? "fr" : "zh";
  const roleLabel = userRole ? t.roles[userRole] : t.roles.admin;
  const pathname = usePathname();

  const isActive = (href: string) => {
    const localized = routeFor(locale, href);
    if (href === "/") return pathname === "/" || pathname === "/fr";
    /* UX-FIX: exact match only — prevents /daily-rentals matching /daily-rentals/overview */
    return pathname === localized;
  };

  return (
    <div className="min-h-screen bg-[#f7f8f5]">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-sticky hidden w-60 border-r border-black/10 bg-white lg:flex lg:flex-col">
        {/* Brand */}
        <div className="flex h-16 items-center gap-3 border-b border-black/10 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-orange-500">
            <span className="text-sm font-bold text-white">S</span>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-brand-orange-500">
              SACIS 3.0
            </p>
            <h1 className="text-sm font-bold leading-tight text-brand-ink-900">
              {t.brand}
            </h1>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 overflow-auto px-3 py-4" aria-label="主导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={routeFor(locale, item.href)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-fast",
                  active
                    ? "bg-brand-orange-50 text-brand-orange-500"
                    : "text-brand-ink-700 hover:bg-brand-orange-50/50 hover:text-brand-orange-500"
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden />
                {t.nav[item.key]}
                {active && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-orange-500" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Sidebar footer */}
        <div className="border-t border-black/10 px-5 py-3">
          <p className="text-[10px] text-brand-ink-300">
            {locale === "zh" ? "首期 SASCI11 / 11#公寓" : "Phase 1 SASCI11"}
          </p>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-60">
        {/* Header — UX-REFACTOR: compact on mobile (h-12), normal on desktop */}
        <header className="sticky top-0 z-sticky border-b border-black/10 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
          <div className="flex h-12 items-center justify-between px-3 sm:px-6 lg:h-14 lg:px-8">
            {/* Building indicator — UX-REFACTOR: abbreviated on mobile */}
            <div>
              <p className="hidden text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-ink-300 sm:block">
                {t.currentBuilding}
              </p>
              <p className="text-xs font-semibold leading-none text-brand-ink-900 sm:text-sm sm:leading-tight">
                11#公寓
              </p>
            </div>

            {/* Right section — UX-REFACTOR: compact on mobile */}
            <div className="flex items-center gap-1.5 text-brand-ink-500 sm:gap-3">
              <NotificationBell notifications={notifications} locale={locale} />

              {/* Language switcher — icon-only on mobile */}
              <Link
                className="rounded-md px-1.5 py-1 text-xs font-semibold text-brand-orange-500 transition-colors duration-fast hover:bg-brand-orange-50 sm:px-2"
                href={routeFor(otherLocale, "/")}
              >
                <span className="hidden sm:inline">{locale === "zh" ? "中文" : "Français"}</span>
                <span className="sm:hidden">{otherLocale.toUpperCase()}</span>
                <span className="ml-0.5 text-brand-ink-300">|</span>
                <span className="ml-0.5">{locale === "zh" ? "FR" : "中"}</span>
              </Link>

              {/* Role badge — hidden on smallest screens */}
              <span className="hidden rounded-full bg-brand-orange-50 px-2 py-0.5 text-[10px] font-semibold text-brand-orange-600 sm:inline-flex sm:px-2.5 sm:text-xs">
                {roleLabel}
              </span>
            </div>
          </div>
        </header>

        {/* Page content — PERF: pb-16 reserves space for mobile bottom nav */}
        <main className="px-4 py-6 pb-20 sm:px-6 lg:pb-6 lg:px-8">{children}</main>
      </div>

      {/* Mobile bottom navigation — UX-REFACTOR: 4-item core nav for field ops, safe-area */}
      <nav className="fixed inset-x-0 bottom-0 z-sticky border-t border-black/10 bg-white/95 backdrop-blur lg:hidden" aria-label="移动端导航" style={{ paddingBottom: "var(--safe-bottom)" }}>
        <div className="flex items-center justify-around px-2 py-1">
          {[
            { key: "workbench", href: "/", icon: Home },
            { key: "daily", href: "/daily-rentals", icon: CalendarDays },
            { key: "units", href: "/units", icon: Building2 },
            { key: "profile", href: "/customers", icon: Users },
          ].map(item => {
            const Icon = item.icon;
            const active = isActive(item.href);
            const mobileT = dictionaries[locale].mobile;
            return (
              <Link
                key={item.key}
                href={routeFor(locale, item.href)}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 min-h-[52px] min-w-[64px] px-1 text-[10px] font-semibold transition-colors duration-fast rounded-xl",
                  active ? "text-brand-orange-500 bg-brand-orange-50/50" : "text-brand-ink-400 active:bg-brand-ink-50"
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-6 w-6" aria-hidden />
                <span className="leading-none">{mobileT[item.key as keyof typeof mobileT]}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
