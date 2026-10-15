import { expect, it } from "vitest";
import {
  parseCalendarWindow,
  decodeCalendarWindow,
} from "@/features/daily-rentals/calendar-window-model";
import { buildBookingMap } from "@/features/daily-rentals/room-status";
import { calendarBuilding, calendarWindowFixture } from "./fixtures/calendar-window";
import type { DailyBookingRow } from "@/types/database";

it("accepts bounded cross-month windows but rejects impossible dates, reversed ranges and oversized requests", () => {
  expect(
    parseCalendarWindow({ buildingId: calendarBuilding, from: "2026-01-25", to: "2026-03-01" }).to,
  ).toBe("2026-03-01");
  for (const [from, to] of [
    ["2026-02-30", "2026-03-10"],
    ["2026-01-10", "2026-01-01"],
    ["2026-01-01", "2026-04-01"],
  ])
    expect(() => parseCalendarWindow({ buildingId: calendarBuilding, from, to })).toThrow(
      "invalidCalendarWindow",
    );
});
it("rejects a partial or foreign-unit snapshot rather than treating it as known empty room status", () => {
  const valid = calendarWindowFixture();
  expect(decodeCalendarWindow(valid, valid)).toEqual(valid);
  expect(() => decodeCalendarWindow({ ...valid, bookingCount: 1 }, valid)).toThrow(
    "calendarWindowUnavailable",
  );
  expect(() =>
    decodeCalendarWindow(
      {
        ...valid,
        bookings: [{ id: "foreign", unit_id: "foreign", check_in: valid.from }],
        bookingCount: 1,
      },
      valid,
    ),
  ).toThrow("calendarWindowUnavailable");
});
it("expands even a decades-long open stay only over the visible eight days", () => {
  const booking = {
    id: "open",
    unit_id: "unit",
    status: "checked_in",
    checkout_mode: "open",
    check_in: "1900-01-01",
    check_out: null,
    actual_check_out: null,
  } as DailyBookingRow;
  const map = buildBookingMap([booking], {
    todayStr: "2026-10-22",
    tomorrowStr: "2026-10-23",
    visibleFrom: "2026-10-15",
    visibleTo: "2026-10-23",
  });
  expect([...map.get("unit")!.keys()]).toEqual([
    "2026-10-15",
    "2026-10-16",
    "2026-10-17",
    "2026-10-18",
    "2026-10-19",
    "2026-10-20",
    "2026-10-21",
    "2026-10-22",
  ]);
});
