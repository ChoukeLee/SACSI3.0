import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { FinanceWorkbenchProps } from "@/features/finance/finance-workbench";
const mock = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mock.user }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mock.rpc }) }));
vi.mock("@/features/finance/finance-workbench", () => ({ FinanceWorkbench: () => null }));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`redirect:${href}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
import { CompanyReconciliationPage } from "@/features/finance/company-reconciliation-page";

beforeEach(() => {
  vi.clearAllMocks();
  mock.user.mockResolvedValue({ id: "actor", role: "finance" });
  mock.rpc.mockResolvedValue({ data: { count: 0, issues: [] }, error: null });
});
describe("explicit company-wide financial reconciliation", () => {
  it.each(["admin", "boss", "finance"])(
    "preserves the original company check for %s, separately from project summaries",
    async (role) => {
      mock.user.mockResolvedValue({ id: "actor", role });
      const page = (await CompanyReconciliationPage({
        locale: "zh",
      })) as ReactElement<FinanceWorkbenchProps>;
      expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("finance_reconciliation_rpc");
      expect(page.props.companyReconciliation).toBe(true);
      expect(page.props.projectLocked).not.toBe(true);
      expect(page.props.canWrite).toBe(false);
      expect(page.props.reconciliation).toEqual({ available: true, count: 0, issues: [] });
    },
  );
  it.each(["front_desk", "rental_sales"])(
    "does not broaden company financial access to %s",
    async (role) => {
      mock.user.mockResolvedValue({ role });
      await expect(CompanyReconciliationPage({ locale: "zh" })).rejects.toThrow("notFound");
      expect(mock.rpc).not.toHaveBeenCalled();
    },
  );
  it("requires verified login before the RPC", async () => {
    mock.user.mockResolvedValue(null);
    await expect(CompanyReconciliationPage({ locale: "fr" })).rejects.toThrow("redirect:/fr/login");
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("does not turn a failed check or malformed proof into zero issues", async () => {
    mock.rpc.mockResolvedValue({ data: { count: 5, issues: [] }, error: null });
    const page = (await CompanyReconciliationPage({
      locale: "fr",
    })) as ReactElement<FinanceWorkbenchProps>;
    expect(page.props.reconciliation).toEqual({ available: false, count: null, issues: [] });
    mock.rpc.mockRejectedValue(new Error("network"));
    const failed = (await CompanyReconciliationPage({
      locale: "fr",
    })) as ReactElement<FinanceWorkbenchProps>;
    expect(failed.props.reconciliation?.available).toBe(false);
    expect(failed.props.reconciliation?.count).toBeNull();
  });
});
