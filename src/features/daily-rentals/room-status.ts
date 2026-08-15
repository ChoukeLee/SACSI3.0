import type { UnitRow, DailyBookingRow } from "@/types/database";
import {
  bookingOccupiesDate,
  type DailyRoomDisplayStatus,
} from "./daily-rental-policy";

// Types.

export interface DailyRoomStateForDate {
  unit: UnitRow;
  status: DailyRoomDisplayStatus;
  booking: DailyBookingRow | null;
  isCheckoutDay: boolean;
}

// Constants.

const ACTIVE_PRIORITY: Record<string, number> = {
  checked_in: 3,
  confirmed: 2,
  pending_review: 1,
};

export const STATUS_COLORS: Record<DailyRoomDisplayStatus, string> = {
  maintenance:        "bg-[#FFE2EA] text-[#17324D] border border-[#F5C0CC]",
  locked:             "bg-muted text-muted-foreground border border-border",
  occupied:           "bg-[#62B6F5]/10 text-[#1A6090] border border-[#62B6F5]/20",
  checking_out_today: "bg-amber-50 text-amber-700 border border-amber-200",
  reserved:           "bg-[#FFF6D8] text-[#17324D] border border-[#E8D5A0]/60",
  cleaning:           "bg-[#D9F7F0] text-[#17324D] border border-[#A8E8DB]",
  available:          "",
};

// Core room-state calculation.

/**
 * Compute display status for one room on one date.
 *
 * Priority:
 *   1. checked_in booking covering date : occupied / checking_out_today
 *   2. confirmed / pending_review booking covering date : reserved
 *   3. early check-in: unit is daily_occupied + checked_in exists : occupied
 *   4. unit.status = maintenance : maintenance
 *   5. unit.status = locked : locked
 *   6. cleaning pending : cleaning
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

  // ── Priority: checked_in > cleaning > confirmed/pending_review > checked_out > available ──

  // 1. Find best booking covering this date
  let bestBooking: DailyBookingRow | null = null;
  let bestPriority = -1;

  for (const b of unitBookings) {
    if (!coversDisplayDate(b, dateStr)) continue;
    const p = ACTIVE_PRIORITY[b.status] ?? 0;
    if (p > bestPriority) { bestPriority = p; bestBooking = b; }
  }

  // 1a. Active checked_in guest — highest priority
  if (bestBooking && bestBooking.status === "checked_in") {
    const isCO = bestBooking.checkout_mode === "fixed" && bestBooking.check_out === dateStr;
    return { unit, status: isCO ? "checking_out_today" : "occupied", booking: bestBooking, isCheckoutDay: isCO };
  }

  // 1b. Early check-in (unit status says occupied but booking may have earlier check_in)
  if (unit.status === "daily_occupied") {
    const checkedInB = unitBookings.find(b => b.status === "checked_in");
    if (checkedInB) {
      return { unit, status: "occupied", booking: checkedInB, isCheckoutDay: false };
    }
  }

  // 2. Cleaning pending — takes priority over future bookings
  const hasPendingCleaning = cleaningTasks.some(t => t.unit_id === unit.id && !t.is_completed);
  const pendingCleaningTask = cleaningTasks.find(t => t.unit_id === unit.id && !t.is_completed);
  if (hasPendingCleaning || unit.status === "cleaning_pending") {
    // If a confirmed/pending_review booking exists for today, include it as context
    // so the calendar can show the guest name alongside the cleaning status.
    const upcomingBooking = bestBooking && (bestBooking.status === "confirmed" || bestBooking.status === "pending_review")
      ? bestBooking : null;
    return { unit, status: "cleaning", booking: upcomingBooking, isCheckoutDay: false };
  }

  // 3. Confirmed/pending_review — only shown when no cleaning is pending
  if (bestBooking && (bestBooking.status === "confirmed" || bestBooking.status === "pending_review")) {
    return { unit, status: "reserved", booking: bestBooking, isCheckoutDay: false };
  }

  // 4-5. Unit-level blocks
  if (unit.status === "maintenance") {
    return { unit, status: "maintenance", booking: null, isCheckoutDay: false };
  }
  if (unit.status === "locked") {
    return { unit, status: "locked", booking: null, isCheckoutDay: false };
  }

  // 6. Available (includes checked_out historical bookings — no display impact)
  return { unit, status: "available", booking: null, isCheckoutDay: false };
}

// Batch room-state calculation.

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

// Booking map builder for the calendar grid.

interface BuildBookingMapOptions {
  todayStr: string;
  tomorrowStr: string;
}

/**
 * Build a booking lookup map: unitId : dateStr : booking.
 *
 * Calendar visual rules for OPEN bookings (no fixed check_out):
 *   - checked_in + no actual_check_out : from check_in to TODAY (not beyond)
 *   - pending_review / confirmed + open : just check_in day (one cell)
 *   - checked_out + open + actual_check_out : full recorded range
 *
 * Active statuses (checked_in, confirmed, pending_review) are processed
 * LAST so they overwrite inactive ones (checked_out) on overlapping dates.
 * Cancelled bookings are excluded.
 *
 * NOTE: this only affects calendar rendering.
 * Business occupancy (coversDate) is NOT affected - open bookings still
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
    if (b.checkout_mode === "fixed" && b.status !== "checked_out") {
      end.setUTCDate(end.getUTCDate() + 1);
    }

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
 * OPEN mode rules (calendar only - does NOT affect coversDate):
 *   - checked_in + actual_check_out set   : check_in  through  actual_check_out
 *   - checked_in + actual_check_out null  : check_in  through  today (inclusive)
 *   - pending_review / confirmed + open   : check_in only (one cell)
 *   - checked_out + open + actual_check_out : full recorded range
 *   - checked_out + open + no actual      : check_in only (fallback)
 */
function resolveCalendarCheckOut(
  b: DailyBookingRow,
  opts: BuildBookingMapOptions,
): string {
  const { todayStr } = opts;

  // A completed stay must stop on the recorded departure date, not on the
  // original reservation end date.
  if (b.status === "checked_out" && b.actual_check_out) {
    return b.actual_check_out;
  }

  if (b.checkout_mode !== "open") {
    // Fixed: strictly bounded by check_out
    return b.check_out ?? b.check_in;
  }

  // Open mode: visual-only rules.

  // checked_in with actual_check_out : show the recorded range
  if (b.status === "checked_in" && b.actual_check_out) {
    return b.actual_check_out;
  }

  // checked_in without actual_check_out : from check_in to today (inclusive)
  if (b.status === "checked_in") {
    // "today" inclusive: we want to show today's cell, so end = tomorrow
    return b.check_in <= todayStr ? opts.tomorrowStr : addDays(b.check_in, 1);
  }

  // pending_review / confirmed : just the check_in day (one cell)
  if (b.status === "pending_review" || b.status === "confirmed") {
    return addDays(b.check_in, 1);
  }

  // checked_out with actual_check_out : recorded range including checkout day.
  // Some open-ended historical records have check_in === actual_check_out;
  // keep at least one visible cell so the calendar does not swallow them.
  if (b.status === "checked_out" && b.actual_check_out) {
    return addDays(b.actual_check_out, 1);
  }

  // checked_out without actual : just check_in (one cell, as historical record)
  if (b.status === "checked_out") {
    return addDays(b.check_in, 1);
  }

  // Fallback: check_in day only
  return addDays(b.check_in, 1);
}

export function getBookingColorClass(booking: DailyBookingRow): string {
  // Aligned with Natural Professional STATUS_CELL earth-tone palette
  if (booking.status === "checked_in") {
    return "bg-[#62B6F5] text-white";
  }
  if (booking.status === "confirmed" || booking.status === "pending_review") {
    return "bg-[#5CC4B8] text-white";
  }
  if (booking.status === "checked_out") {
    return "bg-muted text-muted-foreground";
  }
  return "bg-muted/50 text-muted-foreground/70";
}

// Helpers.

/** Does this booking need to appear on the room-state display for this date? */
function coversDisplayDate(b: DailyBookingRow, dateStr: string): boolean {
  if (bookingOccupiesDate(b, dateStr)) return true;

  // Fixed checked-in bookings should still appear on checkout day so the
  // front desk can see the "checking out today" state before cleaning.
  return b.status === "checked_in" && b.checkout_mode === "fixed" && b.check_out === dateStr;
}

function toUtcDate(s: string): Date {
  return new Date(s + "T00:00:00.000Z");
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const date = toUtcDate(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateStr(date);
}
