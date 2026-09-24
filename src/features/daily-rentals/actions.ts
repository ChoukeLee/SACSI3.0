"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, type CurrentUser } from "@/lib/auth";
import type { CleaningTaskRow, DailyBookingRow, PaymentRow, ReceivableRow, UnitRow } from "@/types/database";
import type { UnitStatus } from "@/types/domain";
import {
  allowCancelBooking,
  allowCheckIn,
  allowCheckOut,
  allowCompleteCleaning,
  allowConfirmBooking,
  resolveUnitStatusAfterDailyChange,
  todayIso,
} from "./daily-rental-policy";
import { submitFinanceOperation } from "@/features/finance/finance-operation-service";

import { writeAuditLog } from "@/lib/audit";
import { isDailyBookingAgentName } from "./daily-booking-agents";

// ── Permission guards ──
async function guardWrite() {
  return requireRole("admin", "front_desk", "rental_sales");
}

function actorPayload(user: CurrentUser) {
  return {
    actor_id: user.id,
    actor_role: user.role,
    actor_email: user.email ?? null,
    actor_display_name: user.displayName,
  };
}

async function applyUnitStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  unitId: string,
  status: UnitStatus,
): Promise<{ success: true } | { success: false; error: string }> {
  const { data, error } = await supabase
    .from("units")
    .update({ status })
    .eq("id", unitId)
    .select("id")
    .maybeSingle();
  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "unitStatusNotUpdated" };
  return { success: true };
}

async function getDailyRentalUnit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  unitId: string,
) {
  const { data, error } = await supabase
    .from("units")
    .select("id, building_id, unit_no, status, unit_business_flags!inner(business_type, is_enabled)")
    .eq("id", unitId)
    .eq("unit_business_flags.business_type", "daily_rental")
    .eq("unit_business_flags.is_enabled", true)
    .maybeSingle();
  if (error) return { success: false as const, error: error.message };
  if (!data) return { success: false as const, error: "dailyRentalNotEnabledForUnit" };
  return { success: true as const, unit: data };
}

async function validateDailyBookingAgent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  customerId: string,
) {
  const { data, error } = await supabase
    .from("customers")
    .select("id, name, is_blacklisted")
    .eq("id", customerId)
    .maybeSingle();
  if (error) return { success: false as const, error: error.message };
  if (!data || !isDailyBookingAgentName(data.name) || data.is_blacklisted) {
    return { success: false as const, error: "dailyBookingAgentRequired" };
  }
  return { success: true as const };
}

export interface DailyOperationSnapshot {
  booking: DailyBookingRow | null;
  unit: UnitRow | null;
  receivables: ReceivableRow[];
  payments: PaymentRow[];
  cleaningTasks: CleaningTaskRow[];
}

type DailyActionResult = {
  success: boolean;
  error?: string;
  data?: DailyOperationSnapshot;
};

async function getDailyOperationSnapshot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  bookingId: string,
  fallbackUnitId?: string | null,
): Promise<DailyOperationSnapshot> {
  const { data: booking } = await supabase
    .from("daily_bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle();
  const unitId = (booking?.unit_id as string | undefined) ?? fallbackUnitId ?? null;
  const [
    { data: unit },
    { data: receivables },
    { data: payments },
    { data: cleaningTasks },
  ] = await Promise.all([
    unitId
      ? supabase.from("units").select("*").eq("id", unitId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("receivables").select("*").eq("source_type", "daily_booking").eq("source_id", bookingId),
    supabase.from("payments").select("*").eq("source_type", "daily_booking").eq("source_id", bookingId),
    unitId
      ? supabase.from("cleaning_tasks").select("*").eq("unit_id", unitId)
      : Promise.resolve({ data: [] }),
  ]);

  return {
    booking: (booking ?? null) as DailyBookingRow | null,
    unit: (unit ?? null) as UnitRow | null,
    receivables: (receivables ?? []) as ReceivableRow[],
    payments: (payments ?? []) as PaymentRow[],
    cleaningTasks: (cleaningTasks ?? []) as CleaningTaskRow[],
  };
}

// ── Conflict detection ──

export async function checkConflicts(
  unitId: string,
  checkIn: string,
  checkOut?: string,
  excludeBookingId?: string
): Promise<{ hasConflict: boolean; reason?: string }> {
  const supabase = await createClient();

  const { data: unit } = await supabase.from("units").select("status").eq("id", unitId).single();
  if (!unit) return { hasConflict: true, reason: "unitNotFound" };
  if (unit.status === "maintenance") return { hasConflict: true, reason: "unitMaintenance" };
  if (unit.status === "locked") return { hasConflict: true, reason: "unitLocked" };
  if (unit.status === "sold") return { hasConflict: true, reason: "saleConflict" };
  if (unit.status === "leased") return { hasConflict: true, reason: "longLeaseConflict" };

  // For open-ended bookings, effective checkOut is far future
  const effectiveCheckOut = checkOut ?? "9999-12-31";

  let query = supabase
    .from("daily_bookings")
    .select("id, check_in, check_out, checkout_mode")
    .eq("unit_id", unitId)
    .lt("check_in", effectiveCheckOut)
    .in("status", ["pending_review", "confirmed", "checked_in"]);

  if (excludeBookingId) query = query.neq("id", excludeBookingId);

  const { data: overlapping } = await query;
  if (overlapping && overlapping.length > 0) {
    for (const b of overlapping) {
      const bCheckOut = b.checkout_mode === "open" ? "9999-12-31" : (b.check_out ?? b.check_in);
      if (checkIn < bCheckOut) {
        return { hasConflict: true, reason: `doubleBooked: ${b.check_in} → ${b.checkout_mode === "open" ? "?" : (b.check_out ?? "?")}` };
      }
    }
  }

  // Check active long-lease
  const { data: activeLease } = await supabase
    .from("lease_contracts")
    .select("id").eq("unit_id", unitId).eq("status", "active")
    .lt("start_date", effectiveCheckOut)
    .gt("expected_end_date", checkIn).limit(1);
  if (activeLease && activeLease.length > 0) {
    return { hasConflict: true, reason: "longLeaseConflict" };
  }

  const { data: activeSale } = await supabase
    .from("sale_contracts")
    .select("id").eq("unit_id", unitId).eq("status", "active")
    .limit(1);
  if (activeSale && activeSale.length > 0) {
    return { hasConflict: true, reason: "saleConflict" };
  }

  return { hasConflict: false };
}

// ── Create booking (supports fixed + open modes) ──

export async function createBooking(input: {
  unitId: string; customerId: string; checkIn: string;
  checkOut?: string; checkoutMode?: "fixed" | "open";
  nightlyPriceXof: number; notes?: string; otaSource?: string;
  requestId: string;
}): Promise<DailyActionResult> {
  const user = await requireRole("admin", "rental_sales");
  const supabase = await createClient();
  const agentCheck = await validateDailyBookingAgent(supabase, input.customerId);
  if (!agentCheck.success) return { success: false, error: agentCheck.error };
  const { data, error } = await supabase.rpc("daily_create_booking_rpc", {
    p_unit_id: input.unitId,
    p_customer_id: input.customerId,
    p_check_in: input.checkIn,
    p_check_out: input.checkoutMode === "open" ? null : (input.checkOut ?? null),
    p_checkout_mode: input.checkoutMode ?? "fixed",
    p_nightly_price_xof: input.nightlyPriceXof,
    p_notes: input.notes ?? null,
    p_ota_source: input.otaSource ?? null,
    p_request_id: input.requestId,
    p_actor: actorPayload(user),
  });
  if (error) return { success: false, error: error.message };

  let snapshot = data as DailyOperationSnapshot;
  if (snapshot.booking?.status === "pending_review") {
    const { data: confirmedSnapshot, error: confirmError } = await supabase.rpc("daily_confirm_booking_rpc", {
      p_booking_id: snapshot.booking.id,
      p_actor: actorPayload(user),
    });
    if (confirmError) return { success: false, error: confirmError.message };
    snapshot = confirmedSnapshot as DailyOperationSnapshot;
  }

  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/management"); revalidatePath("/fr/management");
  revalidatePath("/finance"); revalidatePath("/fr/finance");
  

  return { success: true, data: snapshot };
}

// ── Backfill (admin only) ──

export async function createBackfillBooking(input: {
  unitId: string; customerId: string; checkIn: string; checkOut: string;
  nightlyPriceXof: number; prepaidAmountXof: number; reason: string; notes?: string; requestId: string;
}) {
  await requireRole("admin");
  const supabase = await createClient();
  const agentCheck = await validateDailyBookingAgent(supabase, input.customerId);
  if (!agentCheck.success) return { success: false, error: agentCheck.error, rejected: true };
  const unitCheck = await getDailyRentalUnit(supabase, input.unitId);
  if (!unitCheck.success) return { success: false, error: unitCheck.error, rejected: true };
  if (input.checkIn >= todayIso()) return { success: false, error: "backfillMustBePastDate", rejected: true };
  const { requestId, ...payload } = input;
  // Database writes the [历史补录] record, receivable, receipt, ledger and audit together; never changes units.status.
  return submitFinanceOperation<DailyOperationSnapshot>("daily_backfill", payload, requestId);
}

// ── Confirm ──
export async function confirmBooking(bookingId: string): Promise<DailyActionResult> {
  const user = await guardWrite();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("daily_confirm_booking_rpc", {
    p_booking_id: bookingId,
    p_actor: actorPayload(user),
  });
  if (error) return { success: false, error: error.message };
  return { success: true, data: data as DailyOperationSnapshot };
}

// ── Check-in (payment is optional; finance state tracks unpaid balance) ──
export async function checkIn(
  bookingId: string,
  prepaidAmount: number,
  requestId?: string,
): Promise<DailyActionResult> {
  const user = await guardWrite();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("daily_check_in_booking_rpc", {
    p_booking_id: bookingId,
    p_prepaid_amount: prepaidAmount,
    p_request_id: prepaidAmount > 0 ? (requestId ?? null) : null,
    p_actor: actorPayload(user),
  });
  if (error) return { success: false, error: error.message };
  return { success: true, data: data as DailyOperationSnapshot };
}

// ── Supplementary payment (for in-house or checked-out daily bookings) ──
export async function recordSupplementaryPayment(input: {
  bookingId: string; amount: number; paymentDate?: string; receiptNo?: string;
  requestId: string;
}): Promise<DailyActionResult> {
  const user = await guardWrite();
  if (input.amount <= 0) return { success: false, error: "金额必须大于 0。" };
  const supabase = await createClient();
  // The database payment RPC accrues open stays inside the same transaction.
  const { data, error } = await supabase.rpc("daily_record_payment_rpc", {
    p_booking_id: input.bookingId,
    p_amount: input.amount,
    p_payment_date: input.paymentDate ?? new Date().toISOString().slice(0, 10),
    p_receipt_no: input.receiptNo ?? null,
    p_request_id: input.requestId,
    p_actor: actorPayload(user),
  });
  if (error) return { success: false, error: error.message };
  return { success: true, data: data as DailyOperationSnapshot };
}

// ── Reverse a payment without deleting the original record ──
export async function reversePayment(input: {
  paymentId: string;
  reason: string;
  requestId: string;
}): Promise<DailyActionResult> {
  const user = await guardWrite();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("daily_reverse_payment_rpc", {
    p_payment_id: input.paymentId,
    p_reason: input.reason,
    p_request_id: input.requestId,
    p_actor: actorPayload(user),
  });
  if (error) return { success: false, error: error.message };
  return { success: true, data: data as DailyOperationSnapshot };
}

// ── Check-out (supports fixed + open modes with discount) ──
export async function checkOut(bookingId: string, input: {
  finalAmount?: number; actualCheckOut?: string;
  discountAmount?: number; discountReason?: string;
}): Promise<DailyActionResult> {
  const user = await guardWrite();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("daily_check_out_booking_rpc", {
    p_booking_id: bookingId,
    p_actual_check_out: input.actualCheckOut ?? new Date().toISOString().slice(0, 10),
    p_final_amount: input.finalAmount ?? null,
    p_discount_amount: input.discountAmount ?? 0,
    p_discount_reason: input.discountReason ?? null,
    p_checkout_unit_status: "cleaning_pending",
    p_actor: actorPayload(user),
  });
  if (error) return { success: false, error: error.message };
  return { success: true, data: data as DailyOperationSnapshot };
}

// ── Apply discount (without checking out) ──
export async function applyDiscount(input: {
  bookingId: string; amount: number; reason: string;
}): Promise<DailyActionResult> {
  const user = await guardWrite();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("daily_apply_discount_rpc", {
    p_booking_id: input.bookingId,
    p_amount: input.amount,
    p_reason: input.reason,
    p_actor: actorPayload(user),
  });
  if (error) return { success: false, error: error.message };
  return { success: true, data: data as DailyOperationSnapshot };
}

// ── Set fixed checkout (convert open-ended → fixed) ──

export async function setFixedCheckout(bookingId: string, newCheckOut: string): Promise<DailyActionResult> {
  const user = await guardWrite();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("daily_set_fixed_checkout_rpc", {
    p_booking_id: bookingId,
    p_new_check_out: newCheckOut,
    p_actor: actorPayload(user),
  });
  if (error) return { success: false, error: error.message };
  return { success: true, data: data as DailyOperationSnapshot };
}

// ── Complete cleaning ──
export async function completeCleaning(taskId: string): Promise<DailyActionResult & { taskId?: string; unitId?: string; unitStatus?: UnitStatus }> {
  const user = await guardWrite();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("daily_complete_cleaning_rpc", {
    p_task_id: taskId,
    p_actor: actorPayload(user),
  });
  if (error) return { success: false, error: error.message };
  const snapshot = data as DailyOperationSnapshot;
  const unitStatus = snapshot.unit?.status;
  return { success: true, data: snapshot, taskId, unitId: snapshot.unit?.id, unitStatus };
}

export async function extendStay(
  bookingId: string,
  newCheckOut: string,
  extraNights: number,
  extraAmount: number,
  requestId: string,
): Promise<DailyActionResult> {
  const user = await guardWrite();
  if (extraNights <= 0 || extraAmount < 0) {
    return { success: false, error: "续住金额或晚数无效。" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("daily_extend_stay_rpc", {
    p_booking_id: bookingId,
    p_new_check_out: newCheckOut || null,
    p_extra_nights: extraNights,
    p_request_id: requestId,
    p_actor: actorPayload(user),
  });
  if (error) return { success: false, error: error.message };
  return { success: true, data: data as DailyOperationSnapshot };
}

// ── Cancel ──
export async function voidErroneousCheckin(bookingId: string, reason: string): Promise<DailyActionResult> {
  await requireRole("admin");
  if (reason.trim().length < 5) return { success: false, error: "请填写至少5个字的纠错原因。" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("daily_void_erroneous_checkin_rpc", {
    p_booking_id: bookingId, p_reason: reason.trim(),
  });
  if (error) return { success: false, error: error.message };
  for (const path of ["/daily-rentals", "/fr/daily-rentals", "/management", "/fr/management"]) revalidatePath(path);
  return { success: true, data: data as DailyOperationSnapshot };
}

export async function cancelBooking(bookingId: string): Promise<DailyActionResult> {
  const user = await guardWrite();
  try {
    // Keep the user's authenticated session. The database RPC and cancellation
    // trigger both use that identity for authorization and auditing.
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("daily_cancel_booking_rpc", {
      p_booking_id: bookingId,
      p_actor: actorPayload(user),
    });
    if (error) return { success: false, error: error.message };
    revalidatePath("/daily-rentals");
    revalidatePath("/fr/daily-rentals");
    revalidatePath("/management");
    revalidatePath("/fr/management");
    return { success: true, data: data as DailyOperationSnapshot };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "dailyCancelFailed",
    };
  }
}
