import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), projects: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.create,
}));
import { decodeReportResult, loadReportData } from "@/features/reports/report-data";

const sacsi = "11111111-1111-4111-8111-111111111111";
const cimac = "22222222-2222-4222-8222-222222222222";
const projectRows = [
  { id: cimac, code: "CIMAC", display_name: "CIMAC" },
  { id: sacsi, code: "SACSI", display_name: "SACSI" },
];
const ledger = () => ({
  kind: "ledger",
  page: 1,
  pageSize: 50,
  total: 1,
  summary: { income: 100.25, expense: 30, liability_in: 1000, liability_out: 200 },
  rows: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      amount_xof: 100.25,
      direction: "income",
      category: "lease_rent",
      entry_date: "2026-10-19",
    },
  ],
});
const receivables = () => ({
  kind: "receivables",
  page: 1,
  pageSize: 50,
  total: 0,
  summary: { receivable: 0, paid: 0, outstanding: 0, overdue: 0 },
  rows: [],
});
function trend(endMonth = "2026-10") {
  const [year, month] = endMonth.split("-").map(Number);
  return Array.from({ length: 12 }, (_, index) => ({
    month: new Date(Date.UTC(year, month - 12 + index, 1)).toISOString().slice(0, 7),
    income: 100.25,
    expense: 30,
    net: 70.25,
  }));
}
beforeEach(() => {
  vi.clearAllMocks();
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: mocks.projects,
  };
  mocks.create.mockResolvedValue({ from: vi.fn(() => query), rpc: mocks.rpc });
  mocks.projects.mockResolvedValue({ data: projectRows, error: null });
  mocks.rpc.mockImplementation(async (name, args) => ({
    data:
      name === "reports_trend_rpc"
        ? trend(args.p_end_month.slice(0, 7))
        : args.p_kind === "ledger"
          ? ledger()
          : receivables(),
    error: null,
  }));
});
describe("financial checking server read", () => {
  it("selects authorized SACSI by default and transfers only a bounded current page", async () => {
    const data = await loadReportData({ month: "2026-10" });
    expect(data.query.projectId).toBe(sacsi);
    expect(data.result.rows).toHaveLength(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledWith("finance_read_rpc", {
      p_kind: "ledger",
      p_page: 1,
      p_filters: { projectId: sacsi, dateFrom: "2026-10-01", dateTo: "2026-10-31" },
    });
    expect(mocks.rpc).toHaveBeenCalledWith("reports_trend_rpc", {
      p_project_id: sacsi,
      p_end_month: "2026-10-01",
    });
    expect(data.exportHref).toContain(`projectId=${sacsi}`);
  });
  it("falls back only when no explicit project was requested", async () => {
    mocks.projects.mockResolvedValue({ data: [projectRows[0]], error: null });
    expect((await loadReportData({ month: "2026-10" })).query.projectId).toBe(cimac);
    mocks.rpc.mockClear();
    await expect(loadReportData({ projectId: sacsi })).rejects.toThrow(
      "ReportProjectPermissionDenied",
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not read trend or send ledger dates/direction in current receivables mode", async () => {
    const data = await loadReportData({
      kind: "receivables",
      month: "2025-02",
      projectId: cimac,
      management: "historical_pending",
      search: "503",
      outstandingOnly: "true",
      direction: "income",
    });
    expect(data.trend).toEqual([]);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("finance_read_rpc", {
      p_kind: "receivables",
      p_page: 1,
      p_filters: {
        projectId: cimac,
        management: "historical_pending",
        search: "503",
        outstandingOnly: "true",
      },
    });
  });
  it("rejects bad input before any database access", async () => {
    await expect(loadReportData({ month: "2026-13" })).rejects.toThrow();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([
    { data: null, error: { message: "database detail must not leak" } },
    { data: [], error: null },
  ])("fails closed without accessible projects", async (response) => {
    mocks.projects.mockResolvedValue(response);
    await expect(loadReportData()).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not replace a failed read or missing new RPC with zero figures", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    await expect(loadReportData()).rejects.toThrow("ReportReadUnavailable");
  });
  it("rejects a shifted trend period or contradictory net", async () => {
    mocks.rpc.mockImplementation(async (name) => ({
      data: name === "reports_trend_rpc" ? trend("2026-09") : ledger(),
      error: null,
    }));
    await expect(loadReportData({ month: "2026-10" })).rejects.toThrow("ReportTrendUnavailable");
    mocks.rpc.mockImplementation(async (name) => ({
      data: name === "reports_trend_rpc" ? trend().map((row) => ({ ...row, net: 0 })) : ledger(),
      error: null,
    }));
    await expect(loadReportData({ month: "2026-10" })).rejects.toThrow("ReportTrendUnavailable");
  });
  it("rejects results for another kind/page", async () => {
    mocks.rpc.mockImplementation(async (name) => ({
      data: name === "reports_trend_rpc" ? trend() : receivables(),
      error: null,
    }));
    await expect(loadReportData({ month: "2026-10" })).rejects.toThrow("ReportReadScopeMismatch");
  });
});
describe("report response contract", () => {
  it("refuses values outside the safe two-decimal financial range", () => {
    const value = ledger();
    value.summary.income = Number.MAX_SAFE_INTEGER;
    expect(() => decodeReportResult(value)).toThrow("ReportReadUnavailable");
  });

  it("preserves decimal ledger amounts and does not net deposits into income", () => {
    const value = ledger();
    expect(decodeReportResult(value)).toEqual(value);
    expect(value.summary.income - value.summary.expense).toBe(70.25);
  });
  it.each([
    null,
    {},
    { ...ledger(), total: -1 },
    { ...ledger(), pageSize: 100 },
    { ...ledger(), summary: { ...ledger().summary, income: NaN } },
  ])("rejects malformed results instead of rendering zero", (value) => {
    expect(() => decodeReportResult(value)).toThrow("ReportReadUnavailable");
  });
});
