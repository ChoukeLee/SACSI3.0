"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote, BarChart3, Building2, CalendarDays, FileSignature, Home, Settings, Users,
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
  { key: "dailyOccupancy", href: "/daily-rentals/overview", icon: BarChart3 },
  { key: "leases", href: "/leases", icon: FileSignature },
  { key: "sales", href: "/sales", icon: Building2 },
  { key: "customers", href: "/customers", icon: Users },
  { key: "finance", href: "/finance", icon: Banknote },
  { key: "reports", href: "/reports", icon: BarChart3 },
  { key: "settings", href: "/settings", icon: Settings },
] as const;

export function AppShell({
  children, locale = "zh", userRole, notifications = [],
}: {
  children: React.ReactNode; locale?: Locale; userRole?: UserRole;
  notifications?: { id: string; title: string; body: string; read_at: string | null; created_at: string; due_at: string | null }[];
}) {
  const t = dictionaries[locale].shell;
  const otherLocale: Locale = locale === "zh" ? "fr" : "zh";
  const roleLabel = userRole ? t.roles[userRole] : t.roles.admin;
  const pathname = usePathname();

  const isActive = (href: string) => {
    const localized = routeFor(locale, href);
    if (href === "/") return pathname === "/" || pathname === "/fr";
    return pathname === localized;
  };

  return (
    <div className="min-h-screen bg-brand-surface">
      {/* Sidebar — macOS style: translucent warm gray, no hard border */}
      <aside className="fixed inset-y-0 left-0 z-sticky hidden w-56 bg-brand-surface-100/90 backdrop-blur-xl lg:flex lg:flex-col">
        {/* Brand — understated Apple-style */}
        <div className="flex h-12 items-center gap-3 px-5 pt-1">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-blue">
            <span className="text-[11px] font-bold text-white">S</span>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-brand-ink-400">SACIS 3.0</p>
            <h1 className="text-[13px] font-semibold tracking-tight text-brand-ink-800">{t.brand}</h1>
          </div>
        </div>

        {/* Navigation — Apple sidebar: clean, generous padding, subtle active state */}
        <nav className="flex-1 space-y-0.5 overflow-auto px-3 py-3" aria-label="主导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={routeFor(locale, item.href)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-fast",
                  active
                    ? "bg-brand-blue/10 text-brand-blue"
                    : "text-brand-ink-500 hover:bg-white/50 hover:text-brand-ink-700"
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-4 w-4 shrink-0 opacity-75" aria-hidden />
                {t.nav[item.key]}
              </Link>
            );
          })}
        </nav>

        <div className="px-5 py-3">
          <p className="text-[10px] text-brand-ink-400">{locale === "zh" ? "SASCI11 · 11#" : "SASCI11 · Phase 1"}</p>
        </div>
      </aside>

      {/* Main area */}
      <div className="lg:pl-56">
        {/* Header — macOS Vibrancy: translucent glass, blur, no thick border */}
        <header className="sticky top-0 z-sticky border-b border-black/5 bg-brand-surface-50/80 backdrop-blur-xl">
          <div className="flex h-11 items-center justify-between px-4 sm:px-6 lg:px-8">
            <p className="text-[12px] font-medium text-brand-ink-500">SASCI11 · 11#</p>
            <div className="flex items-center gap-2 sm:gap-3">
              <NotificationBell notifications={notifications} locale={locale} />
              <Link
                className="rounded-md px-2 py-1 text-[11px] font-medium text-brand-ink-500 transition-colors duration-fast hover:bg-black/5 hover:text-brand-blue"
                href={routeFor(otherLocale, "/")}
              >
                {otherLocale.toUpperCase()}
              </Link>
              <span className="hidden rounded-full bg-brand-blue/10 px-2.5 py-0.5 text-[10px] font-medium text-brand-blue sm:inline-flex">
                {roleLabel}
              </span>
            </div>
          </div>
        </header>

        {/* Page content — generous top padding, responsive */}
        <main className="px-4 py-5 pb-20 sm:px-6 lg:px-8 lg:py-7">{children}</main>
      </div>

      {/* Mobile bottom nav — macOS style: translucent, refined */}
      <nav
        className="fixed inset-x-0 bottom-0 z-sticky border-t border-black/5 bg-brand-surface-50/85 backdrop-blur-xl lg:hidden"
        aria-label="移动端导航"
        style={{ paddingBottom: "var(--safe-bottom)" }}
      >
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
                  "flex flex-col items-center justify-center gap-0.5 min-h-[50px] min-w-[64px] px-1 text-[10px] font-semibold transition-colors duration-fast rounded-xl",
                  active ? "text-brand-blue" : "text-brand-ink-400 active:bg-black/5"
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
