import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { AppShell } from "@/components/app-shell";
import type { UserRole } from "@/lib/auth";

const state = vi.hoisted(() => ({ pathname: "/management", sidebar: "expanded", mobile: false }));
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams("state=pending&page=2"),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => <aside /> }));
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarInset: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  SidebarTrigger: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  useSidebar: () => ({ state: state.sidebar, isMobile: state.mobile }),
}));
vi.mock("@/components/navigation-transition-provider", () => ({
  NavigationTransitionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useNavigationTransition: () => ({
    isNavigating: false,
    pendingHref: null,
    startNavigation: vi.fn(),
  }),
}));

beforeEach(() => {
  state.pathname = "/management";
  state.sidebar = "expanded";
  state.mobile = false;
});

it.each(["zh", "fr"] as const)("keeps %s inbox navigation in the current language", (locale) => {
  state.pathname = locale === "fr" ? "/fr/management" : "/management";
  const html = renderToStaticMarkup(
    <AppShell locale={locale} userRole="admin">
      Content
    </AppShell>,
  );
  expect(html).toContain(`href="${locale === "fr" ? "/fr" : ""}/operator"`);
});

it("keeps the mobile menu reachable even after a desktop sidebar was collapsed", () => {
  state.sidebar = "collapsed";
  state.mobile = true;
  const html = renderToStaticMarkup(
    <AppShell locale="zh" userRole="admin">
      Content
    </AppShell>,
  );
  expect(html).toContain('aria-label="切换导航"');
  state.mobile = false;
  expect(
    renderToStaticMarkup(
      <AppShell locale="zh" userRole="admin">
        Content
      </AppShell>,
    ),
  ).not.toContain('aria-label="切换导航"');
});

it.each([
  ["admin", "/management", 5],
  ["boss", "/management", 5],
  ["finance", "/finance", 5],
  ["front_desk", "/daily-rentals", 2],
  ["rental_sales", "/leases", 4],
] as const)(
  "gives %s a reachable role-appropriate mobile start and one active tab",
  (role, start, count) => {
    state.pathname = `/fr${start}`;
    const html = renderToStaticMarkup(<MobileBottomNav locale="fr" userRole={role as UserRole} />);
    expect((html.match(/<a /g) ?? []).length).toBe(count);
    expect(html).toContain(`href="/fr${start}"`);
    expect((html.match(/aria-current="page"/g) ?? []).length).toBe(1);
    expect(html).not.toContain("min-w-[72px]");
    if (role === "front_desk") {
      expect(html).not.toContain('href="/fr/sales"');
      expect(html).not.toContain('href="/fr/management"');
    }
    if (role === "rental_sales") expect(html).not.toContain('href="/fr/management"');
  },
);

it("retains read-only management audit navigation without showing it to finance", () => {
  const boss = renderToStaticMarkup(
    <AppShell locale="fr" userRole="boss">
      Content
    </AppShell>,
  );
  expect(boss).toContain('href="/fr/settings/audit-logs"');
  const finance = renderToStaticMarkup(
    <AppShell locale="fr" userRole="finance">
      Content
    </AppShell>,
  );
  expect(finance).not.toContain('href="/fr/settings/audit-logs"');
  expect(finance).not.toContain('href="/fr/settings"');
});
