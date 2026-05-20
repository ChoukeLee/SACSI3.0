import type { UnitRow, DailyBookingRow } from "@/types/database";

// ── Types ──────────────────────────────────────────────────────────────

export type DailyRoomDisplayStatus =
  | "maintenance"
  | "locked"
  | "occupied"
  | "checking_out_today"
  | "reserved"
  | "cleaning"
  | "available";

export interface DailyRoomStateForDate {
  unit: UnitRow;
  status: DailyRoomDisplayStatus;
  booking: DailyBookingRow | null;
  isCheckoutDay: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────

const ACTIVE_PRIORITY: Record<string, number> = {
  checked_in: 3,
  confirmed: 2,
  pending_review: 1,
};

export const STATUS_COLORS: Record<DailyRoomDisplayStatus, string> = {
  maintenance:        "bg-brand-red-100 text-brand-red-700",
  locked:             "bg-brand-red-100 text-brand-red-700",
  occupied:           "bg-brand-orange-200 text-brand-orange-800",
  checking_out_today: "bg-brand-amber-200 text-brand-amber-800",
  reserved:           "bg-amber-200 text-amber-900",
  cleaning:           "bg-brand-sky-100 text-brand-sky-700",
  available:          "",
};

// ── Core: single unit × single date ────────────────────────────────────

/**
 * Compute display status for one room on one date.
 *
 * Priority:
 *   1. checked_in booking covering date → occupied / checking_out_today
 *   2. confirmed / pending_review booking covering date → reserved
 *   3. early check-in: unit is daily_occupied + checked_in exists → occupied
 *   4. unit.status = maintenance → maintenance
 *   5. unit.status = locked → locked
 *   6. cleaning pending → cleaning
 *   7. available
 */
export function getDailyRoomStateForDate(params: {
  unit: UnitRow;
  dateStr: string;
  bookings: DailyBookingRow[];
  cleaningTasks: { unit_id: string; is_completed: boolean }[];
}): DailyRoomStateForDate {
  const { unit, dateStr, bookings, cleaningTasks } = params;

  const unitBookings = bookings.filter(b => b.unit_id === unit.id && b.status !== "cancelled");

  // 1-2. Find best booking covering this date
  let bestBooking: DailyBookingRow | null = null;
  let bestPriority = -1;

  for (const b of unitBookings) {
    if (!coversDate(b, dateStr)) continue;
    const p = ACTIVE_PRIORITY[b.status] ?? 0;
    if (p > bestPriority) { bestPriority = p; bestBooking = b; }
  }

  if (bestBooking) {
    if (bestBooking.status === "checked_in") {
      const isCO = bestBooking.checkout_mode === "fixed" && bestBooking.check_out === dateStr;
      return { unit, status: isCO ? "checking_out_today" : "occupied", booking: bestBooking, isCheckoutDay: isCO };
    }
    if (bestBooking.status === "confirmed" || bestBooking.status === "pending_review") {
      return { unit, status: "reserved", booking: bestBooking, isCheckoutDay: false };
    }
    // checked_out: fall through to unit-level checks
  }

  // 3. Early check-in: unit is daily_occupied with a checked_in booking (guest arrived before official check_in)
  if (unit.status === "daily_occupied") {
    const checkedInB = unitBookings.find(b => b.status === "checked_in");
    if (checkedInB) {
      return { unit, status: "occupied", booking: checkedInB, isCheckoutDay: false };
    }
  }

  // 4-5. Unit-level blocks (only when no active booking)
  if (unit.status === "maintenance") {
    return { unit, status: "maintenance", booking: null, isCheckoutDay: false };
  }
  if (unit.status === "locked") {
    return { unit, status: "locked", booking: null, isCheckoutDay: false };
  }

  // 6. Cleaning
  const hasPendingCleaning = cleaningTasks.some(t => t.unit_id === unit.id && !t.is_completed);
  if (hasPendingCleaning || unit.status === "cleaning_pending") {
    return { unit, status: "cleaning", booking: null, isCheckoutDay: false };
  }

  // 7. Available
  return { unit, status: "available", booking: null, isCheckoutDay: false };
}

// ── Batch: all units × single date ─────────────────────────────────────

/**
 * Compute display status for all daily-rental units on a single date.
 * Returns Map<unitId, DailyRoomStateForDate>.
 */
export function buildDailyRoomStateMap(params: {
  dailyUnits: UnitRow[];
  dateStr: string;
  bookings: DailyBookingRow[];
  cleaningTasks: { unit_id: string; is_completed: boolean }[];
}): Map<string, DailyRoomStateForDate> {
  const { dailyUnits, dateStr, bookings, cleaningTasks } = params;
  const map = new Map<string, DailyRoomStateForDate>();
  for (const unit of dailyUnits) {
    map.set(unit.id, getDailyRoomStateForDate({ unit, dateStr, bookings, cleaningTasks }));
  }
  return map;
}

// ── Booking map builder (calendar grid) ─────────────────────────────────

interface BuildBookingMapOptions {
  todayStr: string;
  tomorrowStr: string;
  visibleEndExclusiveStr: string;
}

/**
 * Build a booking lookup map: unitId → dateStr → booking.
 *
 * Calendar visual rules for OPEN bookings (no fixed check_out):
 *   - checked_in + no actual_check_out → from check_in to TODAY (not beyond)
 *   - pending_review / confirmed + open → just check_in day (one cell)
 *   - checked_out + open + actual_check_out → full recorded range
 *
 * Active statuses (checked_in, confirmed, pending_review) are processed
 * LAST so they overwrite inactive ones (checked_out) on overlapping dates.
 * Cancelled bookings are excluded.
 *
 * NOTE: this only affects calendar rendering.
 * Business occupancy (coversDate) is NOT affected — open bookings still
 * count as occupying indefinitely for conflict detection and overview.
 */
export function buildBookingMap(
  bookings: DailyBookingRow[],
  options: BuildBookingMapOptions,
): Map<string, Map<string, DailyBookingRow>> {
  const { todayStr } = options;

  const sorted = [...bookings].sort((a, b) => {
    const pa = ACTIVE_PRIORITY[a.status] ?? 0;
    const pb = ACTIVE_PRIORITY[b.status] ?? 0;
    return pa - pb;
  });

  const map = new Map<string, Map<string, DailyBookingRow>>();

  for (const b of sorted) {
    if (b.status === "cancelled") continue;
    if (!map.has(b.unit_id)) map.set(b.unit_id, new Map());

    const checkOut: string = resolveCalendarCheckOut(b, options);
    const start = toUtcDate(b.check_in);
    const end = toUtcDate(checkOut);
    if (b.checkout_mode === "fixed") end.setUTCDate(end.getUTCDate() + 1);

    const cursor = new Date(start);
    while (cursor < end) {
      map.get(b.unit_id)!.set(toDateStr(cursor), b);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  return map;
}

/**
 * Compute the calendar display end date for a single booking.
 *
 * OPEN mode rules (calendar only — does NOT affect coversDate):
 *   - checked_in + actual_check_out set   → check_in … actual_check_out
 *   - checked_in + actual_check_out null  → check_in … today (inclusive)
 *   - pending_review / confirmed + open   → check_in only (one cell)
 *   - checked_out + open + actual_check_out → full recorded range
 *   - checked_out + open + no actual      → check_in only (fallback)
 */
function resolveCalendarCheckOut(
  b: DailyBookingRow,
  opts: BuildBookingMapOptions,
): string {
  const { todayStr, visibleEndExclusiveStr } = opts;

  if (b.checkout_mode !== "open") {
    // Fixed: strictly bounded by check_out
    return b.check_out ?? b.check_in;
  }

  // ── Open mode: visual-only rules ──

  // checked_in with actual_check_out → show the recorded range
  if (b.status === "checked_in" && b.actual_check_out) {
    return b.actual_check_out;
  }

  // checked_in without actual_check_out → from check_in to today (inclusive)
  if (b.status === "checked_in") {
    // "today" inclusive: we want to show today's cell, so end = tomorrow
    return b.check_in <= todayStr ? opts.tomorrowStr : b.check_in;
  }

  // pending_review / confirmed → just the check_in day (one cell)
  if (b.status === "pending_review" || b.status === "confirmed") {
    return b.check_in;
  }

  // checked_out with actual_check_out → recorded range
  if (b.status === "checked_out" && b.actual_check_out) {
    return b.actual_check_out;
  }

  // checked_out without actual → just check_in (one cell, as historical record)
  if (b.status === "checked_out") {
    return b.check_in;
  }

  // Fallback: check_in day only
  return b.check_in;
}

export function getBookingColorClass(booking: DailyBookingRow): string {
  // Aligned with Natural Professional STATUS_CELL earth-tone palette
  if (booking.status === "checked_in") {
    return "bg-orange-500 text-white";
  }
  if (booking.status === "confirmed" || booking.status === "pending_review") {
    return "bg-sky-500 text-white";
  }
  if (booking.status === "checked_out") {
    return "bg-slate-100 text-slate-500";
  }
  return "bg-slate-50 text-slate-400";
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Does this booking cover the given date? */
function coversDate(b: DailyBookingRow, dateStr: string): boolean {
  if (dateStr < b.check_in) return false;

  if (b.checkout_mode === "open") {
    if (b.actual_check_out !== null && dateStr >= b.actual_check_out) return false;
    return true;
  }

  // fixed: departure date is included (guest occupies until checkout time)
  if (b.check_out !== null && dateStr > b.check_out) return false;
  return true;
}

function toUtcDate(s: string): Date {
  return new Date(s + "T00:00:00.000Z");
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
