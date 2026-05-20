"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpDown, Banknote, BarChart3, BedDouble, Bell, Building2,
  CalendarDays, FileSignature, FileText, Home, Layers,
  LayoutDashboard, Settings, Shield, ShieldCheck, Target, Users,
} from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { getDesktopNavLabels } from "@/lib/nav-labels";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/auth";

// ── Types ──

type NavKey = "workbench" | "management" | "units" | "roomMatrix" | "dailyRentals" | "leases" | "sales" | "customers" | "finance" | "reports" | "todos" | "documents" | "dataQuality" | "auditLogs" | "dataExchange" | "bulkActions" | "targets" | "settings" | "security";

interface NavItem {
  key: NavKey;
  href: string;
  icon: typeof Home;
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
      { key: "workbench", href: "/", icon: Home },
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
const FRONT_DESK_VISIBLE_KEYS = new Set<NavKey>(["workbench", "roomMatrix", "units", "dailyRentals", "customers", "todos", "documents"]);

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
    if (item.activeMatch) {
      const prefix = routeFor(locale, item.activeMatch);
      if (prefix === "/settings" && pathname === "/settings") return true;
      if (prefix === "/settings" && pathname.startsWith("/settings/") && item.key !== "settings") {
        // Only match if this specific item matches the prefix
        return item.activeMatch === "/settings/audit-logs" ? pathname.startsWith(routeFor(locale, "/settings/audit-logs"))
          : item.activeMatch === "/settings/security" ? pathname.startsWith(routeFor(locale, "/settings/security"))
          : pathname.startsWith(prefix);
      }
      return pathname.startsWith(prefix);
    }
    const localized = routeFor(locale, item.href);
    if (item.href === "/") return pathname === "/" || pathname === "/fr";
    return pathname === localized;
  };

  const resolveHref = (item: NavItem) => {
    if (item.key === "workbench" && userRole === "front_desk") {
      return routeFor(locale, "/front-desk");
    }
    return routeFor(locale, item.href);
  };

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

      <nav className="flex-1 overflow-auto px-3 py-3 space-y-4" aria-label="主导航">
        {visibleGroups.map(group => (
          <div key={group.key}>
            <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-ink-300">
              {labels.groups[group.key]}
            </p>
            <div className="space-y-0.5">
              {group.items.map(item => {
                const Icon = item.icon;
                const active = isActive(item);
                return (
                  <Link
                    key={item.key}
                    href={resolveHref(item)}
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
            </div>
          </div>
        ))}
      </nav>

      <div className="px-5 py-3 border-t border-brand-warm-200 shrink-0">
        <p className="text-[10px] text-brand-ink-300 font-medium">{labels.building}</p>
      </div>
    </aside>
  );
}
