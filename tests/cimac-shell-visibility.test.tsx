// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AnchorHTMLAttributes, ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CimacShell } from "@/components/cimac-shell";
import { CimacWorkspaceFeedback } from "@/components/cimac-workspace-feedback";
import CimacLoading from "@/app/cimac/loading";
import { CimacHomeView } from "@/features/cimac/cimac-home-view";
import { CimacCustomerView } from "@/features/cimac/cimac-customer-view";
import { CimacAssetView } from "@/features/cimac/cimac-asset-view";
import { cimacAssetCounts } from "@/features/cimac/cimac-workspace-model";
import { parseCimacWorkspaceQuery } from "@/features/cimac/cimac-workspace-query";
import type {
  CimacAssetSummary,
  CimacWorkspaceScope,
} from "@/features/cimac/cimac-workspace-types";

const navigation = vi.hoisted(() => ({ pathname: "/cimac" }));
// This suite checks the real shell + stylesheet, not server-action or form behavior.
vi.mock("@/features/cimac/cimac-profile-operations", () => ({
  CimacCustomerProfileOperation: () => null,
  CimacAssetConditionOperation: () => null,
  CimacCustomerCreateOperation: () => null,
}));
vi.mock("@/features/cimac/cimac-customer-management", () => ({
  CimacCustomerManagement: () => null,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({
    prefetch: _prefetch,
    onNavigate: _onNavigate,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean; onNavigate?: () => void }) => (
    <a {...props} />
  ),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: vi.fn() } }),
}));

const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope: CimacWorkspaceScope = {
  project: { id: id(1), code: "CIMAC", displayName: "测试建材城" },
  buildings: [
    { id: id(2), code: "B1", name: "商业区B1栋", constructionStatus: null, isActive: true },
  ],
};
const asset: CimacAssetSummary = {
  id: id(3),
  code: "CIMAC-B1-101",
  unitNo: "101",
  kind: "storefront",
  assetSubtype: null,
  buildingId: id(2),
  buildingName: "商业区B1栋",
  buildingCode: "B1",
  floorLabel: "G",
  areaSqm: null,
  updatedAt: null,
  constructionStatus: null,
  occupancyVerified: null,
  position: null,
  attentionReasons: ["construction_unverified", "occupancy_unverified"],
  handover: { status: "unknown", date: null },
  opening: { status: "unknown", date: null },
};
const summary = {
  id: id(4),
  name: "测试商户",
  phone: null,
  isBlacklisted: false,
  hasDocument: false,
  roles: ["lease" as const],
  rooms: ["B1-101"],
  roomCount: 1,
  relationshipCount: 1,
  lastBusinessDate: null,
};

function pageChild(kind: string, locale: "zh" | "fr"): ReactElement {
  if (kind === "home")
    return (
      <CimacHomeView
        locale={locale}
        data={{
          scope,
          assetSummary: cimacAssetCounts([asset]),
          customerCount: 1,
          attention: [asset],
          attentionTotal: 1,
          assetIndex: [asset],
          readAt: "2026-10-25T00:00:00Z",
        }}
      />
    );
  if (kind === "customer")
    return (
      <CimacCustomerView
        locale={locale}
        data={{
          scope,
          summary,
          profile: {
            id: id(4),
            name: summary.name,
            gender: null,
            document_type: null,
            phone: null,
            notes: null,
            is_blacklisted: false,
            blacklist_reason: null,
            blacklist_operator_id: null,
            blacklist_date: null,
            blacklist_permanent: false,
            created_at: "2026-10-25T00:00:00Z",
            updated_at: "2026-10-25T00:00:00Z",
            hasDocument: false,
          },
          relations: [],
          relationPage: 1,
          relationTotal: 0,
          pageSize: 25,
          query: parseCimacWorkspaceQuery({}, "customers"),
        }}
      />
    );
  if (kind === "asset")
    return (
      <CimacAssetView
        locale={locale}
        data={{
          scope,
          asset,
          relations: [],
          relationPage: 1,
          relationTotal: 0,
          pageSize: 30,
          query: parseCimacWorkspaceQuery(),
        }}
      />
    );
  if (kind === "loading") return <CimacLoading />;
  return <CimacWorkspaceFeedback />;
}

function renderShell(children: ReactNode, locale: "zh" | "fr") {
  document.body.innerHTML = renderToStaticMarkup(
    <CimacShell
      locale={locale}
      projectId={id(1)}
      displayName="测试操作人"
      role="admin"
      sacsiHref={locale === "fr" ? "/fr/management" : "/management"}
    >
      {children}
    </CimacShell>,
  );
  return document.querySelector<HTMLElement>("main[data-cimac-main]")!;
}

// Use the real stylesheet rules, not a copied or weakened substitute. These
// rules previously hid every CIMAC page despite a successful HTML response.
const globalCss = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const visibilityRules = globalCss.match(/\[data-app-main\]\s*>\s*[^{}]+\{[^{}]*\}/g) ?? [];
let style: HTMLStyleElement;
beforeEach(() => {
  style = document.createElement("style");
  style.textContent = visibilityRules.join("\n");
  document.head.append(style);
});
afterEach(() => {
  style.remove();
  document.body.innerHTML = "";
});

function expectDisplayedThroughMain(element: HTMLElement, main: HTMLElement) {
  let current: HTMLElement | null = element;
  while (current) {
    const computed = getComputedStyle(current);
    expect(computed.display, `${current.tagName} must not be display:none`).not.toBe("none");
    expect(computed.visibility, `${current.tagName} must be visible`).toBe("visible");
    if (current === main) return;
    current = current.parentElement;
  }
  throw new Error("Expected content must belong to the real shell main");
}

describe("CIMAC shell visibility under global route isolation CSS", () => {
  it("loads all three authoritative main-child isolation rules", () => {
    expect(visibilityRules).toHaveLength(3);
    expect(style.textContent).toContain(":not([data-current-route-root])");
    expect(style.textContent).toContain(":has(~ [data-route-root])");
    expect(style.textContent).toContain(":not([data-route-root]):not([data-navigation-overlay])");
  });

  it.each(["zh", "fr"] as const)(
    "keeps the old unwrapped shape hidden as a %s negative control",
    (locale) => {
      document.body.innerHTML = `<main data-app-main data-cimac-main>${renderToStaticMarkup(pageChild("home", locale))}</main>`;
      const child = document.querySelector<HTMLElement>("main > div")!;
      expect(child.hasAttribute("data-route-root")).toBe(false);
      expect(getComputedStyle(child).display).toBe("none");
      expect(getComputedStyle(child).visibility).toBe("hidden");
    },
  );

  it.each(
    (["zh", "fr"] as const).flatMap((locale) =>
      ["home", "customer", "asset", "loading", "error"].map((kind) => ({ locale, kind })),
    ),
  )(
    "renders $locale $kind content visibly inside the current route wrapper",
    ({ locale, kind }) => {
      const prefix = locale === "fr" ? "/fr" : "";
      navigation.pathname = `${prefix}/cimac${kind === "customer" ? `/customers/${id(4)}` : kind === "asset" ? `/assets/${id(3)}` : ""}`;
      const main = renderShell(pageChild(kind, locale), locale);
      expect(main).not.toBeNull();
      const wrapper = main.firstElementChild as HTMLElement;
      expect(wrapper.getAttribute("data-route-root")).toBe(navigation.pathname);
      expect(wrapper.hasAttribute("data-current-route-root")).toBe(true);
      expect(getComputedStyle(wrapper).display).toBe("block");
      expect(getComputedStyle(wrapper).visibility).toBe("visible");
      const child = wrapper.firstElementChild as HTMLElement;
      expect(child).not.toBeNull();
      expect(getComputedStyle(child).display).toBe("block");
      expectDisplayedThroughMain(child, main);
      const content =
        kind === "loading"
          ? wrapper.querySelector<HTMLElement>("[role=status]")
          : wrapper.querySelector<HTMLElement>("h1");
      expect(content).not.toBeNull();
      expectDisplayedThroughMain(content!, main);
      expect(main.querySelectorAll("[data-current-route-root]")).toHaveLength(1);
      expect(main.querySelectorAll("[data-app-main]")).toHaveLength(0);
    },
  );
});
