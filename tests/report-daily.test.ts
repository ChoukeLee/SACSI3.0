import { describe, it, expect } from "vitest";
import {
  aggregateDailyCollectionsMonthly,
  aggregateOccupancyMonthly,
  buildDailyOccupancy,
  dayRangeOfMonth,
} from "@/features/reports/report-aggregators";
import type { DailyBookingRow } from "@/types/database";

function booking(partial: Partial<DailyBookingRow>): DailyBookingRow {
  return {
    id: "b1",
    unit_id: "u1",
    customer_id: "c1",
    check_in: "2026-08-01",
    check_out: "2026-08-03",
    checkout_mode: "fixed",
    actual_check_out: null,
    nightly_price_xof: 40000,
    total_amount_xof: 80000,
    prepaid_amount_xof: 0,
    billing_status: "need_top_up",
    status: "confirmed",
    notes: null,
    ota_source: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...partial,
  } as DailyBookingRow;
}

describe("aggregateDailyCollectionsMonthly", () => {
  it("sums net collections per month", () => {
    const rows = [
      {
        month: "2026-08",
        gross: 120000,
        refund: 20000,
        adjustment: -20000,
        net: 80000,
        count: 4,
        excludedCount: 2,
      },
      {
        month: "2026-07",
        gross: 100000,
        refund: 0,
        adjustment: 0,
        net: 100000,
        count: 1,
        excludedCount: 0,
      },
    ];
    expect(aggregateDailyCollectionsMonthly(rows, ["2026-07", "2026-08"])).toEqual([100000, 80000]);
  });
});

describe("dayRangeOfMonth", () => {
  it("lists all days of a month", () => {
    expect(dayRangeOfMonth("2026-02")).toHaveLength(28);
    expect(dayRangeOfMonth("2026-02")[0]).toBe("2026-02-01");
    expect(dayRangeOfMonth("2026-02")[27]).toBe("2026-02-28");
  });
  it("handles 31-day months", () => {
    expect(dayRangeOfMonth("2026-08")).toHaveLength(31);
  });
});

describe("buildDailyOccupancy", () => {
  it("marks occupied vs reserved vs cleaning", () => {
    const days = dayRangeOfMonth("2026-08");
    const rows: DailyBookingRow[] = [
      booking({
        id: "b1",
        unit_id: "u1",
        check_in: "2026-08-01",
        check_out: "2026-08-03",
        status: "checked_in",
      }),
      booking({
        id: "b2",
        unit_id: "u2",
        check_in: "2026-08-05",
        check_out: "2026-08-08",
        status: "confirmed",
      }),
      booking({
        id: "b3",
        unit_id: "u3",
        check_in: "2026-08-10",
        check_out: null,
        actual_check_out: "2026-08-12",
        status: "checked_out",
        checkout_mode: "open",
      }),
    ];
    const cells = buildDailyOccupancy(rows, ["u1", "u2", "u3"], days);
    expect(cells.u1["2026-08-01"]).toBe("occupied");
    expect(cells.u1["2026-08-03"]).toBe("available");
    expect(cells.u2["2026-08-06"]).toBe("reserved");
    expect(cells.u3["2026-08-11"]).toBe("occupied");
    expect(cells.u3["2026-08-12"]).toBe("cleaning");
  });
});
describe("aggregateOccupancyMonthly", () => {
  it("counts actual nights without inventing historical capacity or rates", () => {
    const rows: DailyBookingRow[] = [
      booking({
        id: "b1",
        unit_id: "u1",
        check_in: "2026-08-01",
        check_out: "2026-08-11",
        status: "checked_out",
        actual_check_out: "2026-08-11",
      }),
    ];
    const [aug] = aggregateOccupancyMonthly(rows, ["2026-08"], "2026-09-01");
    expect(aug.occupiedNights).toBe(10);
    expect(aug.sellableNights).toBeNull();
    expect(aug.rate).toBeNull();
  });

  it("caps open bookings at month end", () => {
    const rows: DailyBookingRow[] = [
      booking({
        id: "b1",
        unit_id: "u1",
        check_in: "2026-08-20",
        check_out: null,
        checkout_mode: "open",
        status: "checked_in",
      }),
    ];
    const [aug] = aggregateOccupancyMonthly(rows, ["2026-08"], "2026-09-01");
    // Aug 20 → Sep 1 (month end) = 12 nights
    expect(aug.occupiedNights).toBe(12);
  });

  it("separates reservations, caps actual nights at today and deduplicates overlapping room-days", () => {
    const rows = [
      booking({
        status: "confirmed",
        unit_id: "reserved",
        check_in: "2026-08-01",
        check_out: "2026-08-06",
      }),
      booking({ id: "one", status: "checked_in", check_in: "2026-08-01", check_out: null }),
      booking({ id: "duplicate", status: "checked_in", check_in: "2026-08-02", check_out: null }),
      booking({ id: "cancelled", status: "cancelled", unit_id: "cancelled" }),
      booking({ id: "unknown-departure", status: "checked_out", unit_id: "unknown" }),
    ];
    const [aug] = aggregateOccupancyMonthly(rows, ["2026-08"], "2026-08-04");
    expect(aug.occupiedNights).toBe(3);
    expect(aug.reservedNights).toBe(5);
  });
});
