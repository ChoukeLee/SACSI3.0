"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect } from "react";
import { LogOut } from "lucide-react";
import type { Locale, ShellDict } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import type { UserRole } from "@/lib/auth";
import { NotificationBell } from "@/features/notifications";
import { GlobalSearch } from "@/features/search";
import { createClient } from "@/lib/supabase/client";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { NavigationTransitionProvider, useNavigationTransition } from "@/components/navigation-transition-provider";
import { getDesktopNavLabels } from "@/lib/nav-labels";
import { cn } from "@/lib/utils";

function NavigationLoadingBar() {
  const { isNavigating } = useNavigationTransition();
  return (
    <div className="pointer-events-none absolute top-0 left-0 right-0 z-overlay h-0.5 overflow-hidden">
      {isNavigating && (
        <div className="h-full w-1/3 animate-loading-bar rounded-full bg-accentBlue" />
      )}
    </div>
  );
}

export function AppShell({
  children, locale = "zh", userRole, userDisplayName, notifications = [], notifT,
}: {
  children: React.ReactNode; locale?: Locale; userRole?: UserRole; userDisplayName?: string;
  notifications?: { id: string; title: string; body: string; read_at: string | null; created_at: string; due_at: string | null }[];
  notifT: ShellDict["notifications"];
}) {
  return (
    <NavigationTransitionProvider>
      <AppShellInner
        locale={locale}
        userRole={userRole}
        userDisplayName={userDisplayName}
        notifications={notifications}
        notifT={notifT}
      >
        {children}
      </AppShellInner>
    </NavigationTransitionProvider>
  );
}

function AppShellInner({
  children, locale, userRole, userDisplayName, notifications, notifT,
}: {
  children: React.ReactNode; locale: Locale; userRole?: UserRole; userDisplayName?: string;
  notifications: { id: string; title: string; body: string; read_at: string | null; created_at: string; due_at: string | null }[];
  notifT: ShellDict["notifications"];
}) {
  const pathname = usePathname();
  const { isNavigating } = useNavigationTransition();
  const otherLocale: Locale = locale === "zh" ? "fr" : "zh";
  const labels = getDesktopNavLabels(locale);
  const roleLabel = userRole ? labels.roles[userRole] : "";
  const isDailyRoute = pathname === "/daily-rentals" || pathname === "/fr/daily-rentals";

  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    document.body.setAttribute("data-sacis-route", pathname);
    document.body.setAttribute("data-sacis-daily-route", isDailyRoute ? "true" : "false");

    const reconcileRouteRoot = () => {
      const main = document.querySelector<HTMLElement>("[data-app-main]");
      if (!main) return;

      const roots = Array.from(main.querySelectorAll<HTMLElement>(":scope > [data-route-root]"));
      roots.forEach((root) => root.removeAttribute("data-current-route-root"));
      roots.forEach((root, index) => {
        const isCurrentRoot = root.getAttribute("data-route-root") === pathname;
        const isLastRoot = index === roots.length - 1;
        if (!isCurrentRoot || !isLastRoot) {
          root.remove();
          return;
        }
        root.setAttribute("data-current-route-root", "");
      });

      Array.from(main.children).forEach((child) => {
        const el = child as HTMLElement;
        if (el.hasAttribute("data-route-root") || el.hasAttribute("data-navigation-overlay")) return;
        el.remove();
      });
    };

    const reconcileDailyNodes = () => {
      const dailyPages = Array.from(document.querySelectorAll<HTMLElement>("[data-daily-rentals-page]"));
      const dailyCalendars = Array.from(document.querySelectorAll<HTMLElement>("[data-daily-calendar-root]"));

      if (!isDailyRoute) {
        dailyPages.forEach((node) => node.remove());
        dailyCalendars.forEach((node) => node.remove());
        return;
      }

      dailyPages.slice(1).forEach((node) => node.remove());
      dailyCalendars.slice(1).forEach((node) => node.remove());
    };

    reconcileRouteRoot();
    reconcileDailyNodes();
    const reconcile = () => {
      reconcileRouteRoot();
      reconcileDailyNodes();
    };
    const frame = window.requestAnimationFrame(reconcile);
    const timer = window.setTimeout(reconcile, 750);
    const observer = new MutationObserver(reconcile);
    observer.observe(document.querySelector("[data-app-main]") ?? document.body, { childList: true, subtree: true });

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [pathname, isDailyRoute]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [pathname]);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <SidebarProvider defaultOpen>
      <AppSidebar locale={locale} userRole={userRole} />
      <SidebarInset>
        <NavigationLoadingBar />
        <header className="flex h-13 shrink-0 items-center gap-2 border-b border-border/60 bg-card/90 backdrop-blur supports-[backdrop-filter]:bg-card/70">
          <div className="flex w-full items-center justify-between px-4">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="hidden lg:flex" />
              <span className="text-[11px] font-semibold text-muted-foreground tracking-wide">{labels.building}</span>
            </div>
            <div className="flex flex-1 justify-center px-4">
              <div className="w-full max-w-md">
                <GlobalSearch locale={locale} />
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <NotificationBell notifications={notifications} t={notifT} locale={locale} />
              <Link
                href={routeFor(otherLocale, pathname)}
                prefetch={false}
                className="rounded-md border border-border/60 px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                {labels.shell.langLabel}
              </Link>
              {roleLabel && (
                <span className="hidden rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground sm:inline-flex">
                  {userDisplayName || roleLabel}
                </span>
              )}
              <button
                onClick={handleLogout}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                aria-label={labels.shell.logout}
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>
        <main data-app-main className="relative isolate min-w-0 flex-1 overflow-x-hidden bg-background p-4 pb-20 sm:p-6 lg:p-8">
          {isNavigating && (
            <div data-navigation-overlay className="pointer-events-auto absolute inset-0 z-overlay bg-background/40" />
          )}
          <div
            key={pathname}
            data-route-root={pathname}
            data-current-route-root
            className={cn("min-w-0", isNavigating ? "pointer-events-none select-none" : "")}
          >
            {children}
          </div>
        </main>
      </SidebarInset>
      <MobileBottomNav locale={locale} userRole={userRole} />
    </SidebarProvider>
  );
}
