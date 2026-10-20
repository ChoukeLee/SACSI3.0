// @vitest-environment jsdom
import React, { act, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app-shell";
import { useSidebar } from "@/components/ui/sidebar";

// SidebarProvider, Sidebar, Sheet, Portal, focus scope and Dialog are all real.
// Only host-specific routing, images, identity and viewport detection are mocked.
const navigation = vi.hoisted(() => ({
  pathname: "/management",
  navigate: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => true }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <img alt={alt} /> }));
vi.mock("next/link", () => ({
  default: React.forwardRef<
    HTMLAnchorElement,
    React.AnchorHTMLAttributes<HTMLAnchorElement> & {
      href: string;
      prefetch?: boolean;
      onNavigate?: (event: { preventDefault(): void }) => void;
    }
  >(function TestLink({ href, prefetch: _prefetch, onNavigate, onClick, children, ...props }, ref) {
    void _prefetch;
    return (
      <a
        {...props}
        href={href}
        ref={ref}
        onClick={(event) => {
          onClick?.(event);
          // Avoid jsdom's unrelated full-document navigation. Next's onNavigate
          // still runs so production's close-before-navigation handler is tested.
          event.preventDefault();
          onNavigate?.({ preventDefault: () => {} });
        }}
      >
        {children}
      </a>
    );
  }),
}));
vi.mock("@/components/navigation-transition-provider", () => ({
  NavigationTransitionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useNavigationTransition: () => ({
    pendingHref: null,
    isNavigating: false,
    startNavigation: navigation.navigate,
    clearNavigation: vi.fn(),
  }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: navigation.signOut } }),
}));

let host: HTMLDivElement;
let root: Root;
let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarning: ReturnType<typeof vi.spyOn>;

function CollapsedDesktopPreference() {
  const { state, setOpen } = useSidebar();
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setOpen(false);
  }, [setOpen]);
  return <output data-desktop-sidebar-state>{state}</output>;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // AppShell resets viewport scroll on route changes. jsdom has no layout.
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleWarning = vi.spyOn(console, "warn").mockImplementation(() => {});
  navigation.pathname = "/management";
  navigation.navigate.mockReset();
  navigation.signOut.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.cookie = "sidebar:state=; path=/; max-age=0";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function open(locale: "zh" | "fr" = "zh") {
  navigation.pathname = locale === "fr" ? "/fr/management" : "/management";
  await act(async () =>
    root.render(
      <AppShell locale={locale} userRole="admin">
        <CollapsedDesktopPreference />
      </AppShell>,
    ),
  );
  expect(host.querySelector("[data-desktop-sidebar-state]")?.textContent).toBe("collapsed");
  const trigger = host.querySelector<HTMLButtonElement>(
    `button[aria-label="${locale === "zh" ? "切换导航" : "Afficher ou masquer le menu"}"]`,
  );
  expect(trigger).not.toBeNull();
  trigger!.focus();
  await act(async () => trigger!.click());
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  expect(dialog).not.toBeNull();
  return { dialog: dialog!, trigger: trigger! };
}

function expectNoDialogAccessibilityWarning() {
  const messages = [...consoleError.mock.calls, ...consoleWarning.mock.calls].map((args) =>
    args.map(String).join(" "),
  );
  expect(
    messages.filter((message) =>
      /DialogTitle|DialogDescription|Missing.*Description|requires.*Title|aria-describedby/i.test(
        message,
      ),
    ),
  ).toEqual([]);
}

it.each(["zh", "fr"] as const)(
  "opens a named real Radix %s dialog even with a collapsed desktop preference",
  async (locale) => {
    const { dialog } = await open(locale);
    const titleId = dialog.getAttribute("aria-labelledby");
    expect(titleId).toBeTruthy();
    expect(document.getElementById(titleId!)?.textContent).toBe(
      locale === "zh" ? "主导航菜单" : "Menu de navigation",
    );
    expect(dialog.getAttribute("aria-describedby")).toBeNull();
    expectNoDialogAccessibilityWarning();
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(navigation.signOut).not.toHaveBeenCalled();
  },
);

it.each(["zh", "fr"] as const)(
  "closes the actual %s sheet and navigates normally when a business link is selected",
  async (locale) => {
    const { dialog } = await open(locale);
    const href = `${locale === "fr" ? "/fr" : ""}/reports`;
    const target = dialog.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
    expect(target).not.toBeNull();
    await act(async () => target!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(navigation.navigate).toHaveBeenCalledExactlyOnceWith(href);
    expectNoDialogAccessibilityWarning();
  },
);

it.each(["zh", "fr"] as const)(
  "closes the real %s sheet from its explicit close button",
  async (locale) => {
    const { dialog } = await open(locale);
    const close = dialog.querySelector<HTMLButtonElement>(
      `button[aria-label="${locale === "zh" ? "关闭菜单" : "Fermer le menu"}"]`,
    );
    expect(close).not.toBeNull();
    await act(async () => close!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(navigation.navigate).not.toHaveBeenCalled();
    expectNoDialogAccessibilityWarning();
  },
);

it("closes the actual Radix dialog with Escape without starting navigation", async () => {
  await open();
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(navigation.navigate).not.toHaveBeenCalled();
  expectNoDialogAccessibilityWarning();
});
