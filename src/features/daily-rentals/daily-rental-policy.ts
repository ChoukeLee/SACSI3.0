import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyBookingRow } from "@/types/database";
import type { UnitStatus } from "@/types/domain";

export type DailyBookingStatus =
  | "pending_review"
  | "confirmed"
  | "checked_in"
  | "checked_out"
  | "cancelled";

export type PolicyResult = { allowed: true } | { allowed: false; reason: string };

export interface CreateBookingPolicyInput {
  checkIn: string;
  checkOut?: string;
  checkoutMode?: "fixed" | "open";
  todayStr?: string;
  isBackfill?: boolean;
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function allowCreateBooking(input: CreateBookingPolicyInput): PolicyResult {
  const checkIn = input.checkIn;
  const mode = input.checkoutMode ?? "fixed";
  const today = input.todayStr ?? todayIso();

  if (!checkIn) return { allowed: false, reason: "checkInRequired" };
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

export function allowCheckIn(booking: Pick<DailyBookingRow, "status" | "checkout_mode">, prepaidAmount: number): PolicyResult {
  if (booking.status !== "confirmed") return { allowed: false, reason: "bookingNotConfirmed" };
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
