import { describe, expect, it } from "vitest";
import type { DailyBookingRow, UnitRow } from "@/types/database";
import {
  dailyCalendarEventLanes,
  dailyCalendarFloorLabel,
  dailyCalendarFloors,
  dailyCalendarStayLanes,
  dailyCalendarUnits,
} from "@/features/daily-rentals/daily-room-calendar-model";

const today = "2026-10-20";
const dates = [today, "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"];
function booking(
  id: string,
  checkIn: string,
  checkOut: string | null,
  overrides: Partial<DailyBookingRow> = {},
): DailyBookingRow {
  return {
    id,
    check_in: checkIn,
    check_out: checkOut,
    actual_check_out: null,
    checkout_mode: "fixed",
    status: "confirmed",
    ...overrides,
  } as DailyBookingRow;
}
function unit(id: string, floor: string, no: string, buildingId = "a") {
  return { id, floor_label: floor, unit_no: no, building_id: buildingId } as UnitRow;
}

describe("daily room calendar presentation model", () => {
  it("packs checkout-exclusive adjacent bookings into one lane", () => {
    const result = dailyCalendarStayLanes(
      [booking("second", "2026-10-22", "2026-10-24"), booking("first", today, "2026-10-22")],
      dates,
      today,
    );
    expect(result.laneCount).toBe(1);
    expect(
      result.stays.map(({ booking: record, first, last, lane }) => [record.id, first, last, lane]),
    ).toEqual([
      ["first", 0, 1, 0],
      ["second", 2, 3, 0],
    ]);
  });

  it("adds lanes for overlapping records and reuses them only after the previous occupied day", () => {
    const result = dailyCalendarStayLanes(
      [
        booking("a", today, "2026-10-23"),
        booking("b", "2026-10-21", "2026-10-22"),
        booking("c", "2026-10-22", "2026-10-24"),
      ],
      dates,
      today,
    );
    expect(result.laneCount).toBe(2);
    expect(result.stays.map(({ lane }) => lane)).toEqual([0, 1, 1]);
  });

  it("keeps overdue and open in-house stays occupying future dates", () => {
    const result = dailyCalendarStayLanes(
      [
        booking("overdue", "2026-10-18", "2026-10-19", { status: "checked_in" }),
        booking("open", "2026-10-18", null, { status: "checked_in", checkout_mode: "open" }),
      ],
      dates,
      today,
    );
    expect(result.laneCount).toBe(2);
    expect(result.stays.map(({ first, last }) => [first, last])).toEqual([
      [0, 4],
      [0, 4],
    ]);
  });

  it("draws completed history only through actual departure and excludes cancelled or unsupported records", () => {
    const result = dailyCalendarStayLanes(
      [
        booking("history", "2026-10-18", "2026-10-25", {
          status: "checked_out",
          actual_check_out: "2026-10-21",
        }),
        booking("unknown-history", "2026-10-18", "2026-10-25", { status: "checked_out" }),
        booking("cancelled", today, "2026-10-24", { status: "cancelled" }),
        booking("future", "2026-11-01", "2026-11-03"),
      ],
      dates,
      today,
    );
    expect(
      result.stays.map(({ booking: record, first, last }) => [record.id, first, last]),
    ).toEqual([["history", 0, 0]]);
  });

  it("keeps floor labels literal and naturally sorted with unknown floors last", () => {
    expect(
      dailyCalendarFloors([
        unit("a", "10F", "101"),
        unit("b", "2F", "999"),
        unit("c", "", "301"),
        unit("d", "2F", "302"),
      ]),
    ).toEqual(["2F", "10F", ""]);
  });

  it("scopes and naturally sorts copied rooms without mutating the input", () => {
    const units = [unit("102", "1F", "102"), unit("2", "1F", "2"), unit("other", "1F", "101", "b")];
    const result = dailyCalendarUnits(units, "a");
    expect(result.map(({ id }) => id)).toEqual(["2", "102"]);
    expect(units.map(({ id }) => id)).toEqual(["102", "2", "other"]);
  });

  it("reuses the checkout-exclusive room lane for handover instead of making ordinary rows taller", () => {
    const { stays, laneCount } = dailyCalendarStayLanes(
      [booking("stay", today, "2026-10-22")],
      dates,
      today,
    );
    const result = dailyCalendarEventLanes(stays, laneCount, [
      { id: "handover", first: 2, last: 2 },
    ]);
    expect(result.extraLaneCount).toBe(0);
    expect(result.placedEvents[0].lane).toBe(0);
  });

  it("uses the one existing empty room lane for maintenance or cleaning", () => {
    expect(dailyCalendarEventLanes([], 1, [{ first: 0, last: 4 }])).toEqual({
      placedEvents: [{ first: 0, last: 4, lane: 0 }],
      extraLaneCount: 0,
    });
    expect(dailyCalendarEventLanes([], 1, [{ first: 0, last: 0 }]).extraLaneCount).toBe(0);
  });

  it("keeps handover separate when the same date already has a next arrival", () => {
    const { stays, laneCount } = dailyCalendarStayLanes(
      [booking("first", today, "2026-10-22"), booking("next", "2026-10-22", "2026-10-24")],
      dates,
      today,
    );
    const result = dailyCalendarEventLanes(stays, laneCount, [{ first: 2, last: 2 }]);
    expect(result.extraLaneCount).toBe(1);
    expect(result.placedEvents[0].lane).toBe(1);
  });

  it("reuses other conflict lanes when their cells are free before allocating any event rows", () => {
    const { stays, laneCount } = dailyCalendarStayLanes(
      [booking("long", today, "2026-10-24"), booking("short", today, "2026-10-21")],
      dates,
      today,
    );
    const result = dailyCalendarEventLanes(stays, laneCount, [{ first: 2, last: 2 }]);
    expect(result.extraLaneCount).toBe(0);
    const event = result.placedEvents[0];
    expect(
      stays
        .filter((stay) => stay.lane === event.lane)
        .every((stay) => stay.last < event.first || stay.first > event.last),
    ).toBe(true);
  });

  it("separates simultaneous restrictions while sharing a lane for different dates and preserves inputs", () => {
    const events = [
      { id: "last", first: 4, last: 4 },
      { id: "first", first: 0, last: 0 },
      { id: "same", first: 0, last: 0 },
    ];
    const result = dailyCalendarEventLanes([], 1, events);
    expect(result.extraLaneCount).toBe(1);
    expect(result.placedEvents.map(({ id, lane }) => [id, lane])).toEqual([
      ["first", 0],
      ["same", 1],
      ["last", 0],
    ]);
    expect(events.map(({ id }) => id)).toEqual(["last", "first", "same"]);
  });

  it("normalizes missing or whitespace floor metadata without inferring a room's floor", () => {
    const rooms = [
      unit("known", " 2F ", "999"),
      { ...unit("missing", "", "101"), floor_label: null },
      { ...unit("omitted", "", "302"), floor_label: undefined },
    ] as unknown as UnitRow[];
    expect(rooms.map(dailyCalendarFloorLabel)).toEqual(["2F", "", ""]);
    expect(dailyCalendarFloors(rooms)).toEqual(["2F", ""]);
    expect(dailyCalendarUnits(rooms, "a")).toHaveLength(3);
  });
});
