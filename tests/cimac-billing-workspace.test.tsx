import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), cimac: true, write: true }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mock }));
vi.mock("@/features/finance/cimac-customer-workbench", () => ({
  CimacCustomerWorkbench: () => null,
}));
vi.mock("@/features/finance/finance-workbench", () => ({ FinanceWorkbench: () => null }));
import { FinanceWorkspace } from "@/features/finance/finance-workspace";

const project = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actor = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function empty() {
  return {
    project: { id: project, code: "CIMAC", display_name: "CIMAC" },
    canWrite: mock.write,
    complete: true,
    customerPage: { rows: [], total: 0, page: 1, pageSize: 50 },
    selectedCustomerId: null,
    customer: null,
    units: [],
    contracts: [],
    receivables: [],
    payments: [],
    allocations: [],
    feeTerms: [],
    meterReadings: [],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.cimac = true;
  mock.write = true;
  mock.from.mockImplementation((table: string) => ({
    select: () => ({
      order: () => ({
        range: async () => ({
          data:
            table === "projects"
              ? [{ id: project, code: mock.cimac ? "CIMAC" : "OTHER", display_name: "Project" }]
              : [],
          error: null,
        }),
      }),
    }),
  }));
  mock.rpc.mockImplementation(async (name: string) => ({
    data:
      name === "cimac_customer_account_rpc"
        ? empty()
        : {
            kind: "ledger",
            page: 1,
            pageSize: 50,
            total: 0,
            summary: { income: 0, expense: 0, liability_in: 0, liability_out: 0 },
            rows: [],
          },
    error: null,
  }));
});
async function load(params: Record<string, string | undefined> = {}, canWrite = true) {
  return (await FinanceWorkspace({
    params,
    locale: "zh",
    canWrite,
    viewerId: actor,
  })) as ReactElement<Record<string, unknown>>;
}
describe("approved CIMAC customer workspace entry", () => {
  it("uses the customer account by default for a verified CIMAC account", async () => {
    const result = await load();
    expect(result.props.viewerId).toBe(actor);
    expect(result.props.canWrite).toBe(true);
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("cimac_customer_account_rpc", {
      p_customer_id: null,
      p_search: null,
      p_page: 1,
    });
    expect(mock.from.mock.calls.map((c) => c[0])).toEqual(["buildings", "projects"]);
  });
  it.each([
    [false, true],
    [true, false],
  ])("requires both page and database write permission", async (pageWrite, dbWrite) => {
    mock.write = dbWrite;
    const result = await load({}, pageWrite);
    expect(result.props.canWrite).toBe(false);
  });
  it("keeps the established generic ledger default without CIMAC access", async () => {
    mock.cimac = false;
    const result = await load();
    expect(result.props.mode).toBe("ledger");
    expect(mock.rpc.mock.calls[0][0]).toBe("finance_read_rpc");
  });
  it("keeps explicit generic ledger links even when CIMAC is authorized", async () => {
    const result = await load({ kind: "ledger" });
    expect(result.props.mode).toBe("ledger");
    expect(mock.rpc.mock.calls[0][0]).toBe("finance_read_rpc");
  });
  it("shows an unavailable state rather than an empty account if the customer read fails", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    const result = await load();
    expect(result.props.role).toBe("alert");
    expect(result.props.data).toBeUndefined();
  });
  it("does not reinterpret a foreign project as the CIMAC scope", async () => {
    const result = await load({ view: "customers", projectId: actor });
    expect(result.props.role).toBe("alert");
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
