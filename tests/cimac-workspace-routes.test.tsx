import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  user: vi.fn(),
  client: { rpc: vi.fn(), from: vi.fn() },
  scope: vi.fn(),
  home: vi.fn(),
  customers: vi.fn(),
  customer: vi.fn(),
  assets: vi.fn(),
  asset: vi.fn(),
  account: vi.fn(),
  operationUnit: vi.fn(),
  profileRecords: vi.fn(),
  apartments: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  cache: <T,>(fn: T) => fn,
}));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`redirect:${href}`);
  },
  notFound: () => {
    throw new Error("not-found");
  },
}));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: deps.user,
  hasPermission: (user: { role: string }, permission: string) =>
    permission === "finance:write"
      ? ["admin", "finance"].includes(user.role)
      : permission === "customers:write"
        ? ["admin", "finance", "rental_sales"].includes(user.role)
        : permission === "leases:write"
          ? ["admin", "rental_sales"].includes(user.role)
          : user.role === "admin",
  homePathForRole: () => "/management",
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => deps.client }));
vi.mock("@/features/cimac/cimac-workspace-read", () => ({
  readCimacWorkspaceScope: deps.scope,
  readCimacHome: deps.home,
  readCimacCustomers: deps.customers,
  readCimacCustomer: deps.customer,
  readCimacAssets: deps.assets,
  readCimacAsset: deps.asset,
}));
vi.mock("@/features/finance/cimac-billing-read", () => ({
  readCimacCustomerAccount: deps.account,
}));
vi.mock("@/features/finance/cimac-account-lazy", () => ({ CimacAccountLazy: () => null }));
vi.mock("@/features/cimac/cimac-profile-service", () => ({
  readCimacOperationUnit: deps.operationUnit,
  readCimacProfileRecords: deps.profileRecords,
}));
vi.mock("@/features/cimac/cimac-profile-records", () => ({
  CimacProfileRecordSections: () => null,
}));
vi.mock("@/components/cimac-shell", () => ({ CimacShell: () => null }));
vi.mock("@/features/cimac/cimac-apartment-read", () => ({ readCimacApartments: deps.apartments }));
vi.mock("@/features/cimac/cimac-apartment-workbench", () => ({
  CimacApartmentWorkbench: () => null,
}));
vi.mock("@/features/cimac/cimac-home-view", () => ({ CimacHomeView: () => null }));
vi.mock("@/features/cimac/cimac-directory-view", () => ({
  CimacCustomerDirectoryView: () => null,
  CimacAssetDirectoryView: () => null,
}));
vi.mock("@/features/cimac/cimac-customer-view", () => ({ CimacCustomerView: () => null }));
vi.mock("@/features/cimac/cimac-asset-view", () => ({ CimacAssetView: () => null }));

import {
  canAccessCimacWorkspace,
  canReadCimacAccount,
  isCimacWorkspacePath,
} from "@/features/cimac/cimac-workspace-access";
import {
  CimacHomePage,
  CimacCustomersPage,
  CimacCustomerPage,
  CimacAssetsPage,
  CimacAssetPage,
  CimacWorkspaceLayout,
} from "@/features/cimac/cimac-workspace-pages";
import { CimacWorkspaceReadError } from "@/features/cimac/cimac-workspace-types";
import { safeWorkbenchReturnTo } from "@/lib/workbench-links";
import { CimacApartmentsPage } from "@/features/cimac/cimac-apartment-page";

const project = "11111111-1111-4111-8111-111111111111";
const customer = "22222222-2222-4222-8222-222222222222";
const scope = { project: { id: project, code: "CIMAC", displayName: "Test CIMAC" }, buildings: [] };
const props = (raw: Record<string, string | string[] | undefined> = {}) => ({
  searchParams: Promise.resolve(raw),
  locale: "zh" as const,
});
const detail = (raw: Record<string, string | string[] | undefined> = {}) => ({
  ...props(raw),
  params: Promise.resolve({ id: customer }),
});
const getProps = (element: ReactElement) => element.props as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  deps.user.mockResolvedValue({ id: "actor", role: "admin", displayName: "Test actor" });
  deps.scope.mockResolvedValue(scope);
  deps.home.mockResolvedValue({ scope });
  deps.apartments.mockResolvedValue({ registeredCount: 0, rooms: [], schemaAvailable: false });
  deps.customers.mockResolvedValue({ scope });
  deps.assets.mockResolvedValue({ scope });
  deps.asset.mockResolvedValue({ scope, asset: { id: customer } });
  deps.operationUnit.mockResolvedValue({ id: customer });
  deps.profileRecords.mockResolvedValue({ auditLogs: [], attachments: [] });
  deps.customer.mockResolvedValue({ scope, profile: { id: customer } });
  deps.account.mockResolvedValue({
    project: scope.project,
    selectedCustomerId: customer,
    canWrite: true,
  });
});

describe("CIMAC verified-auth route boundaries", () => {
  it.each(["admin", "boss", "finance", "rental_sales"])(
    "scopes apartment read and initializer for %s",
    async (role) => {
      deps.user.mockResolvedValue({ id: "actor", role, displayName: "viewer" });
      const page = await CimacApartmentsPage({
        ...props({ floor: "5", room: "516", tab: "room" }),
        locale: "fr",
      });
      expect(deps.apartments).toHaveBeenCalledExactlyOnceWith(deps.client, scope);
      expect(getProps(page)).toMatchObject({
        locale: "fr",
        initialQuery: { floor: 5, suffix: 16, tab: "room" },
        canInitialize: role === "admin",
      });
    },
  );
  it("rejects front desk and invalid apartment scope before querying", async () => {
    deps.user.mockResolvedValue({ id: "actor", role: "front_desk" });
    await expect(CimacApartmentsPage(props())).rejects.toThrow("not-found");
    deps.user.mockResolvedValue({ id: "actor", role: "admin" });
    await expect(CimacApartmentsPage(props({ project: "SACSI" }))).rejects.toThrow("not-found");
    expect(deps.apartments).not.toHaveBeenCalled();
  });
  it("separates denied apartment read from operational failure", async () => {
    deps.apartments.mockRejectedValue(new CimacWorkspaceReadError(403));
    await expect(CimacApartmentsPage(props())).rejects.toThrow("not-found");
    deps.apartments.mockRejectedValue(new CimacWorkspaceReadError(503));
    await expect(CimacApartmentsPage(props())).rejects.toThrow("CimacWorkspaceUnavailable");
  });
  it.each(["admin", "finance", "rental_sales", "boss"])(
    "passes create capability to the customer directory according to %s permissions",
    async (role) => {
      deps.user.mockResolvedValue({ id: "actor", role, displayName: "viewer" });
      const page = await CimacCustomersPage(props());
      expect(getProps(page).canEdit).toBe(role !== "boss");
      expect(getProps(page).canCreateContract).toBe(["admin", "rental_sales"].includes(role));
      expect(deps.account).not.toHaveBeenCalled();
    },
  );
  it.each([CimacHomePage, CimacCustomersPage, CimacAssetsPage, CimacApartmentsPage])(
    "rejects logged-out directories before querying",
    async (page) => {
      deps.user.mockResolvedValue(null);
      await expect(page(props())).rejects.toThrow("redirect:/login");
      expect(deps.scope).not.toHaveBeenCalled();
    },
  );
  it("guards the shell and does not grant front desk access", async () => {
    deps.user.mockResolvedValue({ role: "front_desk" });
    await expect(CimacWorkspaceLayout({ locale: "zh", children: null })).rejects.toThrow(
      "not-found",
    );
    expect(deps.scope).not.toHaveBeenCalled();
  });
  it("does not substitute another visible project when CIMAC is denied", async () => {
    deps.scope.mockRejectedValue(new CimacWorkspaceReadError(403));
    await expect(CimacHomePage(props())).rejects.toThrow("not-found");
    expect(deps.home).not.toHaveBeenCalled();
  });
  it("does not show a zero page on an operational read failure", async () => {
    deps.home.mockRejectedValue(new CimacWorkspaceReadError(503));
    await expect(CimacHomePage(props())).rejects.toThrow("CimacWorkspaceUnavailable");
  });
  it.each([
    { project: "33333333-3333-4333-8333-333333333333" },
    { project: ["CIMAC", project] },
    { building: customer },
    { token: "not-allowed" },
  ])("rejects ambiguous or mismatched home parameters %j", async (raw) => {
    await expect(CimacHomePage(props(raw))).rejects.toThrow("not-found");
    expect(deps.home).not.toHaveBeenCalled();
  });
  it("requires a CIMAC customer before reading its account", async () => {
    deps.customer.mockRejectedValue(new CimacWorkspaceReadError(404));
    await expect(CimacCustomerPage(detail({ tab: "account" }))).rejects.toThrow("not-found");
    expect(deps.account).not.toHaveBeenCalled();
  });
  it.each(["overview", "contracts", "records"])(
    "does not preload financial history on %s",
    async (tab) => {
      await CimacCustomerPage(detail({ tab }));
      expect(deps.account).not.toHaveBeenCalled();
    },
  );
  it("does not load any account while reading home, asset or customer lists", async () => {
    await CimacHomePage(props());
    await CimacAssetsPage(props());
    await CimacAssetPage(detail());
    await CimacCustomersPage(props());
    expect(deps.account).not.toHaveBeenCalled();
    expect(deps.profileRecords).not.toHaveBeenCalled();
  });
  it("loads project-attributed profile documents only on records without preloading finance", async () => {
    await CimacCustomerPage(detail({ tab: "records" }));
    expect(deps.profileRecords).toHaveBeenCalledExactlyOnceWith(deps.client, scope, {
      type: "customer",
      id: customer,
    });
    await CimacAssetPage(detail({ tab: "records" }));
    expect(deps.profileRecords).toHaveBeenLastCalledWith(deps.client, scope, {
      type: "unit",
      id: customer,
    });
    expect(deps.account).not.toHaveBeenCalled();
  });
  it("keeps rental-sales customer access but excludes account capabilities", async () => {
    deps.user.mockResolvedValue({ id: "actor", role: "rental_sales" });
    const page = await CimacCustomerPage(detail());
    expect(getProps(page).canReadAccount).toBe(false);
    expect(getProps(await CimacAssetPage(detail())).canReadAccount).toBe(false);
    await expect(CimacCustomerPage(detail({ tab: "account" }))).rejects.toThrow("not-found");
    await expect(CimacCustomersPage({ ...props(), accounts: true })).rejects.toThrow("not-found");
    expect(deps.account).not.toHaveBeenCalled();
  });
  it.each(["admin", "finance", "boss"])(
    "retains existing account permissions for %s",
    async (role) => {
      deps.user.mockResolvedValue({ id: "actor", role });
      const page = await CimacCustomerPage({
        ...detail({ tab: "account", accountTab: "receipts", returnTo: "/fr/cimac/finance" }),
        locale: "fr",
      });
      expect(deps.account).toHaveBeenCalledWith(deps.client, {
        customerId: customer,
        customerPage: 1,
        search: "",
        tab: "receipts",
      });
      const account = getProps(page).accountSection as ReactElement;
      expect(getProps(account)).toMatchObject({
        viewerId: "actor",
        canWrite: role !== "boss",
        baseHref: `/fr/cimac/customers/${customer}`,
        returnTo: "/fr/cimac/finance",
      });
    },
  );
  it("does not mount a write form when the account returns the wrong project", async () => {
    deps.account.mockResolvedValue({ project: { id: customer }, selectedCustomerId: customer });
    const page = await CimacCustomerPage(detail({ tab: "account" }));
    const account = getProps(page).accountSection as ReactElement;
    expect(getProps(account).role).toBe("alert");
    expect(getProps(account)).not.toHaveProperty("canWrite");
  });
  it.each(["zh", "fr"] as const)(
    "keeps the %s account failure fallback inside the park workspace",
    async (locale) => {
      deps.account.mockRejectedValue(new Error("read unavailable"));
      const page = await CimacCustomerPage({ ...detail({ tab: "account" }), locale });
      const account = getProps(page).accountSection as ReactElement;
      const children = getProps(account).children as ReactElement[];
      const fallback = children.find((child) => typeof getProps(child).href === "string");
      expect(fallback).toBeDefined();
      expect(getProps(fallback!).href).toBe(
        `${locale === "fr" ? "/fr" : ""}/cimac/finance?kind=ledger&projectId=${project}`,
      );
    },
  );
});

describe("CIMAC shell and legacy return contract", () => {
  it.each([
    "/cimac",
    "/cimac/customers",
    "/fr/cimac/assets",
    `/fr/cimac/customers/${customer}?tab=account&accountTab=receipts`,
    "/cimac/finance",
  ])("preserves exact safe workspace return %s", (path) => {
    expect(safeWorkbenchReturnTo(path)).toBe(path);
    expect(isCimacWorkspacePath(path.split("?")[0])).toBe(true);
  });
  it.each([
    "/cimac-evil",
    "/cimac/api",
    "/cimac/customers/not-id",
    `/cimac/customers/${customer}/delete`,
    "/cimac?token=secret",
    "//evil.invalid/cimac",
  ])("does not broaden legacy redirects to %s", (path) => {
    expect(safeWorkbenchReturnTo(path)).toBeNull();
  });
  it("strips nested returns without removing the account tab", () => {
    expect(
      safeWorkbenchReturnTo(`/cimac/customers/${customer}?tab=account&returnTo=%2Fcimac`),
    ).toBe(`/cimac/customers/${customer}?tab=account`);
  });
  it.each([undefined, "front_desk"] as const)(
    "does not show a workspace/account entry to %s",
    (role) => {
      expect(canAccessCimacWorkspace(role)).toBe(false);
      expect(canReadCimacAccount(role)).toBe(false);
    },
  );
  it("does not claim that rental sales can read finance", () => {
    expect(canAccessCimacWorkspace("rental_sales")).toBe(true);
    expect(canReadCimacAccount("rental_sales")).toBe(false);
  });
});
