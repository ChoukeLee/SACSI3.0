import { describe, expect, it } from "vitest";
import {
  BOOKING_OPERATIONS,
  BOOKING_OPERATION_ACTIONS,
  isBookingOperation,
  isHighRiskBookingOperation,
  bookingOperationLabel,
} from "../src/features/business-actions/booking-operation-contract";
import {
  addDays,
  resolveRangeStart,
  resolveRangeEnd,
  toDateStr,
  serverMatchesPatch,
  getUnitTimelineStatus,
} from "../src/features/daily-rentals/calendar-model";
import {
  addDays as addBusinessDays,
  formatDailyRentalError,
} from "../src/features/daily-rentals/booking-presentation";
import type { UnitRow, DailyBookingRow } from "../src/types/database";

describe("shared booking operation contract", () => {
  it("maps every operation exactly once without exposing arbitrary actions", () => {
    const operations = Object.values(BOOKING_OPERATION_ACTIONS).flat();
    expect([...operations].sort()).toEqual(Object.keys(BOOKING_OPERATIONS).sort());
    expect(new Set(operations).size).toBe(9);
    for (const value of [null, {}, "constructor", "__proto__", "drop_table"]) {
      expect(isBookingOperation(value)).toBe(false);
      expect(isHighRiskBookingOperation(value)).toBe(true);
    }
  });
  it("keeps refunds distinct from reversals and room correction", () => {
    expect(bookingOperationLabel("refund")).toBe("登记实际退款");
    expect(bookingOperationLabel("reverse")).toBe("冲正错误收款");
    expect(bookingOperationLabel("correct_room")).toBe("纠正录错房号");
    expect(isHighRiskBookingOperation("create")).toBe(false);
    expect(isHighRiskBookingOperation("refund")).toBe(true);
  });
});

describe("extracted calendar and presentation behavior", () => {
  it("keeps calendar dates local and receipt dates UTC across leap/month boundaries", () => {
    const leap = new Date(2024, 1, 28, 20);
    expect(toDateStr(addDays(leap, 2))).toBe("2024-03-01");
    expect(toDateStr(leap)).toBe("2024-02-28");
    expect(addBusinessDays("2024-02-28", 2)).toBe("2024-03-01");
    expect(addBusinessDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("preserves Monday week starts and exclusive range ends", () => {
    const sunday = new Date(2026, 8, 27);
    expect(toDateStr(resolveRangeStart(sunday, "week"))).toBe("2026-09-21");
    expect(toDateStr(resolveRangeEnd(sunday, "week"))).toBe("2026-09-28");
    expect(toDateStr(resolveRangeEnd(sunday, "month"))).toBe("2026-10-01");
    expect(toDateStr(resolveRangeEnd(sunday, "day"))).toBe("2026-10-05");
  });
  it("retains maintenance and cleaning priority and occupied fallback", () => {
    const unit = { id: "unit", status: "locked" } as UnitRow;
    const days = [new Date(2026, 8, 23)];
    const bookings = new Map<string, Map<string, DailyBookingRow>>();
    expect(getUnitTimelineStatus(unit, days, bookings, new Map())).toBe("maintenance");
    expect(
      getUnitTimelineStatus(
        { ...unit, status: "available" },
        days,
        bookings,
        new Map([[unit.id, "task"]]),
      ),
    ).toBe("cleaning");
    expect(
      getUnitTimelineStatus(
        { ...unit, status: "daily_occupied" },
        days,
        bookings,
        new Map(),
        "2026-09-23",
      ),
    ).toBe("occupied");
  });
  it("preserves server patch reconciliation and bilingual error messages", () => {
    expect(serverMatchesPatch({ status: "confirmed" }, { status: "checked_in" })).toBe(false);
    expect(serverMatchesPatch({ status: "confirmed" }, { status: "confirmed" })).toBe(true);
    expect(formatDailyRentalError("doubleBooked:11#503", "zh")).toContain("11#503");
    expect(formatDailyRentalError("checkInRequired", "fr")).toContain("arrivee");
  });
});
