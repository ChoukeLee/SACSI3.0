"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpDown, Banknote, BarChart3, Bell, Building2,
  CalendarDays, FileSignature, FileText, Layers,
  LayoutDashboard, Settings, Shield, ShieldCheck, Target, Users,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter,
  SidebarGroup, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { getDesktopNavLabels } from "@/lib/nav-labels";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/auth";

type NavKey = "management" | "units" | "dailyRentals" | "leases" | "sales" | "customers" | "finance" | "reports" | "todos" | "documents" | "dataQuality" | "auditLogs" | "dataExchange" | "bulkActions" | "targets" | "settings" | "security";

interface NavItem {
  key: NavKey;
  href: string;
  icon: typeof LayoutDashboard;
  activeMatch?: string;
}

interface NavGroup {
  key: string;
  items: NavItem[];
  roles: UserRole[];
}

const allGroups: NavGroup[] = [
  {
    key: "home",
    roles: ["admin", "boss", "finance", "front_desk"],
    items: [
      { key: "management", href: "/management", icon: LayoutDashboard },
      { key: "units", href: "/units", icon: Building2, activeMatch: "/units" },
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

const BOSS_HIDDEN = new Set<NavKey>(["bulkActions"]);
const FINANCE_VISIBLE = new Set(["home", "business", "financeCenter", "operations", "systemTools"]);
const FINANCE_HIDDEN = new Set<NavKey>(["management", "dailyRentals", "bulkActions", "security", "targets", "dataQuality", "settings", "leases", "sales"]);
const FRONT_VISIBLE = new Set(["home", "business", "operations"]);
const FRONT_KEYS = new Set<NavKey>(["management", "units", "dailyRentals", "customers", "todos", "documents"]);

function filterGroups(role?: UserRole): NavGroup[] {
  if (!role || role === "admin") return allGroups;
  if (role === "boss") return allGroups.map(g => ({ ...g, items: g.items.filter(i => !BOSS_HIDDEN.has(i.key)) })).filter(g => g.items.length > 0);
  if (role === "finance") return allGroups.filter(g => FINANCE_VISIBLE.has(g.key)).map(g => ({ ...g, items: g.items.filter(i => !FINANCE_HIDDEN.has(i.key)) })).filter(g => g.items.length > 0);
  if (role === "front_desk") return allGroups.filter(g => FRONT_VISIBLE.has(g.key)).map(g => ({ ...g, items: g.items.filter(i => FRONT_KEYS.has(i.key)) })).filter(g => g.items.length > 0);
  return [];
}

export function AppSidebar({ locale, userRole }: { locale: Locale; userRole?: UserRole }) {
  const pathname = usePathname();
  const labels = getDesktopNavLabels(locale);
  const visibleGroups = filterGroups(userRole);

  const isActive = (item: NavItem) => {
    const localized = routeFor(locale, item.href);
    const matchPath = item.activeMatch ? routeFor(locale, item.activeMatch) : localized;
    return pathname === localized || (item.activeMatch ? pathname.startsWith(matchPath) : false);
  };

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarHeader className="px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-indigo-500 text-xs font-bold text-white shadow-lg shadow-brand-indigo-500/25 group-data-[collapsible=icon]:mx-auto">
            S
          </div>
          <div className="group-data-[collapsible=icon]:hidden">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-sidebar-foreground/50">SACIS 3.0</p>
            <h1 className="text-sm font-bold text-sidebar-foreground">{labels.brand}</h1>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2">
        {visibleGroups.map(group => (
          <SidebarGroup key={group.key}>
            <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-[0.1em] text-sidebar-foreground/40">
              {labels.groups[group.key]}
            </SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map(item => {
                const Icon = item.icon;
                const active = isActive(item);
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton asChild isActive={active} tooltip={labels.nav[item.key]}>
                      <Link href={routeFor(locale, item.href)} className={cn(active && "bg-brand-indigo-500 text-white hover:bg-brand-indigo-600 hover:text-white")}>
                        <Icon className={cn("h-4 w-4", active && "text-white")} strokeWidth={active ? 2.5 : 2} />
                        <span>{labels.nav[item.key]}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="px-5 pb-3">
        <p className="text-[10px] font-semibold text-sidebar-foreground/40">{labels.building}</p>
      </SidebarFooter>
    </Sidebar>
  );
}
