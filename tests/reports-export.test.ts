import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn(), project: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  getCurrentUser: mocks.user,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc: mocks.rpc, from: mocks.from })),
}));

import { GET } from "@/app/api/reports/export/route";
import { reportCsv } from "@/features/reports/report-read";
import type { FinanceReadResult } from "@/features/finance/finance-read";

const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const entryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const paymentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const summary = { income: 100, expense: 20, liability_in: 30, liability_out: 10 };
const ledgerRow = {
  id: entryId,
  payment_id: paymentId,
  entry_date: "2026-10-18",
  building_label: "Synthetic building",
  unit_label: "408",
  direction: "income",
  category: "lease_rent",
  amount_xof: 100,
  amount_cny: null,
  description: "Explicit receipt",
};
const ledger = (overrides: Partial<FinanceReadResult> = {}): FinanceReadResult => ({
  kind: "ledger",
  page: 1,
  pageSize: 50,
  total: 1,
  rows: [ledgerRow],
  summary,
  ...overrides,
});
const request = (extra = "") =>
  new Request(
    `https://sacsi.example/api/reports/export?projectId=${projectId}&month=2026-10${extra}`,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
  mocks.user.mockResolvedValue({ id: entryId, role: "admin" });
  mocks.project.mockResolvedValue({ data: { id: projectId }, error: null });
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: mocks.project,
  };
  mocks.from.mockReturnValue(builder);
  mocks.rpc.mockResolvedValue({ data: ledger(), error: null });
});

afterEach(() => vi.useRealTimers());

describe("financial checking complete export", () => {
  it("denies anonymous and operational roles before any financial query", async () => {
    for (const user of [null, { role: "front_desk" }, { role: "rental_sales" }]) {
      mocks.user.mockResolvedValue(user);
      expect((await GET(request())).status).toBe(403);
    }
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["admin", "finance", "boss"])(
    "allows %s to export scoped read-only data",
    async (role) => {
      mocks.user.mockResolvedValue({ role });
      const response = await GET(request("&page=8&search=408&direction=income"));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect(response.headers.get("content-disposition")).toContain("ledger-2026-10.csv");
      expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("finance_read_rpc", {
        p_kind: "ledger",
        p_filters: {
          projectId,
          dateFrom: "2026-10-01",
          dateTo: "2026-10-31",
          search: "408",
          direction: "income",
        },
        p_page: 1,
        p_export: true,
      });
      expect(await response.text()).toContain("长租租金");
    },
  );

  it.each([
    "https://sacsi.example/api/reports/export",
    `https://sacsi.example/api/reports/export?projectId=${projectId}&projectId=${projectId}`,
    `https://sacsi.example/api/reports/export?projectId=${projectId}&kind=cash`,
    `https://sacsi.example/api/reports/export?projectId=${projectId}&month=2026-13`,
    `https://sacsi.example/api/reports/export?projectId=${projectId}&locale=en`,
    `https://sacsi.example/api/reports/export?projectId=${projectId}&ignored=1&ignored=2`,
  ])("rejects missing or ambiguous filters before querying: %s", async (url) => {
    expect((await GET(new Request(url))).status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not fall back to another project when the requested project is invisible", async () => {
    mocks.project.mockResolvedValue({ data: null, error: null });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps RLS permission rejection distinct from backend unavailability", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Private SQL" } });
    expect((await GET(request())).status).toBe(403);
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Private SQL" } });
    const failure = await GET(request());
    expect(failure.status).toBe(503);
    expect(await failure.text()).not.toContain("Private SQL");
    mocks.project.mockResolvedValue({ data: null, error: { message: "Private project SQL" } });
    expect((await GET(request())).status).toBe(503);
  });

  it("does not silently export only one displayed page", async () => {
    mocks.rpc.mockResolvedValue({ data: ledger({ total: 51 }), error: null });
    expect((await GET(request())).status).toBe(503);
    const rows = Array.from({ length: 51 }, (_, i) => ({
      ...ledgerRow,
      id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(i).padStart(12, "0")}`,
    }));
    mocks.rpc.mockResolvedValue({ data: ledger({ total: rows.length, rows }), error: null });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.text()).split("\r\n")).toHaveLength(52);
  });

  it("reports an oversized full export explicitly instead of truncating it", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "exportTooLarge" } });
    expect((await GET(request())).status).toBe(413);
  });

  it("exports current receivables with no ledger-month narrowing and a current-date filename", async () => {
    mocks.rpc.mockResolvedValue({
      error: null,
      data: {
        kind: "receivables",
        page: 1,
        pageSize: 50,
        total: 1,
        summary: { receivable: 0, paid: 0, outstanding: 0, overdue: 0 },
        rows: [
          {
            id: entryId,
            due_date: "2020-01-01",
            building_label: "Synthetic building",
            unit_label: "408",
            category: "lease_rent",
            title: "Historical evidence pending",
            amount_xof: 100,
            paid_amount_xof: 20,
            status: "partial",
            management_status: "historical_pending",
            source_type: "lease_contract",
            source_id: paymentId,
          },
        ],
      },
    });
    const response = await GET(
      request("&kind=receivables&management=historical_pending&outstandingOnly=true&locale=fr"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(
      "receivables-current-2026-10-19.csv",
    );
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("finance_read_rpc", {
      p_kind: "receivables",
      p_filters: { projectId, management: "historical_pending", outstandingOnly: "true" },
      p_page: 1,
      p_export: true,
    });
    const csv = await response.text();
    expect(csv).toContain("Historique à vérifier");
    expect(csv).toContain("Loyer longue durée");
    expect(csv).toContain("2020-01-01");
    expect(csv).not.toContain("历史待核对");
  });

  it.each([
    null,
    { ...ledger(), summary: {} },
    { ...ledger(), summary: { ...summary, income: Number.NaN } },
    { ...ledger(), total: -1 },
    { ...ledger(), pageSize: 100 },
    { ...ledger(), kind: "receivables" },
  ])(
    "rejects invalid or wrong-scope database replies instead of fabricating an export",
    async (data) => {
      mocks.rpc.mockResolvedValue({ data, error: null });
      expect((await GET(request())).status).toBe(503);
    },
  );
  it.each([
    null,
    { ...ledgerRow, amount_xof: null },
    { ...ledgerRow, amount_xof: "not money" },
    { ...ledgerRow, amount_xof: Number.POSITIVE_INFINITY },
    { ...ledgerRow, amount_cny: "not money" },
    { ...ledgerRow, entry_date: "2026-02-30" },
    { ...ledgerRow, entry_date: "" },
    { ...ledgerRow, direction: "net" },
    { ...ledgerRow, category: null },
    { ...ledgerRow, building_label: 408 },
  ])("rejects malformed detail rows instead of exporting false financial facts", async (row) => {
    mocks.rpc.mockResolvedValue({
      data: ledger({ rows: [row] as FinanceReadResult["rows"] }),
      error: null,
    });
    expect((await GET(request())).status).toBe(503);
  });

  it("rejects duplicated record IDs instead of double-counting exported evidence", async () => {
    mocks.rpc.mockResolvedValue({
      data: ledger({ total: 2, rows: [ledgerRow, ledgerRow] }),
      error: null,
    });
    expect((await GET(request())).status).toBe(503);
  });
});

describe("localized financial export safety", () => {
  it("retains numeric precision, quotes and source IDs without executing spreadsheet formula text", () => {
    const csv = reportCsv(
      ledger({
        rows: [{ ...ledgerRow, amount_xof: 100.25, description: '  =SUM(A1)\n"explicit"' }],
      }),
    );
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"100.25"');
    expect(csv).toContain('"\'  =SUM(A1)\n""explicit"""');
    expect(csv).toContain(paymentId);
    expect(csv).toContain(entryId);
    expect(csv).toContain("登记方向");
    expect(csv).not.toContain("lease_rent");
  });
});
