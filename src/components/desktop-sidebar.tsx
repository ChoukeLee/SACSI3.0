"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpDown, Banknote, BarChart3, BedDouble, Bell, Building2,
  CalendarDays, FileSignature, FileText, Layers,
  LayoutDashboard, Settings, Shield, ShieldCheck, Target, Users,
} from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { getDesktopNavLabels } from "@/lib/nav-labels";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/auth";

// ── Types ──

type NavKey = "management" | "units" | "roomMatrix" | "dailyRentals" | "leases" | "sales" | "customers" | "finance" | "reports" | "todos" | "documents" | "dataQuality" | "auditLogs" | "dataExchange" | "bulkActions" | "targets" | "settings" | "security";

interface NavItem {
  key: NavKey;
  href: string;
  icon: typeof LayoutDashboard;
  activeMatch?: string; // path prefix to match for active state
}

interface NavGroup {
  key: string;
  items: NavItem[];
  roles: UserRole[];
}

// ── All groups ──

const allGroups: NavGroup[] = [
  {
    key: "home",
    roles: ["admin", "boss", "finance", "front_desk"],
    items: [
      { key: "management", href: "/management", icon: LayoutDashboard },
    ],
  },
  {
    key: "assets",
    roles: ["admin", "boss", "front_desk"],
    items: [
      { key: "units", href: "/units", icon: Building2, activeMatch: "/units" },
      { key: "roomMatrix", href: "/daily-rentals/overview", icon: BarChart3 },
    ],
  },
  {
    key: "business",
    roles: ["admin", "boss", "finance", "front_desk"],
    items: [
      { key: "dailyRentals", href: "/daily-rentals", icon: CalendarDays },
      { key: "leases", href: "/leases", icon: FileSignature },
      { key: "sales", href: "/sales", icon: Building2 },
      { key: "customers", href: "/customers", icon: Users, activeMatch: "/customers" },
    ],
  },
  {
    key: "financeCenter",
    roles: ["admin", "boss", "finance"],
    items: [
      { key: "finance", href: "/finance", icon: Banknote },
      { key: "reports", href: "/reports", icon: BarChart3 },
    ],
  },
  {
    key: "operations",
    roles: ["admin", "boss", "finance", "front_desk"],
    items: [
      { key: "todos", href: "/todos", icon: Bell },
      { key: "documents", href: "/documents", icon: FileText },
      { key: "dataQuality", href: "/data-quality", icon: ShieldCheck },
      { key: "auditLogs", href: "/settings/audit-logs", icon: Shield, activeMatch: "/settings/audit-logs" },
    ],
  },
  {
    key: "systemTools",
    roles: ["admin", "boss", "finance"],
    items: [
      { key: "dataExchange", href: "/data-exchange", icon: ArrowUpDown },
      { key: "bulkActions", href: "/bulk-actions", icon: Layers },
      { key: "targets", href: "/management/targets", icon: Target, activeMatch: "/management/targets" },
      { key: "settings", href: "/settings", icon: Settings, activeMatch: "/settings" },
      { key: "security", href: "/settings/security", icon: Shield, activeMatch: "/settings/security" },
    ],
  },
];

// ── Role-based filtering ──

const BOSS_HIDDEN_KEYS = new Set<NavKey>(["bulkActions"]);
const FINANCE_VISIBLE_GROUPS = new Set(["home", "business", "financeCenter", "operations", "systemTools"]);
const FINANCE_HIDDEN_KEYS = new Set<NavKey>(["management", "dailyRentals", "roomMatrix", "bulkActions", "security", "targets", "dataQuality", "settings"]);
const FINANCE_EXTRA_HIDDEN = new Set<NavKey>(["leases", "sales"]);

const FRONT_DESK_VISIBLE_GROUPS = new Set(["home", "assets", "business", "operations"]);
const FRONT_DESK_VISIBLE_KEYS = new Set<NavKey>(["roomMatrix", "units", "dailyRentals", "customers", "todos", "documents"]);

function filterGroups(groups: NavGroup[], role?: UserRole): NavGroup[] {
  if (!role) return [];

  if (role === "admin") return groups.map(g => ({ ...g, items: [...g.items] }));

  if (role === "boss") {
    return groups
      .filter(g => g.roles.includes("boss"))
      .map(g => ({ ...g, items: g.items.filter(i => !BOSS_HIDDEN_KEYS.has(i.key)) }))
      .filter(g => g.items.length > 0);
  }

  if (role === "finance") {
    return groups
      .filter(g => FINANCE_VISIBLE_GROUPS.has(g.key))
      .map(g => ({
        ...g,
        items: g.items.filter(i =>
          !FINANCE_HIDDEN_KEYS.has(i.key) &&
          !FINANCE_EXTRA_HIDDEN.has(i.key) &&
          i.key !== "management" && i.key !== "dailyRentals" && i.key !== "roomMatrix" && i.key !== "dataQuality"
        ),
      }))
      .filter(g => g.items.length > 0);
  }

  if (role === "front_desk") {
    return groups
      .filter(g => FRONT_DESK_VISIBLE_GROUPS.has(g.key))
      .map(g => ({ ...g, items: g.items.filter(i => FRONT_DESK_VISIBLE_KEYS.has(i.key)) }))
      .filter(g => g.items.length > 0);
  }

  return [];
}

// ── Component ──

export function DesktopSidebar({ locale, userRole }: { locale: Locale; userRole?: UserRole }) {
  const pathname = usePathname();
  const labels = getDesktopNavLabels(locale);

  const visibleGroups = filterGroups(allGroups, userRole);

  const isActive = (item: NavItem) => {
    const matchesPath = (target: string, exact = false) => {
      if (exact) return pathname === target;
      return pathname === target || pathname.startsWith(`${target}/`);
    };

    if (item.activeMatch) {
      const prefix = routeFor(locale, item.activeMatch);
      return matchesPath(prefix, item.key === "settings");
    }

    const localized = routeFor(locale, item.href);
    if (item.href === "/") return pathname === "/" || pathname === "/fr";
    return pathname === localized;
  };

  const resolveHref = (item: NavItem) => {
    return routeFor(locale, item.href);
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-sticky hidden w-60 border-r border-brand-warm-300 bg-white/92 shadow-[4px_0_24px_-22px_rgba(36,33,31,0.3)] backdrop-blur-xl lg:flex lg:flex-col">
      {/* Brand */}
      <div className="flex h-16 shrink-0 items-center gap-3 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-brand-orange shadow-lifted">
          <span className="text-[11px] font-bold text-white">S</span>
        </div>
        <div className="leading-tight">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-neutral-600">SACIS 3.0</p>
          <h1 className="text-sm font-bold tracking-tight text-brand-ink-900">{labels.brand}</h1>
        </div>
      </div>

      <div className="mx-4 border-t border-brand-warm-300" />

      <nav className="flex-1 space-y-5 overflow-auto px-3 py-4" aria-label="主导航">
        {visibleGroups.map(group => (
          <div key={group.key}>
            <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.1em] text-brand-neutral-600">
              {labels.groups[group.key]}
            </p>
            <div className="space-y-1">
              {group.items.map(item => {
                const Icon = item.icon;
                const active = isActive(item);
                return (
                  <Link
                    key={item.key}
                    href={resolveHref(item)}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold select-none",
                      "transition-all duration-[100ms]",
                      "active:scale-[0.98]",
                      active
                        ? "bg-brand-orange-500 text-white shadow-lifted"
                        : "text-brand-ink-800 hover:bg-brand-orange-50 hover:text-brand-orange-800"
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon
                      className={cn("h-4 w-4 shrink-0", active ? "text-white" : "text-brand-neutral-600")}
                      aria-hidden
                      strokeWidth={active ? 2.5 : 2}
                    />
                    <span className="leading-none">{labels.nav[item.key]}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-brand-warm-300 px-5 py-3">
        <p className="text-[10px] font-semibold text-brand-neutral-600">{labels.building}</p>
      </div>
    </aside>
  );
}
