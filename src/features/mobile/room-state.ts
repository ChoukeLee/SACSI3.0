import type { UnitRow, DailyBookingRow, CustomerRow } from "@/types/database";
import type { BillingResult } from "@/features/daily-rentals/billing";
import { calculateBilling } from "@/features/daily-rentals/billing";
import {
  getDailyRoomStateForDate,
  type DailyRoomDisplayStatus,
} from "@/features/daily-rentals/room-status";

export type RoomDisplayStatus = DailyRoomDisplayStatus;

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
 * Compute room state for all daily-rental units on today's date.
 * Delegates to the unified getDailyRoomStateForDate for status logic,
 * then enriches with customer, billing, and payment data.
 *
 * Priority: checked_in > pending_review/confirmed > cleaning > available > maintenance/locked
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
    const state = getDailyRoomStateForDate({ unit, dateStr: todayStr, bookings, cleaningTasks });
    const booking = state.booking;

    const customer = booking
      ? (customers.find((c) => c.id === booking.customer_id) ?? null)
      : null;

    const billing = booking && booking.status === "checked_in"
      ? calculateBilling(booking, todayStr)
      : null;

    const cleaningTask =
      cleaningTasks.find((t) => t.unit_id === unit.id && !t.is_completed) ?? null;

    const unitPayments = booking
      ? payments.filter((p) => p.source_id === booking.id)
      : [];
    const totalPaid = unitPayments.reduce((s, p) => s + Number(p.amount), 0);

    return { unit, booking, customer, billing, cleaningTask, displayStatus: state.status, totalPaid };
  });
}

export function getOccupiedRooms(states: RoomState[]): RoomState[] {
  return states.filter((s) => s.displayStatus === "occupied" || s.displayStatus === "checking_out_today");
}

export function getTodayCheckouts(states: RoomState[]): RoomState[] {
  return states.filter((s) => s.displayStatus === "checking_out_today");
}

export function getReservedRooms(states: RoomState[]): RoomState[] {
  return states.filter((s) => s.displayStatus === "reserved");
}

export function getCleaningRooms(states: RoomState[]): RoomState[] {
  return states.filter((s) => s.displayStatus === "cleaning");
}

export function getAvailableRooms(states: RoomState[]): RoomState[] {
  return states.filter((s) => s.displayStatus === "available");
}

export function getOtherRooms(states: RoomState[]): RoomState[] {
  return states.filter(
    (s) => s.displayStatus === "maintenance" || s.displayStatus === "locked",
  );
}

/** All rooms with active bookings, pending reservations, or cleaning tasks */
export function getAllActiveRooms(states: RoomState[]): RoomState[] {
  return states.filter(
    (s) =>
      s.displayStatus === "occupied" ||
      s.displayStatus === "checking_out_today" ||
      s.displayStatus === "reserved" ||
      s.displayStatus === "cleaning",
  );
}
