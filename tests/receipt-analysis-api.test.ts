import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@/lib/auth";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  getCurrentUser: mocks.user,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc: mocks.rpc })) }));
import { GET } from "@/app/api/daily-rentals/receipts/route";
import { decodeReceiptRead } from "@/features/daily-rentals/receipt-analysis-service";

const totals = { gross: 100, refund: 0, adjustment: 0, net: 100, count: 1, excludedCount: 0 };
const line = {
  id: "record",
  date: "2026-09-02",
  createdAt: "2026-09-03T00:00:00Z",
  bookingId: null,
  unitId: null,
  room: null,
  buildingId: null,
  buildingName: null,
  guestName: null,
  bookingAgentName: null,
  receiptNo: null,
  paymentMethod: null,
  amount: 100,
  currency: "XOF",
  amountXof: 100,
  kind: "collection",
  exclusionReason: null,
  reversalOf: null,
  notes: null,
};
const payload = () => ({
  rows: [{ ...line }],
  total: 1,
  summary: { ...totals },
  previous: { ...totals },
  year: { ...totals },
  trend: [{ month: "2026-09", ...totals }],
  coverage: { firstDate: "2025-01-01", lastDate: "2026-09-03" },
  buildings: [],
  generatedAt: "2026-10-15T00:00:00Z",
});
const request = (query = "") =>
  new Request(`https://sacsi.example/api/daily-rentals/receipts?month=2026-09${query}`);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "actor", role: "admin" });
  mocks.rpc.mockResolvedValue({ data: payload(), error: null });
});
describe("receipt API", () => {
  it("rejects anonymous and ordinary daily roles before database access", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    for (const role of ["front_desk", "rental_sales"] as UserRole[]) {
      mocks.user.mockResolvedValue({ role });
      expect((await GET(request())).status).toBe(403);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["admin", "finance", "boss"])("permits %s read-only analysis", async (role) => {
    mocks.user.mockResolvedValue({ role });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).summary.net).toBe(100);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "daily_receipts_read_rpc",
      expect.objectContaining({ p_page: 1, p_export: false }),
    );
  });
  it("rejects duplicate and invalid parameters without SQL", async () => {
    expect((await GET(request("&month=2026-08"))).status).toBe(400);
    expect((await GET(request("&method=unknownmethod"))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("exports the complete filtered snapshot with explicit range filename", async () => {
    const response = await GET(
      request("&export=1&locale=fr&buildingId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(
      "daily-receipts-2026-09-01-2026-09-30.csv",
    );
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({
      p_export: true,
      p_input: { buildingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    });
    expect(await response.text()).toContain("Motif exclusion");
  });
  it.each([
    ["42501", "dailyReceiptsPermissionDenied", 403],
    ["P0001", "dailyReceiptsExportTooLarge", 413],
    ["P0001", "invalidDailyReceiptsDateRange", 400],
    ["PGRST202", "missing RPC", 503],
  ])("fails closed for %s/%s", async (code, message, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message } });
    const response = await GET(request());
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("missing RPC");
  });
  it("rejects partial export and corrupt totals rather than showing zero", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...payload(), rows: [] }, error: null });
    expect((await GET(request("&export=1"))).status).toBe(503);
    mocks.rpc.mockResolvedValue({
      data: { ...payload(), summary: { ...totals, net: 0 } },
      error: null,
    });
    expect((await GET(request())).status).toBe(503);
  });
});
describe("strict report decoding", () => {
  it("accepts exact numeric database strings and null original invalid amount", () => {
    expect(
      decodeReceiptRead({ ...payload(), summary: { ...totals, gross: "100.00" } }).summary.gross,
    ).toBe(100);
    const excluded = {
      ...line,
      kind: "excluded",
      amount: null,
      amountXof: null,
      exclusionReason: "invalid_amount",
    };
    expect(
      decodeReceiptRead({
        ...payload(),
        rows: [excluded],
        summary: { gross: 0, refund: 0, adjustment: 0, net: 0, count: 0, excludedCount: 1 },
      }).rows[0].amount,
    ).toBeNull();
  });
  it.each([NaN, Infinity, "", null, true, "9007199254740993", 1.5])(
    "rejects unsafe summary amount %s",
    (gross) => {
      expect(() => decodeReceiptRead({ ...payload(), summary: { ...totals, gross } })).toThrow(
        "receiptHistoryUnavailable",
      );
    },
  );
  it("rejects malformed snapshot, invalid dates, wrong signed kind or omitted metadata", () => {
    for (const data of [
      null,
      {},
      { ...payload(), total: 2 },
      { ...payload(), rows: [{ ...line, date: "2026-02-30" }] },
      { ...payload(), rows: [{ ...line, kind: "refund" }] },
      { ...payload(), coverage: {} },
      { ...payload(), generatedAt: "notdate" },
    ])
      expect(() => decodeReceiptRead(data)).toThrow("receiptHistoryUnavailable");
  });
});
