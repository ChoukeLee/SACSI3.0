import { describe, expect, it } from "vitest";
import type { DailyBookingRow, UnitRow } from "@/types/database";
import {
  buildBookingMap,
  buildDailyRoomStateMap,
  getDailyRoomStateForDate,
} from "@/features/daily-rentals/room-status";
import { computeRoomStates } from "@/features/mobile/room-state";
import { getUnitTimelineStatus } from "@/features/daily-rentals/calendar-model";

const todayStr = "2026-10-20";
function unit(id = "u1"): UnitRow {
  return {
    id,
    building_id: "b1",
    code: id,
    unit_no: id,
    floor_label: "9F",
    kind: "apartment",
    status: "daily_occupied",
    area_sqm: null,
    layout: null,
    furnishing: null,
    notes: null,
    created_at: "",
    updated_at: "",
  };
}
function booking(overrides: Partial<DailyBookingRow> = {}): DailyBookingRow {
  return {
    id: "b1",
    unit_id: "u1",
    customer_id: "c1",
    check_in: "2026-10-17",
    check_out: "2026-10-18",
    checkout_mode: "fixed",
    actual_check_out: null,
    nightly_price_xof: 40000,
    total_amount_xof: 40000,
    prepaid_amount_xof: 0,
    billing_status: "prepaid",
    manual_discount_amount_xof: 0,
    manual_discount_reason: null,
    final_amount_xof: null,
    status: "checked_in",
    ota_source: null,
    notes: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}
function state(dateStr: string, bookings = [booking()]) {
  return getDailyRoomStateForDate({ unit: unit(), dateStr, todayStr, bookings, cleaningTasks: [] });
}

describe("legacy calendar unresolved current departures", () => {
  it("keeps overdue checked-in guests occupied today and in future planning", () => {
    expect(state(todayStr).status).toBe("occupied");
    expect(state("2026-10-25").booking?.id).toBe("b1");
    expect(state("2026-10-16").status).toBe("available");
  });

  it("does not invent an as-of date for old historical helper callers", () => {
    const result = getDailyRoomStateForDate({
      unit: unit(),
      dateStr: "2026-10-25",
      bookings: [booking()],
      cleaningTasks: [],
    });
    expect(result.status).toBe("available");
  });

  it("extends the unresolved grid band only through the requested window", () => {
    const map = buildBookingMap([booking()], {
      todayStr,
      tomorrowStr: "2026-10-21",
      visibleFrom: todayStr,
      visibleTo: "2026-10-28",
    }).get("u1")!;
    expect([...map.keys()]).toEqual([
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
    ]);
    expect(map.has("2026-10-28")).toBe(false);
  });

  it("does not add an extra checkout cell beyond tomorrow without an explicit window", () => {
    const map = buildBookingMap([booking()], { todayStr, tomorrowStr: "2026-10-21" }).get("u1")!;
    expect(map.has(todayStr)).toBe(true);
    expect(map.has("2026-10-21")).toBe(false);
  });

  it("retains planned future checkout boundaries when they have not yet become overdue", () => {
    const future = booking({ check_out: "2026-10-23" });
    expect(state("2026-10-24", [future]).status).toBe("available");
    const map = buildBookingMap([future], {
      todayStr,
      tomorrowStr: "2026-10-21",
      visibleFrom: todayStr,
      visibleTo: "2026-10-28",
    }).get("u1")!;
    expect(map.has("2026-10-23")).toBe(true);
    expect(map.has("2026-10-24")).toBe(false);
  });

  it("keeps completed historical stays bounded by the recorded actual departure", () => {
    const completed = booking({
      status: "checked_out",
      check_out: "2026-10-31",
      actual_check_out: "2026-10-18",
    });
    expect(state(todayStr, [completed]).status).toBe("available");
    const map = buildBookingMap([completed], { todayStr, tomorrowStr: "2026-10-21" }).get("u1")!;
    expect(map.has("2026-10-17")).toBe(true);
    expect(map.has("2026-10-18")).toBe(false);
    expect(map.has(todayStr)).toBe(false);
  });

  it("prioritizes actual unresolved occupancy over a conflicting reservation", () => {
    const upcoming = booking({
      id: "future",
      status: "confirmed",
      check_in: "2026-10-21",
      check_out: "2026-10-22",
    });
    const bookings = [booking(), upcoming];
    expect(state("2026-10-21", bookings).booking?.id).toBe("b1");
    const map = buildBookingMap(bookings, {
      todayStr,
      tomorrowStr: "2026-10-21",
      visibleFrom: todayStr,
      visibleTo: "2026-10-28",
    }).get("u1")!;
    expect(map.get("2026-10-21")?.id).toBe("b1");
  });

  it("does not declare a checked-in stay with a missing planned departure vacant", () => {
    const unknown = booking({ check_out: null });
    expect(state(todayStr, [unknown]).status).toBe("occupied");
    expect(state("2026-10-27", [unknown]).status).toBe("occupied");
  });

  it("keeps current summary, grid filters and mobile room states consistent", () => {
    const units = Array.from({ length: 13 }, (_, index) => ({
      ...unit(`u${index + 1}`),
      status: index < 10 ? ("daily_occupied" as const) : ("available" as const),
    }));
    const bookings = units.slice(0, 10).map((room, index) =>
      booking({
        id: `b${index + 1}`,
        unit_id: room.id,
        check_out: index < 2 ? "2026-10-18" : "2026-10-31",
      }),
    );
    const states = buildDailyRoomStateMap({
      dailyUnits: units,
      dateStr: todayStr,
      todayStr,
      bookings,
      cleaningTasks: [],
    });
    expect([...states.values()].filter((row) => row.status === "occupied")).toHaveLength(10);
    expect([...states.values()].filter((row) => row.status === "available")).toHaveLength(3);
    const grid = buildBookingMap(bookings, {
      todayStr,
      tomorrowStr: "2026-10-21",
      visibleFrom: todayStr,
      visibleTo: "2026-10-28",
    });
    const days = [new Date(`${todayStr}T00:00:00Z`)];
    expect(
      units.filter(
        (row) => getUnitTimelineStatus(row, days, grid, new Map(), todayStr) === "occupied",
      ),
    ).toHaveLength(10);
    const mobile = computeRoomStates(units, bookings, [], [], [], todayStr);
    expect(mobile.filter((row) => row.displayStatus === "occupied")).toHaveLength(10);
  });
});
