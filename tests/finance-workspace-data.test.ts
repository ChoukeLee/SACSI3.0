import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { FinanceWorkbenchProps } from "@/features/finance/finance-workbench";
const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), metadataError: false }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mock }));
vi.mock("@/features/finance/finance-workbench", () => ({ FinanceWorkbench: () => null }));
vi.mock("@/features/finance/cimac-customer-workbench", () => ({
  CimacCustomerWorkbench: () => null,
}));
import { FinanceWorkspace } from "@/features/finance/finance-workspace";
const project = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  building = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  other = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const report = {
  kind: "ledger",
  page: 1,
  pageSize: 50,
  total: 0,
  summary: { income: 0, expense: 0, liability_in: 0, liability_out: 0 },
  rows: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  mock.metadataError = false;
  mock.from.mockImplementation((table: string) => ({
    select: () => ({
      order: () => ({
        range: async () => ({
          data: mock.metadataError
            ? null
            : table === "projects"
              ? [
                  { id: project, code: "SACSI", display_name: "SACSI" },
                  { id: other, code: "CIMAC", display_name: "CIMAC" },
                ]
              : [{ id: building, project_id: project, code: "B3", display_name: "3" }],
          error: mock.metadataError ? { message: "unavailable" } : null,
        }),
      }),
    }),
  }));
  mock.rpc.mockImplementation(async (name: string) => ({
    data: name === "finance_read_rpc" ? structuredClone(report) : { count: 0, issues: [] },
    error: null,
  }));
});
async function load(
  params: Record<string, string | undefined> = { kind: "ledger" },
  canWrite = true,
) {
  return (await FinanceWorkspace({
    params,
    locale: "zh",
    canWrite,
  })) as ReactElement<FinanceWorkbenchProps>;
}
describe("finance server read path", () => {
  it.each([true, false])(
    "explicit ledger does not fetch all units or run a reconciliation scan, write=%s",
    async (canWrite) => {
      const page = await load({ kind: "ledger" }, canWrite);
      expect(mock.from.mock.calls.map((c) => c[0])).toEqual(["buildings", "projects"]);
      expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("finance_read_rpc", {
        p_kind: "ledger",
        p_filters: { projectId: project },
        p_page: 1,
      });
      expect(page.props.result?.total).toBe(0);
      expect(page.props.canWrite).toBe(canWrite);
    },
  );
  it("keeps exact complete filters and page on the established RPC", async () => {
    mock.rpc.mockResolvedValue({ data: { ...report, page: 2 }, error: null });
    const page = await load({
      projectId: project,
      buildingId: building,
      search: "说明",
      dateFrom: "2026-10-01",
      direction: "income",
      page: "2",
    });
    expect(mock.rpc.mock.calls[0][1]).toEqual({
      p_kind: "ledger",
      p_filters: {
        projectId: project,
        buildingId: building,
        search: "说明",
        dateFrom: "2026-10-01",
        direction: "income",
      },
      p_page: 2,
    });
    expect(page.props.scopeKey).toContain("说明");
  });
  it("does not mix company-wide reconciliation into a project workspace", async () => {
    const page = await load({ view: "reconciliation" });
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(page.props.result).toBeNull();
    expect(page.props.reconciliation).toEqual({ available: false, count: null, issues: [] });
  });
  it("isolate reconciliation errors without converting failure into zero issues", async () => {
    mock.rpc.mockRejectedValue(new Error("network"));
    const page = await load({ view: "reconciliation" });
    expect(page.props.reconciliation).toEqual({ available: false, count: null, issues: [] });
  });
  it("never converts unavailable main ledger data into a healthy empty table", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { message: "bad" } });
    await expect(load()).rejects.toThrow("FinanceReadUnavailable");
  });
  it("requires complete metadata, not a truncated empty scope on errors", async () => {
    mock.metadataError = true;
    await expect(load()).rejects.toThrow("Failed to fetch");
  });
  it.each([
    { projectId: other },
    { buildingId: other },
    { projectId: other, buildingId: building },
  ])("rejects missing or inaccessible explicit scope %s", async (params) => {
    const page = await load(params);
    expect((page.props as unknown as { role: string }).role).toBe("alert");
    expect(page.props.result).toBeUndefined();
  });
  it("rejects a building that belongs to another project without showing a zero all-project summary", async () => {
    mock.from.mockImplementation((table: string) => ({
      select: () => ({
        order: () => ({
          range: async () => ({
            data:
              table === "projects"
                ? [
                    { id: project, code: "SACSI", display_name: "A" },
                    { id: other, code: "CIMAC", display_name: "B" },
                  ]
                : [{ id: building, project_id: other, code: "B", display_name: "B" }],
            error: null,
          }),
        }),
      }),
    }));
    const page = await load({ projectId: project, buildingId: building });
    expect((page.props as unknown as { role: string }).role).toBe("alert");
  });
});
