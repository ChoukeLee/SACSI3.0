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

export function MobileBottomNav({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const labels = getMobileNavLabels(locale);

  const isActive = (href: string) => {
    const localized = routeFor(locale, href);
    if (href === "/") return pathname === "/" || pathname === "/fr";
    return pathname === localized || pathname.startsWith(localized + "/");
  };

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-sticky border-t border-brand-warm-400 bg-white lg:hidden"
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
              href={routeFor(locale, item.href)}
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5 min-h-[52px] min-w-[72px] px-1",
                "text-[11px] font-semibold select-none rounded-lg",
                "transition-colors duration-[100ms]",
                "active:scale-95 active:bg-brand-warm-100",
                active
                  ? "text-brand-orange"
                  : "text-brand-ink-400"
              )}
              aria-current={active ? "page" : undefined}
            >
              {/* Active indicator bar */}
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-brand-orange" />
              )}
              <Icon
                className={cn(
                  "h-[22px] w-[22px] transition-colors duration-[100ms]",
                  active ? "text-brand-orange" : "text-brand-ink-400/60"
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
