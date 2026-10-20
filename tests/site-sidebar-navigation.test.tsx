// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppSidebar } from "@/components/app-sidebar";
vi.mock("@/components/ui/sheet", () => ({
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));
const state = vi.hoisted(() => ({
  mobile: true,
  pathname: "/management",
  close: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <img alt={alt} /> }));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    onNavigate,
  }: {
    children: React.ReactNode;
    href: string;
    onNavigate?: (event: { preventDefault(): void }) => void;
  }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onNavigate?.({ preventDefault: () => {} });
      }}
    >
      {children}
    </a>
  ),
}));
vi.mock("@/components/navigation-transition-provider", () => ({
  useNavigationTransition: () => ({ pendingHref: null, startNavigation: state.navigate }),
}));
vi.mock("@/components/ui/sidebar", () => {
  const Box = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  return {
    Sidebar: Box,
    SidebarContent: Box,
    SidebarFooter: Box,
    SidebarGroup: Box,
    SidebarGroupLabel: Box,
    SidebarHeader: Box,
    SidebarMenu: Box,
    SidebarMenuButton: Box,
    SidebarMenuItem: Box,
    useSidebar: () => ({
      state: "expanded",
      isMobile: state.mobile,
      toggleSidebar: vi.fn(),
      setOpenMobile: state.close,
    }),
  };
});
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.mobile = true;
  state.pathname = "/management";
  state.close.mockClear();
  state.navigate.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function open(locale: "zh" | "fr", href: string) {
  await act(async () => root.render(<AppSidebar locale={locale} userRole="admin" />));
  const link = container.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
  expect(link).not.toBeNull();
  await act(async () => link!.click());
}
it.each(["zh", "fr"] as const)("closes the mobile menu before %s navigation", async (locale) => {
  const href = `${locale === "fr" ? "/fr" : ""}/reports`;
  await open(locale, href);
  expect(state.close).toHaveBeenCalledExactlyOnceWith(false);
  expect(state.navigate).toHaveBeenCalledExactlyOnceWith(href);
});
it("closes the menu for the current destination without a duplicate navigation", async () => {
  await open("zh", "/management");
  expect(state.close).toHaveBeenCalledExactlyOnceWith(false);
  expect(state.navigate).not.toHaveBeenCalled();
});
it("leaves desktop sidebar state unchanged when following a link", async () => {
  state.mobile = false;
  await open("zh", "/reports");
  expect(state.close).not.toHaveBeenCalled();
  expect(state.navigate).toHaveBeenCalledExactlyOnceWith("/reports");
});
it.each(["zh", "fr"] as const)(
  "provides an explicit %s close button and menu title",
  async (locale) => {
    await act(async () => root.render(<AppSidebar locale={locale} userRole="admin" />));
    const label = locale === "zh" ? "关闭菜单" : "Fermer le menu";
    expect(container.querySelector("h2")?.textContent).toBe(
      locale === "zh" ? "主导航菜单" : "Menu de navigation",
    );
    const close = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(close).not.toBeNull();
    await act(async () => close!.click());
    expect(state.close).toHaveBeenCalledExactlyOnceWith(false);
  },
);
