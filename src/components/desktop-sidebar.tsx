"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote, BarChart3, Building2, CalendarDays, FileSignature, FileText, Home, LayoutDashboard, Settings, Users,
} from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { getDesktopNavLabels } from "@/lib/nav-labels";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/auth";

type NavKey = "dashboard" | "units" | "dailyRentals" | "dailyOccupancy" | "leases" | "sales" | "customers" | "finance" | "management" | "reports" | "settings" | "documents";

const navItems: { key: NavKey; href: string; icon: typeof Home }[] = [
  { key: "dashboard", href: "/", icon: Home },
  { key: "management", href: "/management", icon: LayoutDashboard },
  { key: "units", href: "/units", icon: Building2 },
  { key: "dailyRentals", href: "/daily-rentals", icon: CalendarDays },
  { key: "dailyOccupancy", href: "/daily-rentals/overview", icon: BarChart3 },
  { key: "leases", href: "/leases", icon: FileSignature },
  { key: "sales", href: "/sales", icon: Building2 },
  { key: "customers", href: "/customers", icon: Users },
  { key: "finance", href: "/finance", icon: Banknote },
  { key: "documents", href: "/documents", icon: FileText },
  { key: "reports", href: "/reports", icon: BarChart3 },
  { key: "settings", href: "/settings", icon: Settings },
];

export function DesktopSidebar({ locale, userRole }: { locale: Locale; userRole?: UserRole }) {
  const pathname = usePathname();
  const labels = getDesktopNavLabels(locale);

  const isActive = (href: string) => {
    const localized = routeFor(locale, href);
    if (href === "/") return pathname === "/" || pathname === "/fr";
    return pathname === localized;
  };

  // Keep all desktop entry points visible. Page/server-action guards still enforce access.
  const visibleItems = navItems;

  return (
    <aside className="fixed inset-y-0 left-0 z-sticky hidden w-56 bg-white border-r border-brand-warm-400 lg:flex lg:flex-col">
      {/* Brand */}
      <div className="flex h-12 items-center gap-3 px-5 pt-0.5 shrink-0">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-orange shadow-sm">
          <span className="text-[11px] font-bold text-white">S</span>
        </div>
        <div className="leading-tight">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-brand-ink-300">SACIS 3.0</p>
          <h1 className="text-[13px] font-semibold tracking-tight text-brand-ink-900">{labels.brand}</h1>
        </div>
      </div>

      <div className="mx-4 border-t border-brand-warm-200" />

      <nav className="flex-1 space-y-0.5 overflow-auto px-3 py-3" aria-label="主导航">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={routeFor(locale, item.href)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium select-none",
                "transition-all duration-[100ms]",
                "active:scale-[0.98]",
                active
                  ? "bg-brand-ink-900 text-white shadow-sm"
                  : "text-brand-ink-500 hover:bg-brand-warm-100 hover:text-brand-ink-700"
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon
                className={cn("h-4 w-4 shrink-0", active ? "text-white" : "text-brand-ink-400")}
                aria-hidden
                strokeWidth={active ? 2.5 : 2}
              />
              <span className="leading-none">{labels.nav[item.key]}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-3 border-t border-brand-warm-200 shrink-0">
        <p className="text-[10px] text-brand-ink-300 font-medium">{labels.building}</p>
      </div>
    </aside>
  );
}
