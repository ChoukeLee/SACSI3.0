"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Building2, CalendarDays, FileSignature, LayoutDashboard } from "lucide-react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { getDesktopNavLabels } from "@/lib/nav-labels";
import { useNavigationTransition } from "@/components/navigation-transition-provider";
import { usePrefetch } from "@/components/navigation-prefetch";
import type { UserRole } from "@/lib/auth";
import { navigationGroupsForRole } from "@/lib/navigation-access";

type NavKey = "management" | "units" | "dailyRentals" | "leases" | "sales";

interface NavItem { key: NavKey; href: string; icon: typeof LayoutDashboard; activeMatch?: string }
interface NavGroup { key: string; labelKey: string; items: NavItem[]; roles: UserRole[] }

const groups: NavGroup[] = [
  { key: "core", labelKey: "core", roles: ["admin", "boss", "finance", "front_desk", "rental_sales"], items: [
    { key: "management", href: "/management", icon: LayoutDashboard },
    { key: "dailyRentals", href: "/daily-rentals", icon: CalendarDays },
    { key: "leases", href: "/leases", icon: FileSignature },
    { key: "sales", href: "/sales", icon: Building2 },
    { key: "units", href: "/units", icon: Building2, activeMatch: "/units" },
  ]},
];

export function AppSidebar({ locale, userRole }: { locale: Locale; userRole?: UserRole }) {
  const pathname = usePathname();
  const { pendingHref, startNavigation } = useNavigationTransition();
  const prefetch = usePrefetch();
  const labels = getDesktopNavLabels(locale);
  const visible = navigationGroupsForRole(groups, userRole);
  const activeHref = pendingHref ?? pathname;

  const isActive = (item: NavItem) => {
    const target = item.activeMatch ? routeFor(locale, item.activeMatch) : routeFor(locale, item.href);
    return activeHref === target || (item.activeMatch ? activeHref.startsWith(target) : false);
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border bg-sidebar">
      <SidebarHeader className="gap-0 border-b border-sidebar-border px-4 h-12 relative">
        <div className="absolute top-0 left-4 flex items-center gap-3 h-full">
          <span className="relative h-7 w-[108px] shrink-0">
            <Image
              src="/logo.png"
              alt="SACSI"
              fill
              sizes="108px"
              className="object-contain"
              priority
            />
          </span>
          <span className="translate-y-[1px] text-[17px] font-semibold italic leading-none text-sidebar-foreground whitespace-nowrap">{labels.brand}</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {visible.map((group, gi) => (
          <SidebarGroup key={group.key} className={gi === 0 ? "" : ""}>
            <SidebarGroupLabel className="h-7 text-xs font-medium text-sidebar-foreground/50">
              {labels.groups[group.key]}
            </SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map(item => {
                const Icon = item.icon;
                const active = isActive(item);
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton asChild isActive={active} tooltip={labels.nav[item.key]} size="default">
                      <Link
                        href={routeFor(locale, item.href)}
                        prefetch={false}
                        onClick={() => {
                          const target = routeFor(locale, item.href);
                          if (pathname !== target) startNavigation(target);
                        }}
                        onMouseEnter={() => prefetch(routeFor(locale, item.href))}
                        onFocus={() => prefetch(routeFor(locale, item.href))}
                      >
                        <Icon className="h-4 w-4" strokeWidth={active ? 2.5 : 1.75} />
                        <span className="text-[13px] font-medium">{labels.nav[item.key]}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border px-4 py-3">
        <p className="text-[11px] font-medium text-sidebar-foreground/45">{labels.system}</p>
      </SidebarFooter>
    </Sidebar>
  );
}
