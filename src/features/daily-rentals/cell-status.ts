import type { DailyBookingRow } from "@/types/database";

export type CellStatusType =
  | "maintenance"
  | "locked"
  | "occupied"
  | "checking_out_today"
  | "reserved"
  | "cleaning"
  | "available";

export interface CellStatus {
  type: CellStatusType;
  booking: DailyBookingRow | null;
  colorClass: string;
}

const STATUS_COLORS: Record<CellStatusType, string> = {
  maintenance:        "bg-brand-red-100 text-brand-red-700",
  locked:             "bg-brand-red-100 text-brand-red-700",
  occupied:           "bg-brand-orange-200 text-brand-orange-800",
  checking_out_today: "bg-brand-amber-200 text-brand-amber-800",
  reserved:           "bg-amber-200 text-amber-900",
  cleaning:           "bg-brand-sky-100 text-brand-sky-700",
  available:          "",
};

const ACTIVE_PRIORITY: Record<string, number> = {
  checked_in: 3,
  confirmed: 2,
  pending_review: 1,
};

/**
 * Build a booking lookup map: unitId → dateStr → booking.
 *
 * Bookings with active statuses (checked_in, confirmed, pending_review)
 * are processed AFTER inactive ones (checked_out), so active bookings
 * always overwrite inactive ones on overlapping dates.
 *
 * Cancelled bookings are excluded entirely.
 */
export function buildBookingMap(
  bookings: DailyBookingRow[],
  visibleEndExclusiveStr: string,
): Map<string, Map<string, DailyBookingRow>> {
  const sorted = [...bookings].sort((a, b) => {
    const pa = ACTIVE_PRIORITY[a.status] ?? 0;
    const pb = ACTIVE_PRIORITY[b.status] ?? 0;
    return pa - pb;
  });

  const map = new Map<string, Map<string, DailyBookingRow>>();

  for (const b of sorted) {
    if (b.status === "cancelled") continue;
    if (!map.has(b.unit_id)) map.set(b.unit_id, new Map());

    const checkOut: string =
      b.checkout_mode === "open"
        ? (b.actual_check_out ?? visibleEndExclusiveStr)
        : (b.check_out ?? b.check_in);

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

export function getBookingColorClass(booking: DailyBookingRow): string {
  if (booking.status === "checked_in") {
    return booking.checkout_mode === "open"
      ? "bg-brand-amber-200 text-brand-amber-800"
      : STATUS_COLORS.occupied;
  }
  if (booking.status === "confirmed" || booking.status === "pending_review") {
    return STATUS_COLORS.reserved;
  }
  if (booking.status === "checked_out") {
    return "bg-brand-warm-100 text-brand-ink-500";
  }
  return "bg-brand-warm-50 text-brand-ink-300";
}

/**
 * Compute display status for a single room × date cell.
 * Pure function, safe for useMemo / cell-level calls.
 */
export function getCellStatus(params: {
  unitId: string;
  unitStatus: string;
  dateStr: string;
  bookings: DailyBookingRow[];
  cleaningTasks: { unit_id: string; is_completed: boolean }[];
}): CellStatus {
  const { unitId, unitStatus, dateStr, bookings, cleaningTasks } = params;

  // Unit-level blocks
  if (unitStatus === "maintenance") {
    return { type: "maintenance", booking: null, colorClass: STATUS_COLORS.maintenance };
  }
  if (unitStatus === "locked") {
    return { type: "locked", booking: null, colorClass: STATUS_COLORS.locked };
  }

  // Find highest-priority active booking covering this date
  let bestBooking: DailyBookingRow | null = null;
  let bestPriority = -1;

  for (const b of bookings) {
    if (b.unit_id !== unitId || b.status === "cancelled") continue;
    if (dateStr < b.check_in) continue;

    const effEnd: string | null =
      b.checkout_mode === "open" ? b.actual_check_out : b.check_out;
    if (effEnd !== null && dateStr >= effEnd) continue;

    const p = ACTIVE_PRIORITY[b.status] ?? 0;
    if (p > bestPriority) { bestPriority = p; bestBooking = b; }
  }

  if (bestBooking) {
    if (bestBooking.status === "checked_in") {
      const isCheckoutDay =
        bestBooking.checkout_mode === "fixed" && bestBooking.check_out === dateStr;
      return {
        type: isCheckoutDay ? "checking_out_today" : "occupied",
        booking: bestBooking,
        colorClass: isCheckoutDay ? STATUS_COLORS.checking_out_today : STATUS_COLORS.occupied,
      };
    }
    if (bestBooking.status === "confirmed" || bestBooking.status === "pending_review") {
      return { type: "reserved", booking: bestBooking, colorClass: STATUS_COLORS.reserved };
    }
    // checked_out: fall through to cleaning / available
  }

  // Cleaning pending for this unit
  const hasCleaning = cleaningTasks.some(t => t.unit_id === unitId && !t.is_completed);
  if (hasCleaning || unitStatus === "cleaning_pending") {
    return { type: "cleaning", booking: null, colorClass: STATUS_COLORS.cleaning };
  }

  return { type: "available", booking: null, colorClass: "" };
}

/** Parse yyyy-MM-dd as UTC midnight — no local timezone interference. */
function toUtcDate(s: string): Date {
  return new Date(s + "T00:00:00.000Z");
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
