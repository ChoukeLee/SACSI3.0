import { describe, expect, it } from "vitest";
import type { DailyBookingRow, UnitRow } from "@/types/database";
import {
  buildDailyTasks,
  dailyBookingOccupiesDate,
  dailyWindowCoversInterval,
  dailyWorkbenchCounts,
  findDailyRooms,
} from "@/features/daily-rentals/daily-workbench-model";
import type { CalendarWindowData } from "@/features/daily-rentals/calendar-window-model";
import {
  calendarBuilding,
  calendarOtherBuilding,
  calendarWindowFixture,
} from "./fixtures/calendar-window";

const today = "2026-10-20";

function unit(overrides: Partial<UnitRow> = {}): UnitRow {
  return {
    id: "unit-101",
    building_id: calendarBuilding,
    code: "SACSI11-101",
    unit_no: "101",
    floor_label: "1F",
    kind: "apartment",
    status: "available",
    operational_condition: "normal",
    daily_rental_enabled: true,
    area_sqm: null,
    layout: null,
    furnishing: null,
    notes: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function booking(overrides: Partial<DailyBookingRow> = {}): DailyBookingRow {
  return {
    id: "booking-101",
    unit_id: "unit-101",
    customer_id: "legacy-contact",
    booking_agent_id: "agent",
    guest_customer_id: "guest",
    guest_name: "A guest",
    check_in: today,
    check_out: "2026-10-23",
    checkout_mode: "fixed",
    actual_check_out: null,
    nightly_price_xof: 40000,
    total_amount_xof: 120000,
    prepaid_amount_xof: 0,
    billing_status: "prepaid",
    manual_discount_amount_xof: 0,
    manual_discount_reason: null,
    final_amount_xof: null,
    status: "confirmed",
    ota_source: null,
    notes: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function snapshot(overrides: Partial<CalendarWindowData> = {}): CalendarWindowData {
  const rows = overrides.bookings ?? [];
  return calendarWindowFixture({
    from: "2026-10-18",
    to: "2026-10-28",
    today,
    dailyUnits: [unit()],
    unitLookupUnits: [unit()],
    bookings: rows,
    bookingCount: rows.length,
    ...overrides,
  });
}

describe("daily operations tasks", () => {
  it("uses explicit contact identity, not guest or stale legacy identity", () => {
    const data = snapshot({
      bookings: [booking()],
      customers: [
        { id: "agent", name: "Contact", phone: null, is_blacklisted: false },
        { id: "legacy-contact", name: "Legacy", phone: null, is_blacklisted: false },
        { id: "guest", name: "Guest", phone: null, is_blacklisted: false },
      ],
    });
    expect(buildDailyTasks(data, today, "arrivals")[0].customer?.name).toBe("Contact");
    expect(buildDailyTasks({ ...data, customers: [] }, today, "arrivals")[0].customer).toBeNull();
  });

  it("uses legacy contact only when booking_agent_id is absent", () => {
    const tasks = buildDailyTasks(
      snapshot({
        bookings: [booking({ booking_agent_id: undefined })],
        customers: [{ id: "legacy-contact", name: "Legacy", phone: null, is_blacklisted: false }],
      }),
      today,
      "arrivals",
    );
    expect(tasks[0].customer?.name).toBe("Legacy");
  });

  it("includes overdue unarrived reservations as review, never as in-house", () => {
    const data = snapshot({
      bookings: [
        booking({ id: "today" }),
        booking({ id: "overdue", check_in: "2026-10-19" }),
        booking({ id: "future", check_in: "2026-10-21" }),
        booking({ id: "cancelled", status: "cancelled" }),
      ],
    });
    expect(buildDailyTasks(data, today, "arrivals").map((task) => task.kind)).toEqual([
      "review",
      "arrival",
    ]);
    expect(buildDailyTasks(data, today, "inhouse")).toEqual([]);
    expect(dailyWorkbenchCounts(data, today).arrivals).toBe(2);
  });

  it("keeps overdue checked-in guests in occupancy and departure follow-up", () => {
    const data = snapshot({
      bookings: [
        booking({ status: "checked_in", check_in: "2026-10-18", check_out: "2026-10-19" }),
      ],
    });
    expect(dailyWorkbenchCounts(data, today)).toEqual({
      arrivals: 0,
      inhouse: 1,
      departures: 1,
      cleaning: 0,
    });
    expect(buildDailyTasks(data, today, "inhouse")[0].kind).toBe("departure");
  });

  it("never treats open checkout as overdue or invents a departure", () => {
    const data = snapshot({
      bookings: [booking({ status: "checked_in", checkout_mode: "open", check_out: null })],
    });
    expect(dailyWorkbenchCounts(data, today).inhouse).toBe(1);
    expect(dailyWorkbenchCounts(data, today).departures).toBe(0);
    expect(buildDailyTasks(data, today, "priority")).toEqual([]);
  });

  it("counts one cleaning room for several pending tasks and ignores completed tasks", () => {
    const data = snapshot({
      cleaningTasks: [
        { id: "a", unit_id: "unit-101", daily_booking_id: null, is_completed: false },
        { id: "b", unit_id: "unit-101", daily_booking_id: null, is_completed: false },
        { id: "done", unit_id: "unit-101", daily_booking_id: null, is_completed: true },
      ],
    });
    expect(buildDailyTasks(data, today, "cleaning")).toHaveLength(1);
    expect(dailyWorkbenchCounts(data, today).cleaning).toBe(1);
    expect(
      buildDailyTasks(
        { ...data, cleaningTasks: data.cleaningTasks.filter((row) => row.is_completed) },
        today,
        "cleaning",
      ),
    ).toEqual([]);
  });

  it("keeps a cleaning status without a task visible for manual verification", () => {
    const data = snapshot({ dailyUnits: [unit({ status: "cleaning_pending" })] });
    expect(buildDailyTasks(data, today, "cleaning")[0]).toMatchObject({
      id: "cleaning:unit-101",
      booking: null,
      customer: null,
      kind: "cleaning",
    });
  });

  it("does not attach an unrelated current guest to a cleaning task", () => {
    const data = snapshot({
      bookings: [booking({ status: "checked_in" })],
      cleaningTasks: [
        { id: "old", unit_id: "unit-101", daily_booking_id: "missing-old", is_completed: false },
      ],
    });
    expect(buildDailyTasks(data, today, "cleaning")[0].booking).toBeNull();
  });

  it("uses explicit billing markers for follow-up without inferring confirmed receivables", () => {
    const data = snapshot({
      bookings: [
        booking({
          id: "unpaid-order",
          status: "checked_in",
          total_amount_xof: 9000000,
          prepaid_amount_xof: 0,
          billing_status: "prepaid",
        }),
        booking({
          id: "marker",
          status: "checked_out",
          billing_status: "need_top_up",
          final_amount_xof: 0,
          prepaid_amount_xof: 9999999,
        }),
        booking({ id: "partial", status: "checked_in", billing_status: "partially_paid" }),
        booking({ id: "settled", status: "checked_out", billing_status: "settled" }),
        booking({ id: "reservation", status: "confirmed", billing_status: "need_top_up" }),
      ],
    });
    expect(
      buildDailyTasks(data, today, "collection")
        .map((task) => task.booking?.id)
        .sort(),
    ).toEqual(["marker", "partial"]);
    expect(buildDailyTasks(data, today, "collection")[0]).not.toHaveProperty("outstanding");
  });

  it("uses only scoped units and deduplicates repeated booking identities", () => {
    const data = snapshot({
      dailyUnits: [unit(), unit({ id: "foreign", building_id: calendarOtherBuilding })],
      bookings: [booking(), booking(), booking({ id: "other", unit_id: "foreign" })],
    });
    expect(buildDailyTasks(data, today, "arrivals")).toHaveLength(1);
    expect(dailyWorkbenchCounts(data, today).arrivals).toBe(1);
  });

  it("keeps historical collection follow-up out of the default today list without hiding it from the collection tab", () => {
    const historical = Array.from({ length: 20 }, (_, index) =>
      booking({
        id: `historical-${index}`,
        status: "checked_out",
        check_in: "2025-01-01",
        check_out: "2025-01-03",
        actual_check_out: "2025-01-03",
        billing_status: "need_top_up",
      }),
    );
    const data = snapshot({
      bookings: [
        ...historical,
        booking({ id: "today-arrival" }),
        booking({
          id: "today-departure",
          status: "checked_in",
          check_in: "2026-10-19",
          check_out: today,
          billing_status: "partially_paid",
        }),
      ],
    });
    expect(
      buildDailyTasks(data, today, "priority").map((task) => [task.kind, task.booking?.id]),
    ).toEqual([
      ["departure", "today-departure"],
      ["arrival", "today-arrival"],
    ]);
    const collection = buildDailyTasks(data, today, "collection");
    expect(collection).toHaveLength(21);
    expect(collection.every((task) => task.kind === "collection")).toBe(true);
    expect(new Set(collection.map((task) => task.booking?.id))).toEqual(
      new Set([...historical.map((row) => row.id), "today-departure"]),
    );
  });

  it("puts inconsistent checked-in status in review instead of claiming occupancy", () => {
    const data = snapshot({
      bookings: [
        booking({ status: "checked_in", check_in: "2026-10-18", actual_check_out: "2026-10-19" }),
      ],
    });
    expect(dailyWorkbenchCounts(data, today).inhouse).toBe(0);
    expect(buildDailyTasks(data, today, "priority")[0].kind).toBe("review");
  });
});

describe("daily interval availability", () => {
  it("marks only an explicitly normal, enabled room as ready for today", () => {
    expect(findDailyRooms(snapshot(), today, "2026-10-23", today)[0]).toMatchObject({
      state: "ready",
      reason: "ready",
      conflicts: [],
    });
  });

  it("marks no-conflict future stays conditional, not ready", () => {
    expect(findDailyRooms(snapshot(), "2026-10-21", "2026-10-23", today)[0]).toMatchObject({
      state: "conditional",
      reason: "futureHandover",
    });
  });

  it.each([
    { operational_condition: undefined },
    { daily_rental_enabled: undefined },
  ] as Partial<UnitRow>[])(
    "does not infer readiness from missing operational facts: %j",
    (overrides) => {
      expect(
        findDailyRooms(snapshot({ dailyUnits: [unit(overrides)] }), today, "2026-10-23", today)[0],
      ).toMatchObject({
        state: "conditional",
        reason: "readinessUnverified",
      });
    },
  );

  it.each([
    ["2026-10-20", "2026-10-20"],
    ["2026-10-23", "2026-10-20"],
    ["2026-02-30", "2026-03-02"],
    ["", "2026-10-23"],
  ])("fails closed for invalid interval %s to %s", (from, to) => {
    expect(findDailyRooms(snapshot(), from, to, today)[0]).toMatchObject({
      state: "blocked",
      reason: "invalidDateRange",
    });
  });

  it("does not offer a normal booking in the past", () => {
    expect(findDailyRooms(snapshot(), "2026-10-19", "2026-10-22", today)[0].reason).toBe(
      "pastDateNotAllowed",
    );
  });

  it.each([
    { from: "2026-10-21" },
    { to: "2026-10-22" },
    { bookingCount: 1 },
    { today: "2026-10-19" },
  ])("does not mark an incomplete or stale snapshot available: %j", (overrides) => {
    expect(findDailyRooms(snapshot(overrides), today, "2026-10-23", today)[0]).toMatchObject({
      state: "blocked",
      reason: "incompleteWindow",
    });
  });

  it("checks coverage at both exclusive range boundaries", () => {
    const data = snapshot();
    expect(dailyWindowCoversInterval(data, data.from, data.to)).toBe(true);
    expect(dailyWindowCoversInterval(data, "2026-10-17", data.to)).toBe(false);
    expect(dailyWindowCoversInterval(data, data.from, "2026-10-29")).toBe(false);
  });

  it("treats cancelled reservations as no conflict", () => {
    const data = snapshot({ bookings: [booking({ status: "cancelled" })] });
    expect(findDailyRooms(data, today, "2026-10-23", today)[0].state).toBe("ready");
  });

  it("respects exclusive checkout and future check-in boundaries", () => {
    const data = snapshot({
      bookings: [booking({ check_in: "2026-10-23", check_out: "2026-10-25" })],
    });
    expect(findDailyRooms(data, today, "2026-10-23", today)[0].state).toBe("ready");
    expect(findDailyRooms(data, "2026-10-25", "2026-10-26", today)[0].reason).toBe(
      "futureHandover",
    );
    expect(findDailyRooms(data, "2026-10-22", "2026-10-24", today)[0]).toMatchObject({
      state: "blocked",
      reason: "bookingConflict",
      conflicts: [{ id: "booking-101" }],
    });
  });

  it("does not release an overdue checked-in room on its planned checkout date", () => {
    const data = snapshot({
      bookings: [
        booking({ status: "checked_in", check_in: "2026-10-18", check_out: "2026-10-19" }),
      ],
    });
    expect(findDailyRooms(data, "2026-10-25", "2026-10-26", today)[0].reason).toBe(
      "bookingConflict",
    );
    expect(dailyBookingOccupiesDate(data.bookings[0], "2026-10-25", today)).toBe(true);
  });

  it("allows conditional planning after a still-future fixed checkout", () => {
    const data = snapshot({
      dailyUnits: [unit({ status: "daily_occupied" })],
      bookings: [
        booking({ status: "checked_in", check_in: "2026-10-19", check_out: "2026-10-23" }),
      ],
    });
    expect(findDailyRooms(data, "2026-10-23", "2026-10-25", today)[0]).toMatchObject({
      state: "conditional",
      reason: "futureHandover",
      conflicts: [],
    });
    expect(findDailyRooms(data, today, "2026-10-23", today)[0].state).toBe("blocked");
    expect(dailyBookingOccupiesDate(data.bookings[0], "2026-10-22", today)).toBe(true);
    expect(dailyBookingOccupiesDate(data.bookings[0], "2026-10-23", today)).toBe(false);
  });

  it("changes an uncompleted planned checkout into a persistent blocker when it becomes overdue", () => {
    const laterToday = "2026-10-23";
    const data = snapshot({
      today: laterToday,
      dailyUnits: [unit({ status: "daily_occupied" })],
      bookings: [booking({ status: "checked_in", check_in: "2026-10-19", check_out: laterToday })],
    });
    expect(findDailyRooms(data, "2026-10-25", "2026-10-26", laterToday)[0].state).toBe("blocked");
    expect(dailyBookingOccupiesDate(data.bookings[0], "2026-10-25", laterToday)).toBe(true);
  });

  it("does not promise same-day turnover before the current guest actually checks out", () => {
    const data = snapshot({
      bookings: [booking({ status: "checked_in", check_in: "2026-10-19", check_out: today })],
    });
    expect(findDailyRooms(data, today, "2026-10-23", today)[0].state).toBe("blocked");
  });

  it.each(["confirmed", "pending_review", "checked_in"])(
    "blocks open checkout indefinitely for %s",
    (status) => {
      const data = snapshot({
        bookings: [booking({ status, checkout_mode: "open", check_out: null })],
      });
      expect(findDailyRooms(data, "2026-10-25", "2026-10-26", today)[0].reason).toBe(
        "openCheckout",
      );
    },
  );

  it("uses actual, not planned, departure for completed stays", () => {
    const data = snapshot({
      bookings: [
        booking({
          status: "checked_out",
          check_in: "2026-10-18",
          check_out: "2026-10-25",
          actual_check_out: today,
        }),
      ],
    });
    expect(findDailyRooms(data, today, "2026-10-23", today)[0].state).toBe("ready");
    expect(dailyBookingOccupiesDate(data.bookings[0], today, today)).toBe(false);
  });

  it.each([
    { operational_condition: "maintenance" as const },
    { status: "maintenance" as const },
    { operational_condition: "locked" as const },
    { status: "locked" as const },
    { status: "leased" as const },
    { status: "sold" as const, daily_rental_enabled: false },
    { daily_rental_enabled: false },
  ])("respects operational and management restrictions: %j", (overrides) => {
    expect(
      findDailyRooms(snapshot({ dailyUnits: [unit(overrides)] }), today, "2026-10-23", today)[0]
        .state,
    ).toBe("blocked");
  });

  it("permits explicitly managed sold units without changing their ownership", () => {
    const soldUnit = unit({ status: "sold", daily_rental_enabled: true });
    const data = snapshot({ dailyUnits: [soldUnit] });
    expect(findDailyRooms(data, today, "2026-10-23", today)[0].state).toBe("ready");
    expect(soldUnit.status).toBe("sold");
  });

  it.each(["daily_occupied", "reserved"] as const)(
    "does not call %s with no matching booking empty",
    (status) => {
      expect(
        findDailyRooms(snapshot({ dailyUnits: [unit({ status })] }), today, "2026-10-23", today)[0],
      ).toMatchObject({ state: "blocked", reason: "occupancyUnverified" });
    },
  );

  it("does not block today's gap only because a known future reservation changes unit status", () => {
    const data = snapshot({
      dailyUnits: [unit({ status: "reserved" })],
      bookings: [booking({ check_in: "2026-10-25", check_out: "2026-10-27" })],
    });
    expect(findDailyRooms(data, today, "2026-10-23", today)[0].state).toBe("ready");
  });

  it("requires cleaning even when the unit's legacy status says available", () => {
    const data = snapshot({
      cleaningTasks: [
        { id: "clean", unit_id: "unit-101", daily_booking_id: null, is_completed: false },
      ],
    });
    expect(findDailyRooms(data, today, "2026-10-23", today)[0]).toMatchObject({
      state: "conditional",
      reason: "cleaningPending",
    });
  });

  it.each([
    { status: "checked_out", actual_check_out: null },
    { status: "alien" },
    { check_out: null },
    { check_out: "2026-10-19" },
    { actual_check_out: "2026-02-30" },
  ] as Partial<DailyBookingRow>[])(
    "fails closed on ambiguous booking evidence: %j",
    (overrides) => {
      const data = snapshot({ bookings: [booking(overrides)] });
      expect(findDailyRooms(data, today, "2026-10-23", today)[0]).toMatchObject({
        state: "blocked",
        reason: "invalidBookingData",
      });
    },
  );

  it("does not mutate snapshot arrays or records", () => {
    const data = snapshot({ bookings: [booking()] });
    const copy = structuredClone(data);
    buildDailyTasks(data, today, "priority");
    dailyWorkbenchCounts(data, today);
    findDailyRooms(data, today, "2026-10-23", today);
    expect(data).toEqual(copy);
  });
});
