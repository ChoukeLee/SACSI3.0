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
  SidebarSeparator,
} from "@/components/ui/sidebar";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { getDesktopNavLabels } from "@/lib/nav-labels";
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
  labelKey: string;
  items: NavItem[];
  roles: UserRole[];
}

const groups: NavGroup[] = [
  {
    key: "home", labelKey: "home",
    roles: ["admin", "boss", "finance", "front_desk"],
    items: [
      { key: "management", href: "/management", icon: LayoutDashboard },
      { key: "units", href: "/units", icon: Building2, activeMatch: "/units" },
    ],
  },
  {
    key: "business", labelKey: "business",
    roles: ["admin", "boss", "finance", "front_desk"],
    items: [
      { key: "dailyRentals", href: "/daily-rentals", icon: CalendarDays },
      { key: "leases", href: "/leases", icon: FileSignature },
      { key: "sales", href: "/sales", icon: Building2 },
      { key: "customers", href: "/customers", icon: Users, activeMatch: "/customers" },
    ],
  },
  {
    key: "financeCenter", labelKey: "financeCenter",
    roles: ["admin", "boss", "finance"],
    items: [
      { key: "finance", href: "/finance", icon: Banknote },
      { key: "reports", href: "/reports", icon: BarChart3 },
    ],
  },
  {
    key: "operations", labelKey: "operations",
    roles: ["admin", "boss", "finance", "front_desk"],
    items: [
      { key: "todos", href: "/todos", icon: Bell },
      { key: "documents", href: "/documents", icon: FileText },
      { key: "dataQuality", href: "/data-quality", icon: ShieldCheck },
      { key: "auditLogs", href: "/settings/audit-logs", icon: Shield, activeMatch: "/settings/audit-logs" },
    ],
  },
  {
    key: "systemTools", labelKey: "systemTools",
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
const FINANCE_GROUPS = new Set(["home", "business", "financeCenter", "operations", "systemTools"]);
const FINANCE_HIDDEN = new Set<NavKey>(["management", "dailyRentals", "bulkActions", "security", "targets", "dataQuality", "settings", "leases", "sales"]);
const FRONT_GROUPS = new Set(["home", "business", "operations"]);
const FRONT_KEYS = new Set<NavKey>(["management", "units", "dailyRentals", "customers", "todos", "documents"]);

function filterGroups(role?: UserRole): NavGroup[] {
  if (!role || role === "admin") return groups;
  if (role === "boss") return groups.map(g => ({ ...g, items: g.items.filter(i => !BOSS_HIDDEN.has(i.key)) })).filter(g => g.items.length > 0);
  if (role === "finance") return groups.filter(g => FINANCE_GROUPS.has(g.key)).map(g => ({ ...g, items: g.items.filter(i => !FINANCE_HIDDEN.has(i.key)) })).filter(g => g.items.length > 0);
  if (role === "front_desk") return groups.filter(g => FRONT_GROUPS.has(g.key)).map(g => ({ ...g, items: g.items.filter(i => FRONT_KEYS.has(i.key)) })).filter(g => g.items.length > 0);
  return [];
}

export function AppSidebar({ locale, userRole }: { locale: Locale; userRole?: UserRole }) {
  const pathname = usePathname();
  const labels = getDesktopNavLabels(locale);
  const visible = filterGroups(userRole);

  const isActive = (item: NavItem) => {
    const target = item.activeMatch ? routeFor(locale, item.activeMatch) : routeFor(locale, item.href);
    return pathname === target || (item.activeMatch ? pathname.startsWith(target) : false);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground shadow-sm group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8">
            S
          </div>
          <div className="group-data-[collapsible=icon]:hidden">
            <p className="text-xs font-medium text-sidebar-foreground/60">{labels.brand}</p>
          </div>
        </div>
        <SidebarSeparator />
      </SidebarHeader>
      <SidebarContent>
        {visible.map(group => (
          <SidebarGroup key={group.key}>
            <SidebarGroupLabel>{labels.groups[group.key]}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map(item => {
                const Icon = item.icon;
                const active = isActive(item);
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton asChild isActive={active} tooltip={labels.nav[item.key]}>
                      <Link href={routeFor(locale, item.href)}>
                        <Icon strokeWidth={active ? 2.5 : 2} />
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
      <SidebarFooter>
        <p className="px-2 text-xs text-sidebar-foreground/50">{labels.building}</p>
      </SidebarFooter>
    </Sidebar>
  );
}
