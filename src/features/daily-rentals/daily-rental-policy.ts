import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyBookingRow } from "@/types/database";
import type { UnitStatus } from "@/types/domain";

// Unified action type: single source of truth for button logic.

export type DailyPrimaryAction =
  | "create_booking"
  | "confirm"
  | "check_in"
  | "check_out"
  | "complete_cleaning"
  | "view_settlement"
  | "readonly";

export interface GetPrimaryActionInput {
  bookingStatus?: DailyBookingStatus | null;
  roomDisplayStatus?: DailyRoomDisplayStatus;
  hasOpenCleaningTask?: boolean;
  isPastDate?: boolean;
  unitStatus?: UnitStatus | null;
}

export function getPrimaryDailyAction(input: GetPrimaryActionInput): {
  action: DailyPrimaryAction; allowed: boolean; reason?: string;
} {
  const {
    bookingStatus, roomDisplayStatus, hasOpenCleaningTask,
    isPastDate, unitStatus,
  } = input;

  // Unit-level blocks: sold / leased / maintenance / locked.
  if (unitStatus === "sold" || unitStatus === "maintenance" || unitStatus === "locked") {
    return { action: "readonly", allowed: false, reason: `unit_${unitStatus}` };
  }
  if (unitStatus === "leased") {
    return { action: "readonly", allowed: false, reason: "unit_leased" };
  }

  // No booking: create if the room display state allows it.
  if (!bookingStatus || bookingStatus === "cancelled") {
    if (roomDisplayStatus) {
      if (roomDisplayStatus === "maintenance" || roomDisplayStatus === "locked") {
        return { action: "readonly", allowed: false, reason: "room_blocked" };
      }
      if (roomDisplayStatus === "cleaning") {
        return { action: "complete_cleaning", allowed: true };
      }
      if (roomDisplayStatus === "occupied" || roomDisplayStatus === "checking_out_today" || roomDisplayStatus === "reserved") {
        return { action: "readonly", allowed: false, reason: "room_occupied_or_reserved" };
      }
    }
    // Past date + no existing booking: normal bookings are not allowed.
    if (isPastDate) {
      return { action: "readonly", allowed: false, reason: "past_date_no_booking" };
    }
    // Cleaning pending on unit
    if (hasOpenCleaningTask) {
      return { action: "complete_cleaning", allowed: true };
    }
    return { action: "create_booking", allowed: true };
  }

  // Has a booking: map the primary action by status.
  switch (bookingStatus) {
    case "pending_review":
      return { action: "confirm", allowed: true };

    case "confirmed":
      // Cannot check in while cleaning is pending on the unit
      if (hasOpenCleaningTask) {
        return { action: "complete_cleaning", allowed: true };
      }
      return { action: "check_in", allowed: true };

    case "checked_in":
      return { action: "check_out", allowed: true };

    case "checked_out":
      if (hasOpenCleaningTask) {
        return { action: "complete_cleaning", allowed: true };
      }
      return { action: "view_settlement", allowed: true };

    default:
      // Cancelled or any other unhandled status: readonly.
      return { action: "readonly", allowed: false, reason: bookingStatus === "cancelled" ? "booking_cancelled" : "unknown_status" };
  }
}

// Original types, extended below.

export type DailyBookingStatus =
  | "pending_review"
  | "confirmed"
  | "checked_in"
  | "checked_out"
  | "cancelled";

export type DailyRoomDisplayStatus =
  | "maintenance"
  | "locked"
  | "occupied"
  | "checking_out_today"
  | "reserved"
  | "cleaning"
  | "available";

export const DAILY_ROOM_STATUS_PRIORITY: Record<DailyRoomDisplayStatus, number> = {
  maintenance: 60,
  locked: 60,
  occupied: 50,
  checking_out_today: 50,
  reserved: 40,
  cleaning: 30,
  available: 10,
};

export type PolicyResult = { allowed: true } | { allowed: false; reason: string };

export interface DailyBookingActionState {
  canConfirm: boolean;
  canCancel: boolean;
  canCheckIn: boolean;
  canTakePayment: boolean;
  canCheckOut: boolean;
  canUseAdvancedActions: boolean;
  canCompleteCleaning: boolean;
  isReadonly: boolean;
}

export interface CreateBookingPolicyInput {
  checkIn: string;
  checkOut?: string;
  checkoutMode?: "fixed" | "open";
  todayStr?: string;
  isBackfill?: boolean;
  unitStatus?: UnitStatus | null;
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function allowCreateBooking(input: CreateBookingPolicyInput): PolicyResult {
  const checkIn = input.checkIn;
  const mode = input.checkoutMode ?? "fixed";
  const today = input.todayStr ?? todayIso();

  if (!checkIn) return { allowed: false, reason: "checkInRequired" };

  // Unit-level blocks.
  if (input.unitStatus) {
    if (input.unitStatus === "maintenance") return { allowed: false, reason: "unitMaintenance" };
    if (input.unitStatus === "locked") return { allowed: false, reason: "unitLocked" };
    if (input.unitStatus === "sold") return { allowed: false, reason: "saleConflict" };
    if (input.unitStatus === "leased") return { allowed: false, reason: "longLeaseConflict" };
  }

  // Date checks.
  if (!input.isBackfill && checkIn < today) return { allowed: false, reason: "pastDateNotAllowed" };

  if (mode === "fixed") {
    if (!input.checkOut) return { allowed: false, reason: "checkOutRequired" };
    if (input.checkOut <= checkIn) return { allowed: false, reason: "invalidDateRange" };
  }

  return { allowed: true };
}

export function allowConfirmBooking(booking: Pick<DailyBookingRow, "status">): PolicyResult {
  if (booking.status !== "pending_review") return { allowed: false, reason: "bookingNotPendingReview" };
  return { allowed: true };
}

export interface CheckInPolicyInput {
  booking: Pick<DailyBookingRow, "status" | "checkout_mode">;
  prepaidAmount: number;
  hasOpenCleaningTask?: boolean;
  otherCheckedInCount?: number;
  unitStatus?: UnitStatus | null;
}

export function allowCheckIn(input: CheckInPolicyInput): PolicyResult {
  const { booking, prepaidAmount, hasOpenCleaningTask, otherCheckedInCount, unitStatus } = input;

  if (booking.status !== "confirmed") return { allowed: false, reason: "bookingNotConfirmed" };

  // Unit-level blocks
  if (unitStatus) {
    if (unitStatus === "maintenance") return { allowed: false, reason: "unitMaintenance" };
    if (unitStatus === "locked") return { allowed: false, reason: "unitLocked" };
    if (unitStatus === "sold") return { allowed: false, reason: "saleConflict" };
    if (unitStatus === "leased") return { allowed: false, reason: "longLeaseConflict" };
  }

  // Cleaning must be completed before check-in
  if (hasOpenCleaningTask) return { allowed: false, reason: "cleaningPending" };

  // Cannot check in if another guest is already checked in
  if (otherCheckedInCount && otherCheckedInCount > 0) {
    return { allowed: false, reason: "unitAlreadyOccupied" };
  }

  if (booking.checkout_mode !== "open" && prepaidAmount <= 0) {
    return { allowed: false, reason: "prepaymentRequired" };
  }
  return { allowed: true };
}

export function allowCheckOut(booking: Pick<DailyBookingRow, "status">): PolicyResult {
  if (booking.status !== "checked_in") return { allowed: false, reason: "bookingNotCheckedIn" };
  return { allowed: true };
}

export function allowCancelBooking(booking: Pick<DailyBookingRow, "status">): PolicyResult {
  if (booking.status !== "pending_review" && booking.status !== "confirmed") {
    return { allowed: false, reason: "bookingCannotBeCancelled" };
  }
  return { allowed: true };
}

export function allowCompleteCleaning(task: { is_completed: boolean } | null): PolicyResult {
  if (!task) return { allowed: false, reason: "cleaningTaskNotFound" };
  if (task.is_completed) return { allowed: false, reason: "cleaningTaskAlreadyCompleted" };
  return { allowed: true };
}

export function getDailyBookingActionState(
  booking: Pick<DailyBookingRow, "status">,
  options: { hasOpenCleaningTask?: boolean } = {},
): DailyBookingActionState {
  const status = booking.status as DailyBookingStatus;
  const canConfirm = status === "pending_review";
  const canCancel = status === "pending_review" || status === "confirmed";
  const canCheckIn = status === "confirmed";
  const canTakePayment = status === "checked_in";
  const canCheckOut = status === "checked_in";
  const canUseAdvancedActions = status === "checked_in";
  const canCompleteCleaning = status === "checked_out" && Boolean(options.hasOpenCleaningTask);

  return {
    canConfirm,
    canCancel,
    canCheckIn,
    canTakePayment,
    canCheckOut,
    canUseAdvancedActions,
    canCompleteCleaning,
    isReadonly: !canConfirm && !canCancel && !canCheckIn && !canTakePayment && !canCheckOut && !canCompleteCleaning,
  };
}

export function bookingOccupiesDate(booking: DailyBookingRow, dateStr: string): boolean {
  if (booking.status === "cancelled") return false;
  if (dateStr < booking.check_in) return false;

  if (booking.checkout_mode === "open") {
    if (booking.actual_check_out && dateStr >= booking.actual_check_out) return false;
    return true;
  }

  if (!booking.check_out) return dateStr === booking.check_in;
  return dateStr < booking.check_out;
}

export async function resolveUnitStatusAfterDailyChange(
  supabase: SupabaseClient,
  unitId: string,
  options: { excludeBookingId?: string } = {},
): Promise<UnitStatus> {
  const { data: unit } = await supabase
    .from("units")
    .select("status")
    .eq("id", unitId)
    .single();

  const currentStatus = (unit?.status ?? "available") as UnitStatus;

  if (currentStatus === "maintenance" || currentStatus === "locked") {
    return currentStatus;
  }

  const [{ data: sale }, { data: lease }, { data: checkedIn }, { data: reserved }, { data: cleaning }] = await Promise.all([
    supabase.from("sale_contracts").select("id").eq("unit_id", unitId).eq("status", "active").limit(1),
    supabase.from("lease_contracts").select("id").eq("unit_id", unitId).eq("status", "active").limit(1),
    buildBookingQuery(supabase, unitId, "checked_in", options.excludeBookingId),
    buildBookingQuery(supabase, unitId, ["pending_review", "confirmed"], options.excludeBookingId),
    supabase.from("cleaning_tasks").select("id").eq("unit_id", unitId).eq("is_completed", false).limit(1),
  ]);

  if ((sale?.length ?? 0) > 0) return "sold";
  if ((lease?.length ?? 0) > 0) return "leased";
  if ((checkedIn?.length ?? 0) > 0) return "daily_occupied";
  if ((cleaning?.length ?? 0) > 0) return "cleaning_pending";
  if ((reserved?.length ?? 0) > 0) return "reserved";
  return "available";
}

function buildBookingQuery(
  supabase: SupabaseClient,
  unitId: string,
  status: string | string[],
  excludeBookingId?: string,
) {
  let query = supabase.from("daily_bookings").select("id").eq("unit_id", unitId);
  query = Array.isArray(status) ? query.in("status", status) : query.eq("status", status);
  if (excludeBookingId) query = query.neq("id", excludeBookingId);
  return query.limit(1);
}
