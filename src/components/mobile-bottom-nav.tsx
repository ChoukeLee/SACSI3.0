"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, CalendarDays, Home, Users } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { getMobileNavLabels } from "@/lib/nav-labels";
import { cn } from "@/lib/utils";

const mobileTabs = [
  { key: "workbench" as const, href: "/", icon: Home },
  { key: "daily" as const, href: "/daily-rentals", icon: CalendarDays },
  { key: "units" as const, href: "/units", icon: Building2 },
  { key: "profile" as const, href: "/customers", icon: Users },
];

export function MobileBottomNav({ locale, userRole: _userRole }: { locale: Locale; userRole?: string }) {
  const pathname = usePathname();
  const labels = getMobileNavLabels(locale);

  const isActive = (href: string) => {
    const localized = routeFor(locale, href);
    if (href === "/") return pathname === "/" || pathname === "/fr" || pathname === "/front-desk" || pathname === "/fr/front-desk";
    return pathname === localized || pathname.startsWith(localized);
  };

  const resolveHref = (href: string) => {
    if (href === "/" && _userRole === "front_desk") return routeFor(locale, "/front-desk");
    return routeFor(locale, href);
  };

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-sticky border-t border-border/60 bg-card/95 shadow-[0_-10px_30px_-24px_rgba(15,23,42,0.12)] backdrop-blur-xl lg:hidden"
      aria-label="移动端导航"
      style={{ paddingBottom: "var(--safe-bottom)" }}
    >
      <div className="flex items-center justify-around px-1">
        {mobileTabs.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          const label = labels[item.key];
          return (
            <Link
              key={item.key}
              href={resolveHref(item.href)}
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5 min-h-[52px] min-w-[72px] px-1",
                "text-xs font-semibold select-none rounded-lg",
                "transition-colors duration-fast",
                "active:scale-95 active:bg-accent",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              aria-current={active ? "page" : undefined}
            >
              {active && (
                <span className="absolute top-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-primary" />
              )}
              <Icon
                className={cn(
                  "h-[22px] w-[22px] transition-colors duration-[100ms]",
                  active ? "text-primary" : "text-muted-foreground"
                )}
                aria-hidden
                strokeWidth={active ? 2.5 : 2}
              />
              <span className="leading-none">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
