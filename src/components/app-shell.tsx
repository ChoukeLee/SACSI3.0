"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { LogOut, UserRound } from "lucide-react";
import type { Locale, ShellDict } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import type { UserRole } from "@/lib/auth";
import { NotificationBell } from "@/features/notifications";
import { Logo } from "@/components/logo";
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

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.setAttribute("data-sacis-route", pathname);
    document.body.setAttribute("data-sacis-daily-route", isDailyRoute ? "true" : "false");

    const frame = window.requestAnimationFrame(() => {
      if (!isDailyRoute) {
        document.querySelectorAll("[data-daily-rentals-page], [data-daily-calendar-root]").forEach(function(n) { n.remove(); });
      } else {
        document.querySelectorAll("[data-daily-rentals-page]:nth-child(n+2), [data-daily-calendar-root]:nth-child(n+2)").forEach(function(n) { n.remove(); });
      }
    });
    return function() { window.cancelAnimationFrame(frame); };
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
        <header className="sticky top-0 z-sticky flex h-12 shrink-0 items-center border-b border-border bg-card/95 shadow-xs backdrop-blur supports-[backdrop-filter]:bg-card/90">
          <div className="grid w-full grid-cols-[minmax(200px,320px)_minmax(180px,1fr)_minmax(200px,320px)] items-center gap-3 px-4">
            <div className="flex min-w-0 items-center gap-2">
              <SidebarTrigger className="hidden lg:flex" />
              <Logo variant="full-horizontal" size={36} />
            </div>
            <div className="flex min-w-0 justify-center">
              <div className="w-full max-w-[220px]">
                <GlobalSearch locale={locale} />
              </div>
            </div>
            <div className="ml-auto flex h-9 items-center gap-1 rounded-lg border border-border bg-muted/55 p-0.5 shadow-xs">
              <NotificationBell notifications={notifications} t={notifT} locale={locale} />
              <Link
                href={routeFor(otherLocale, pathname)}
                prefetch={false}
                className="inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
              >
                {labels.shell.langLabel}
              </Link>
              {roleLabel && (
                <span className="hidden h-8 items-center gap-1.5 rounded-md bg-card px-2.5 text-xs font-medium text-foreground shadow-xs sm:inline-flex">
                  <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
                  {userDisplayName || roleLabel}
                </span>
              )}
              <button
                onClick={handleLogout}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                aria-label={labels.shell.logout}
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>
        <main data-app-main className="relative isolate min-w-0 flex-1 overflow-x-hidden bg-background p-4 pb-20 sm:p-5 lg:p-6">
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
