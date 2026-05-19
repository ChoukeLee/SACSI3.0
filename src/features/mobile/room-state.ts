import type { UnitRow, DailyBookingRow, CustomerRow } from "@/types/database";
import type { BillingResult } from "@/features/daily-rentals/billing";
import { calculateBilling } from "@/features/daily-rentals/billing";

export type RoomDisplayStatus =
  | "occupied"
  | "checking_out_today"
  | "cleaning"
  | "available"
  | "other";

export interface RoomState {
  unit: UnitRow;
  booking: DailyBookingRow | null;
  customer: CustomerRow | null;
  billing: BillingResult | null;
  cleaningTask: { id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean } | null;
  displayStatus: RoomDisplayStatus;
  totalPaid: number;
}

/**
 * Compute room state for all daily-rental units.
 * Pure function — no side effects, safe for useMemo.
 */
export function computeRoomStates(
  dailyUnits: UnitRow[],
  bookings: DailyBookingRow[],
  customers: CustomerRow[],
  cleaningTasks: { id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean }[],
  payments: { source_id: string | null; amount: number }[],
  todayStr: string,
): RoomState[] {
  return dailyUnits.map((unit) => {
    // Find active checked-in booking covering today
    const booking =
      bookings.find(
        (b) =>
          b.unit_id === unit.id &&
          b.status === "checked_in" &&
          b.check_in <= todayStr &&
          (b.checkout_mode === "open" || (b.check_out != null && b.check_out >= todayStr)),
      ) ?? null;

    const customer = booking
      ? (customers.find((c) => c.id === booking.customer_id) ?? null)
      : null;

    const billing = booking ? calculateBilling(booking, todayStr) : null;

    const cleaningTask =
      cleaningTasks.find((t) => t.unit_id === unit.id && !t.is_completed) ?? null;

    const unitPayments = booking
      ? payments.filter((p) => p.source_id === booking.id)
      : [];
    const totalPaid = unitPayments.reduce((s, p) => s + Number(p.amount), 0);

    // Determine display status
    let displayStatus: RoomDisplayStatus;
    if (booking) {
      const isCheckingOutToday =
        booking.checkout_mode === "fixed" &&
        booking.check_out === todayStr;
      displayStatus = isCheckingOutToday ? "checking_out_today" : "occupied";
    } else if (cleaningTask) {
      displayStatus = "cleaning";
    } else if (unit.status === "available") {
      displayStatus = "available";
    } else {
      displayStatus = "other";
    }

    return { unit, booking, customer, billing, cleaningTask, displayStatus, totalPaid };
  });
}

export function getOccupiedRooms(states: RoomState[]): RoomState[] {
  return states.filter((s) => s.displayStatus === "occupied");
}

export function getTodayCheckouts(states: RoomState[]): RoomState[] {
  return states.filter((s) => s.displayStatus === "checking_out_today");
}

export function getCleaningRooms(states: RoomState[]): RoomState[] {
  return states.filter((s) => s.displayStatus === "cleaning");
}

export function getAvailableRooms(states: RoomState[]): RoomState[] {
  return states.filter((s) => s.displayStatus === "available");
}

export function getOtherRooms(states: RoomState[]): RoomState[] {
  return states.filter((s) => s.displayStatus === "other");
}

/** All rooms with active bookings or cleaning tasks — the "active" set for the default mobile view */
export function getAllActiveRooms(states: RoomState[]): RoomState[] {
  return states.filter(
    (s) =>
      s.displayStatus === "occupied" ||
      s.displayStatus === "checking_out_today" ||
      s.displayStatus === "cleaning",
  );
}
