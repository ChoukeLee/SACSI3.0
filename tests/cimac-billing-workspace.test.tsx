import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { FinanceWorkbenchProps } from "@/features/finance/finance-workbench";
const mock = vi.hoisted(() => ({
  context: vi.fn(),
  customers: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/features/cimac/cimac-workspace-pages", () => ({
  getCimacWorkspaceContext: mock.context,
  CimacCustomersPage: mock.customers,
}));
vi.mock("@/lib/auth", () => ({
  hasPermission: (user: { role: string }) => ["admin", "finance"].includes(user.role),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mock }));
vi.mock("@/features/finance/finance-workbench", () => ({ FinanceWorkbench: () => null }));
import { FinanceWorkspace } from "@/features/finance/finance-workspace";
import { CimacFinancePage } from "@/features/finance/cimac-finance-page";

const project = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const building = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
beforeEach(() => {
  vi.clearAllMocks();
  mock.context.mockResolvedValue({ user: { id: other, role: "finance" } });
  mock.from.mockImplementation((table: string) => ({
    select: () => ({
      order: () => ({
        range: async () => ({
          data:
            table === "projects"
              ? [
                  { id: project, code: "CIMAC", display_name: "CIMAC" },
                  { id: other, code: "SACSI", display_name: "SACSI" },
                ]
              : [{ id: building, project_id: project, code: "B3", display_name: "3" }],
          error: null,
        }),
      }),
    }),
  }));
  mock.rpc.mockResolvedValue({
    data: {
      kind: "ledger",
      page: 1,
      pageSize: 50,
      total: 0,
      summary: { income: 0, expense: 0, liability_in: 0, liability_out: 0 },
      rows: [],
    },
    error: null,
  });
});
describe("independent CIMAC finance entry", () => {
  it("keeps customer accounts as default with financial views inside CIMAC", async () => {
    const page = await CimacFinancePage({ searchParams: Promise.resolve({}), locale: "zh" });
    expect(page.props.children[1].type).toBe(mock.customers);
    expect(page.props.children[1].props.accounts).toBe(true);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it.each(["ledger", "receivables"])(
    "locks %s content to CIMAC instead of mounting an old finance page",
    async (kind) => {
      const page = await CimacFinancePage({
        searchParams: Promise.resolve({ kind }),
        locale: "fr",
      });
      expect(page.type).toBe(FinanceWorkspace);
      expect(page.props.workArea).toBe("cimac");
      expect(page.props.locale).toBe("fr");
    },
  );
  it.each(["rental_sales", "front_desk"])("does not expose financial views to %s", async (role) => {
    mock.context.mockResolvedValue({ user: { role } });
    await expect(
      CimacFinancePage({ searchParams: Promise.resolve({ kind: "ledger" }), locale: "zh" }),
    ).rejects.toThrow("notFound");
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("keeps boss read-only", async () => {
    mock.context.mockResolvedValue({ user: { role: "boss" } });
    const page = await CimacFinancePage({
      searchParams: Promise.resolve({ kind: "ledger" }),
      locale: "zh",
    });
    expect(page.props.canWrite).toBe(false);
  });
  it("injects CIMAC before the financial RPC and sends no foreign project options to the browser", async () => {
    const page = (await FinanceWorkspace({
      params: { kind: "ledger" },
      locale: "zh",
      canWrite: true,
      workArea: "cimac",
    })) as ReactElement<FinanceWorkbenchProps>;
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("finance_read_rpc", {
      p_kind: "ledger",
      p_filters: { projectId: project },
      p_page: 1,
    });
    expect(page.props.projects.map((p) => p.id)).toEqual([project]);
    expect(page.props.buildings.map((b) => b.id)).toEqual([building]);
    expect(page.props.projectLocked).toBe(true);
  });
  it("rejects an explicit foreign project before any financial read", async () => {
    const page = (await FinanceWorkspace({
      params: { projectId: other },
      locale: "zh",
      canWrite: true,
      workArea: "cimac",
    })) as ReactElement<{ role: string }>;
    expect(page.props.role).toBe("alert");
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("does not run unscoped company checks in CIMAC or show false zero anomalies", async () => {
    const page = (await FinanceWorkspace({
      params: { view: "reconciliation" },
      locale: "zh",
      canWrite: true,
      workArea: "cimac",
    })) as ReactElement<FinanceWorkbenchProps>;
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(page.props.reconciliation).toEqual({ available: false, count: null, issues: [] });
    expect(page.props.reconciliationPending).toBe(true);
  });
});
