import type { ReactElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const deps = vi.hoisted(() => ({
  context: vi.fn(),
  load: vi.fn(),
  from: vi.fn(),
  single: vi.fn(),
}));
vi.mock("@/features/cimac/cimac-workspace-pages", () => ({
  getCimacWorkspaceContext: deps.context,
}));
vi.mock("@/features/leases/lease-workspace-data", () => ({ loadLeaseWorkspace: deps.load }));
vi.mock("@/features/leases/lease-lazy-view", () => ({ LeaseLazyView: () => null }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
}));
import { CimacContractsPage } from "@/features/leases/cimac-contract-page";
import {
  workspaceFixture,
  workspaceProject,
  workspaceBuilding,
  workspaceCustomer,
} from "./fixtures/contract-workspace";
beforeEach(() => {
  vi.clearAllMocks();
  deps.context.mockResolvedValue({
    user: { id: "actor", role: "admin" },
    scope: { project: { id: workspaceProject }, buildings: [{ id: workspaceBuilding }] },
    client: { from: deps.from },
  });
  deps.from.mockReturnValue({
    select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: deps.single })) })),
  });
  deps.single.mockResolvedValue({
    data: { id: workspaceCustomer, name: "Shared pre-contract customer" },
    error: null,
  });
  deps.load.mockResolvedValue(workspaceFixture());
});
async function content(locale: "zh" | "fr", role: string) {
  deps.context.mockResolvedValue({
    user: { id: "actor", role },
    scope: { project: { id: workspaceProject }, buildings: [{ id: workspaceBuilding }] },
  });
  const page = await CimacContractsPage({
    locale,
    searchParams: Promise.resolve({ building: workspaceBuilding }),
  });
  const child = (page as ReactElement<{ children: ReactElement<Record<string, unknown>> }>).props
    .children;
  return (
    child.type as (props: Record<string, unknown>) => Promise<ReactElement<Record<string, unknown>>>
  )(child.props);
}
it.each(["zh", "fr"] as const)(
  "keeps %s contract data and subsequent client navigation fixed to the authenticated park",
  async (locale) => {
    const result = await content(locale, "admin");
    expect(deps.load).toHaveBeenCalledWith(
      locale,
      workspaceProject,
      "actor",
      workspaceBuilding,
      "cimac",
    );
    expect(result.props).toMatchObject({
      workArea: "cimac",
      initialProject: workspaceProject,
      canCreate: true,
      canRecordFinance: true,
      canCorrectRentPeriod: true,
    });
  },
);
it.each(["boss", "rental_sales", "finance"])(
  "preserves the %s role's existing mutation boundaries",
  async (role) => {
    const result = await content("zh", role);
    expect(result.props.canCreate).toBe(role === "rental_sales");
    expect(result.props.canActivate).toBe(role === "rental_sales");
    expect(result.props.canRecordFinance).toBe(role === "finance");
    expect(result.props.canMoveOut).toBe(role === "finance");
    expect(result.props.canCorrectRentPeriod).toBe(false);
  },
);
it.each([
  { project: "SACSI" },
  { building: "unknown" },
  { project: ["CIMAC", "SACSI"] },
  { unexpected: "value" },
  { customer: "not-an-id" },
  { customer: "" },
  { customer: [workspaceCustomer, workspaceCustomer] },
  { customer: workspaceCustomer, contract: "33333333-3333-4333-8333-333333333333" },
])("refuses foreign or malformed park route input %j", async (params) => {
  await expect(
    CimacContractsPage({ locale: "zh", searchParams: Promise.resolve(params) }),
  ).rejects.toThrow("not-found");
  expect(deps.load).not.toHaveBeenCalled();
});
it.each(["zh", "fr"] as const)(
  "verifies a visible shared customer for %s without demanding an existing park contract",
  async (locale) => {
    const page = await CimacContractsPage({
      locale,
      searchParams: Promise.resolve({ customer: workspaceCustomer }),
    });
    const child = (page as ReactElement<{ children: ReactElement<Record<string, unknown>> }>).props
      .children;
    const result = await (
      child.type as (
        props: Record<string, unknown>,
      ) => Promise<ReactElement<Record<string, unknown>>>
    )(child.props);
    expect(deps.from).toHaveBeenCalledExactlyOnceWith("customers");
    expect(result.props).toMatchObject({
      workArea: "cimac",
      initialCustomer: workspaceCustomer,
      initialCustomerName: "Shared pre-contract customer",
      initialProject: workspaceProject,
    });
    expect(result.props).not.toHaveProperty("automaticSubmit");
  },
);
it.each(["boss"])("does not turn a %s read role into a new-contract intent", async (role) => {
  deps.context.mockResolvedValue({
    user: { id: "actor", role },
    scope: { project: { id: workspaceProject }, buildings: [] },
    client: { from: deps.from },
  });
  await expect(
    CimacContractsPage({
      locale: "zh",
      searchParams: Promise.resolve({ customer: workspaceCustomer }),
    }),
  ).rejects.toThrow("not-found");
  expect(deps.from).not.toHaveBeenCalled();
});
it("allows finance to hand off a visible shared customer without gaining contract-write capabilities", async () => {
  deps.context.mockResolvedValue({
    user: { id: "actor", role: "finance" },
    scope: { project: { id: workspaceProject }, buildings: [] },
    client: { from: deps.from },
  });
  const page = await CimacContractsPage({
    locale: "zh",
    searchParams: Promise.resolve({ customer: workspaceCustomer }),
  });
  const child = (page as ReactElement<{ children: ReactElement<Record<string, unknown>> }>).props
    .children;
  const result = await (
    child.type as (props: Record<string, unknown>) => Promise<ReactElement<Record<string, unknown>>>
  )(child.props);
  expect(result.props).toMatchObject({
    initialCustomer: workspaceCustomer,
    canCreate: false,
    canActivate: false,
    canRecordFinance: true,
  });
});
it("rejects a missing shared identity and does not substitute an existing park customer", async () => {
  deps.single.mockResolvedValue({ data: null, error: null });
  await expect(
    CimacContractsPage({
      locale: "zh",
      searchParams: Promise.resolve({ customer: workspaceCustomer }),
    }),
  ).rejects.toThrow("not-found");
  expect(deps.load).not.toHaveBeenCalled();
});
it("fails closed when RLS visibility cannot be checked", async () => {
  deps.single.mockResolvedValue({ data: null, error: { message: "offline" } });
  await expect(
    CimacContractsPage({
      locale: "zh",
      searchParams: Promise.resolve({ customer: workspaceCustomer }),
    }),
  ).rejects.toThrow("CimacContractCustomerUnavailable");
  expect(deps.load).not.toHaveBeenCalled();
});
