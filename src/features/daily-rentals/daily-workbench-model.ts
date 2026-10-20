import type { DailyBookingRow, UnitRow } from "@/types/database";
import type { CalendarWindowData } from "./calendar-window-model";
import type { CustomerSummary } from "./customer-summary";
import { allowCreateBooking } from "./daily-rental-policy";

export type DailyTaskFilter =
  "priority" | "arrivals" | "inhouse" | "departures" | "cleaning" | "collection";

export interface DailyWorkbenchTask {
  id: string;
  unit: UnitRow;
  booking: DailyBookingRow | null;
  /** Booking contact, never inferred from the guest or the logged-in user. */
  customer: CustomerSummary | null;
  kind: "arrival" | "inhouse" | "departure" | "cleaning" | "collection" | "review";
}

export type DailyRoomAvailabilityReason =
  | "ready"
  | "futureHandover"
  | "cleaningPending"
  | "readinessUnverified"
  | "occupancyUnverified"
  | "bookingConflict"
  | "openCheckout"
  | "invalidBookingData"
  | "incompleteWindow"
  | "invalidDateRange"
  | "pastDateNotAllowed"
  | "dailyRentalDisabled"
  | "unitMaintenance"
  | "unitLocked"
  | "saleConflict"
  | "longLeaseConflict";

export interface DailyRoomAvailability {
  unit: UnitRow;
  state: "ready" | "conditional" | "blocked";
  reason: DailyRoomAvailabilityReason;
  conflicts: DailyBookingRow[];
}

const activeStatuses = new Set(["pending_review", "confirmed", "checked_in"]);
const knownStatuses = new Set([...activeStatuses, "checked_out", "cancelled"]);

function validDate(value: string | null | undefined): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

function unitIndex(data: CalendarWindowData) {
  return new Map(
    [...data.unitLookupUnits, ...data.dailyUnits]
      .filter((unit) => unit.building_id === data.buildingId)
      .map((unit) => [unit.id, unit]),
  );
}

function currentStay(booking: DailyBookingRow, today: string) {
  return (
    booking.status === "checked_in" &&
    validDate(booking.check_in) &&
    booking.check_in <= today &&
    (!booking.actual_check_out || booking.actual_check_out > today)
  );
}

function dueDeparture(booking: DailyBookingRow, today: string) {
  return (
    currentStay(booking, today) &&
    booking.checkout_mode === "fixed" &&
    validDate(booking.check_out) &&
    booking.check_out <= today
  );
}

function dueArrival(booking: DailyBookingRow, today: string) {
  return (
    (booking.status === "confirmed" || booking.status === "pending_review") &&
    validDate(booking.check_in) &&
    booking.check_in <= today &&
    !booking.actual_check_out
  );
}

function sortedTasks(tasks: DailyWorkbenchTask[]) {
  const order: Record<DailyWorkbenchTask["kind"], number> = {
    review: 0,
    departure: 1,
    arrival: 2,
    cleaning: 3,
    collection: 4,
    inhouse: 5,
  };
  return tasks.sort(
    (a, b) =>
      order[a.kind] - order[b.kind] ||
      a.unit.code.localeCompare(b.unit.code, undefined, { numeric: true }) ||
      a.id.localeCompare(b.id),
  );
}

/** Task scopes come from the building snapshot, not global inventory totals. */
export function buildDailyTasks(
  data: CalendarWindowData,
  today: string,
  filter: DailyTaskFilter,
): DailyWorkbenchTask[] {
  if (!validDate(today)) return [];
  const units = unitIndex(data);
  const customers = new Map((data.customers ?? []).map((customer) => [customer.id, customer]));
  const bookings = [...new Map(data.bookings.map((booking) => [booking.id, booking])).values()];
  const tasks: DailyWorkbenchTask[] = [];
  const add = (kind: DailyWorkbenchTask["kind"], booking: DailyBookingRow, id = booking.id) => {
    const unit = units.get(booking.unit_id);
    if (!unit || booking.status === "cancelled") return;
    tasks.push({
      id: `${kind}:${id}`,
      unit,
      booking,
      customer: customers.get(booking.booking_agent_id ?? booking.customer_id) ?? null,
      kind,
    });
  };

  for (const booking of bookings) {
    if ((filter === "priority" || filter === "arrivals") && dueArrival(booking, today)) {
      add(booking.check_in < today ? "review" : "arrival", booking);
    }
    if (filter === "inhouse" && currentStay(booking, today)) {
      add(dueDeparture(booking, today) ? "departure" : "inhouse", booking);
    }
    if ((filter === "priority" || filter === "departures") && dueDeparture(booking, today)) {
      add("departure", booking);
    }
    // A billing-status marker is a follow-up signal, not a verified receivable
    // balance. Neither prepaid_amount nor order-minus-payments establishes debt.
    // Keep historical finance follow-up in its own tab, not today's operations.
    if (
      filter === "collection" &&
      (booking.status === "checked_in" || booking.status === "checked_out") &&
      (booking.billing_status === "need_top_up" || booking.billing_status === "partially_paid")
    ) {
      add("collection", booking);
    }
    if (
      filter === "priority" &&
      booking.status === "checked_in" &&
      (!validDate(booking.check_in) ||
        booking.check_in > today ||
        (booking.actual_check_out && booking.actual_check_out <= today))
    ) {
      add("review", booking);
    }
  }

  if (filter === "priority" || filter === "cleaning") {
    const pending = data.cleaningTasks.filter((task) => !task.is_completed);
    const pendingUnits = new Set([
      ...pending.map((task) => task.unit_id),
      ...[...units.values()]
        .filter((unit) => unit.status === "cleaning_pending")
        .map((unit) => unit.id),
    ]);
    for (const unitId of pendingUnits) {
      const unit = units.get(unitId);
      if (!unit) continue;
      const linked = pending.find((task) => task.unit_id === unitId && task.daily_booking_id);
      const booking =
        bookings.find(
          (row) =>
            row.id === linked?.daily_booking_id &&
            row.unit_id === unitId &&
            row.status !== "cancelled",
        ) ?? null;
      tasks.push({
        id: `cleaning:${unitId}`,
        unit,
        booking,
        customer: booking
          ? (customers.get(booking.booking_agent_id ?? booking.customer_id) ?? null)
          : null,
        kind: "cleaning",
      });
    }
  }
  return sortedTasks(tasks);
}

export function dailyWorkbenchCounts(data: CalendarWindowData, today: string) {
  return {
    arrivals: buildDailyTasks(data, today, "arrivals").length,
    inhouse: buildDailyTasks(data, today, "inhouse").length,
    departures: buildDailyTasks(data, today, "departures").length,
    cleaning: buildDailyTasks(data, today, "cleaning").length,
  };
}

/** Checkout is exclusive; a planned date never checks an active guest out. */
export function dailyBookingOccupiesDate(
  booking: DailyBookingRow,
  date: string,
  today: string,
): boolean {
  if (!validDate(date) || !validDate(today) || !validDate(booking.check_in)) return false;
  if (booking.status === "cancelled" || !knownStatuses.has(booking.status)) return false;
  if (date < booking.check_in) return false;
  if (validDate(booking.actual_check_out)) return date < booking.actual_check_out;
  // Overdue checked_in is actual operational evidence, not an empty room.
  // A still-future fixed checkout can bound planning, not current readiness.
  if (booking.status === "checked_in") {
    if (
      booking.checkout_mode === "fixed" &&
      validDate(booking.check_out) &&
      booking.check_out > today
    )
      return date < booking.check_out;
    return true;
  }
  if (booking.status === "checked_out") return false;
  if (booking.checkout_mode === "open") return true;
  return validDate(booking.check_out) && date < booking.check_out;
}

/** The loaded booking window must cover the whole half-open search interval. */
export function dailyWindowCoversInterval(data: CalendarWindowData, from: string, to: string) {
  const units = unitIndex(data);
  return (
    validDate(from) &&
    validDate(to) &&
    from < to &&
    validDate(data.from) &&
    validDate(data.to) &&
    data.from <= from &&
    data.to >= to &&
    data.bookingCount === data.bookings.length &&
    new Set(data.bookings.map((booking) => booking.id)).size === data.bookings.length &&
    [...data.unitLookupUnits, ...data.dailyUnits].every(
      (unit) => unit.building_id === data.buildingId,
    ) &&
    data.bookings.every((booking) => units.has(booking.unit_id))
  );
}

function invalidBooking(booking: DailyBookingRow, today: string) {
  if (booking.status === "cancelled") return false;
  if (!knownStatuses.has(booking.status) || !validDate(booking.check_in)) return true;
  if (booking.checkout_mode !== "fixed" && booking.checkout_mode !== "open") return true;
  if (
    booking.actual_check_out &&
    (!validDate(booking.actual_check_out) || booking.actual_check_out < booking.check_in)
  )
    return true;
  if (booking.status === "checked_out") return !validDate(booking.actual_check_out);
  if (booking.status === "checked_in" && booking.check_in > today) return true;
  if (
    booking.status === "checked_in" &&
    booking.actual_check_out &&
    booking.actual_check_out <= today
  )
    return true;
  if (booking.checkout_mode === "fixed")
    return !validDate(booking.check_out) || booking.check_out <= booking.check_in;
  return false;
}

function overlaps(booking: DailyBookingRow, from: string, to: string, today: string) {
  if (booking.status === "cancelled" || booking.check_in >= to) return false;
  const end =
    booking.actual_check_out ??
    (booking.checkout_mode === "open" ||
    (booking.status === "checked_in" && (!booking.check_out || booking.check_out <= today))
      ? null
      : booking.check_out);
  return end === null || end > from;
}

/** Availability is advice only. Booking/check-in actions still run server policy. */
export function findDailyRooms(
  data: CalendarWindowData,
  from: string,
  to: string,
  today: string,
): DailyRoomAvailability[] {
  let invalid: DailyRoomAvailabilityReason | undefined;
  if (!validDate(today) || !validDate(from) || !validDate(to) || from >= to)
    invalid = "invalidDateRange";
  else if (from < today) invalid = "pastDateNotAllowed";
  else if (data.today !== today || !dailyWindowCoversInterval(data, from, to))
    invalid = "incompleteWindow";
  const rooms = [...new Map(data.dailyUnits.map((unit) => [unit.id, unit])).values()].filter(
    (unit) => unit.building_id === data.buildingId,
  );
  return rooms.map((unit) => {
    const result = (
      state: DailyRoomAvailability["state"],
      reason: DailyRoomAvailabilityReason,
      conflicts: DailyBookingRow[] = [],
    ): DailyRoomAvailability => ({ unit, state, reason, conflicts });
    if (invalid) return result("blocked", invalid);
    const policy = allowCreateBooking({
      checkIn: from,
      checkOut: to,
      todayStr: today,
      checkoutMode: "fixed",
      unitStatus: unit.status,
      dailyRentalEnabled: unit.daily_rental_enabled,
      operationalCondition: unit.operational_condition,
    });
    if (!policy.allowed) {
      const reason = policy.reason as DailyRoomAvailabilityReason;
      return result("blocked", reason);
    }
    if (unit.daily_rental_enabled === false) return result("blocked", "dailyRentalDisabled");
    const bookings = data.bookings.filter((booking) => booking.unit_id === unit.id);
    const invalidBookings = bookings.filter((booking) => invalidBooking(booking, today));
    if (invalidBookings.length) return result("blocked", "invalidBookingData", invalidBookings);
    const conflicts = bookings.filter((booking) => overlaps(booking, from, to, today));
    if (conflicts.length) {
      return result(
        "blocked",
        conflicts.some((booking) => booking.checkout_mode === "open" && !booking.actual_check_out)
          ? "openCheckout"
          : "bookingConflict",
        conflicts,
      );
    }
    if (
      unit.status === "daily_occupied" &&
      !bookings.some(
        (booking) =>
          booking.status === "checked_in" &&
          booking.checkout_mode === "fixed" &&
          !booking.actual_check_out &&
          validDate(booking.check_out) &&
          booking.check_out > today &&
          booking.check_out <= from,
      )
    )
      return result("blocked", "occupancyUnverified");
    if (
      unit.status === "reserved" &&
      !bookings.some((booking) => activeStatuses.has(booking.status))
    )
      return result("blocked", "occupancyUnverified");
    if (
      unit.status === "cleaning_pending" ||
      data.cleaningTasks.some((task) => task.unit_id === unit.id && !task.is_completed)
    )
      return result("conditional", "cleaningPending");
    if (unit.operational_condition !== "normal" || unit.daily_rental_enabled !== true)
      return result("conditional", "readinessUnverified");
    if (from > today) return result("conditional", "futureHandover");
    return result("ready", "ready");
  });
}
