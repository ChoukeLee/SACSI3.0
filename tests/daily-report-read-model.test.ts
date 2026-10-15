import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  loadDailyReceiptMonths,
  readDailyReceiptReport,
} from "@/features/reports/daily-receipt-report-service";
import { dailyBookingFinancePosition } from "@/features/daily-rentals/calendar-finance-model";
import type { DailyBookingRow } from "@/types/database";

const summary = { gross: 100, refund: 20, adjustment: -10, net: 70, count: 3, excludedCount: 1 };
const snapshot = (overrides = {}) => ({
  rows: [],
  total: 4,
  summary,
  previous: summary,
  year: summary,
  trend: [{ month: "2026-10", ...summary }],
  coverage: { firstDate: "2026-01-01", lastDate: "2026-10-15" },
  buildings: [],
  generatedAt: "2026-10-15T12:00:00Z",
  ...overrides,
});

describe("verified receipt report read model", () => {
  it("reuses the authoritative receipt RPC, including refund/reversal/exclusion totals", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: snapshot(), error: null });
    const result = await readDailyReceiptReport({ rpc }, "2026-10-01", "2026-10-15", "building");
    expect(result.summary).toEqual(summary);
    expect(rpc).toHaveBeenCalledWith(
      "daily_receipts_read_rpc",
      expect.objectContaining({
        p_export: false,
        p_input: expect.objectContaining({ buildingId: "building", dateTo: "2026-10-15" }),
      }),
    );
  });
  it("fails closed on database errors and incomplete detail exports", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "unavailable" } });
    await expect(readDailyReceiptReport({ rpc }, "2026-10-01", "2026-10-15")).rejects.toThrow();
    rpc.mockResolvedValue({ data: snapshot(), error: null });
    await expect(
      readDailyReceiptReport({ rpc }, "2026-10-01", "2026-10-15", null, true),
    ).rejects.toThrow();
  });
  it("keeps complete server monthly aggregates independent of a 50-row detail page", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: snapshot(), error: null });
    expect((await loadDailyReceiptMonths({ rpc }, new Date("2026-10-15T12:00:00Z")))[0].net).toBe(
      70,
    );
  });
});

describe("complete calendar booking finance position", () => {
  const booking = (overrides: Partial<DailyBookingRow> = {}) =>
    ({
      id: "booking",
      unit_id: "room",
      check_in: "2026-10-01",
      check_out: "2026-10-03",
      actual_check_out: null,
      checkout_mode: "fixed",
      status: "checked_in",
      nightly_price_xof: 100,
      final_amount_xof: 200,
      prepaid_amount_xof: 50,
      ...overrides,
    }) as DailyBookingRow;
  it("does not cap old unpaid orders at 300 rows or count planned departure as settlement", () => {
    const rows = Array.from({ length: 501 }, (_, i) => booking({ id: `${i}` }));
    rows.push(booking({ status: "confirmed" }), booking({ status: "cancelled" }));
    rows.push(booking({ status: "checked_out", actual_check_out: null }));
    const result = dailyBookingFinancePosition(rows, "2026-10-15");
    expect(result.currentOutstanding).toBe(502 * 150);
    expect(result.monthSettled).toBe(0);
  });
  it("separates actual departure billing from cash received", () => {
    const result = dailyBookingFinancePosition(
      [booking({ status: "checked_out", actual_check_out: "2026-10-03" })],
      "2026-10-15",
    );
    expect(result.monthSettled).toBe(200);
    expect(result.currentOutstanding).toBe(150);
  });
});
