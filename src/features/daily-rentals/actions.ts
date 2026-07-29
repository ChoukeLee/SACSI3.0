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
import {
  createReceivable,
  updateReceivableAmount,
} from "@/features/finance/receivables";
import {
  syncBookingFinance,
  insertLedgerEntry,
} from "./daily-rental-finance";
import { writeAuditLog } from "@/lib/audit";

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
    .select("id, building_id, unit_no, status, buildings!inner(code)")
    .eq("id", unitId)
    .maybeSingle();
  if (error) return { success: false as const, error: error.message };
  if (!data) return { success: false as const, error: "unitNotFound" };
  const building = Array.isArray(data.buildings) ? data.buildings[0] : data.buildings;
  if (building?.code !== "SACSI11") {
    return { success: false as const, error: "dailyRentalOnlyAllowedInSacsi11" };
  }
  return { success: true as const, unit: data };
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
  if (!unit) return { hasConflict: true, reason: "Unit not found." };
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
  const user = await guardWrite();
  const supabase = await createClient();
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

  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/management"); revalidatePath("/fr/management");
  revalidatePath("/finance"); revalidatePath("/fr/finance");
  revalidatePath("/reports"); revalidatePath("/fr/reports");
  

  return { success: true, data: data as DailyOperationSnapshot };
}

// ── Backfill (admin only) ──

export async function createBackfillBooking(input: {
  unitId: string; customerId: string; checkIn: string; checkOut: string;
  nightlyPriceXof: number; prepaidAmountXof: number; reason: string;
  notes?: string;
}): Promise<DailyActionResult> {
  await requireRole("admin");
  const supabase = await createClient();
  const unitCheck = await getDailyRentalUnit(supabase, input.unitId);
  if (!unitCheck.success) return { success: false, error: unitCheck.error };

  // Validate dates
  if (!input.checkIn || !input.checkOut) return { success: false, error: "checkInRequired" };
  if (input.checkOut <= input.checkIn) return { success: false, error: "invalidDateRange" };
  if (input.checkIn >= todayIso()) return { success: false, error: "backfillMustBePastDate" };
  if (input.checkOut > todayIso()) return { success: false, error: "backfillMustBeCompleted" };
  if (input.nightlyPriceXof <= 0) return { success: false, error: "invalidPrice" };
  if (input.prepaidAmountXof < 0) return { success: false, error: "invalidPrepaid" };

  const { data: customer } = await supabase
    .from("customers").select("is_blacklisted, blacklist_reason").eq("id", input.customerId).single();
  if (customer?.is_blacklisted) {
    return { success: false, error: `Customer is blacklisted: ${customer.blacklist_reason}` };
  }

  const nights = Math.max(1, Math.ceil(
    (new Date(input.checkOut).getTime() - new Date(input.checkIn).getTime()) / (1000 * 60 * 60 * 24)
  ));
  const totalAmount = Math.round(input.nightlyPriceXof * nights);
  const paidAmount = input.prepaidAmountXof;
  const isSettled = paidAmount >= totalAmount;

  // Insert as checked_out — no unit.status change, no cleaning task
  const { data, error } = await supabase.from("daily_bookings").insert({
    unit_id: input.unitId, customer_id: input.customerId,
    check_in: input.checkIn,
    check_out: input.checkOut,
    checkout_mode: "fixed",
    nightly_price_xof: input.nightlyPriceXof,
    total_amount_xof: totalAmount,
    final_amount_xof: totalAmount,
    prepaid_amount_xof: paidAmount,
    billing_status: isSettled ? "settled" : (paidAmount > 0 ? "partially_paid" : "need_top_up"),
    status: "checked_out",
    notes: `[历史补录] ${input.reason}${input.notes ? ` — ${input.notes}` : ""}`,
  }).select("*").single();

  if (error) return { success: false, error: error.message };

  // Create receivable
  await createReceivable({
    building_id: unitCheck.unit.building_id ?? null,
    unit_id: input.unitId,
    customer_id: input.customerId,
    source_type: "daily_booking",
    source_id: data.id,
    category: "daily_rental",
    title: `日租(补录) ${data.check_in}–${input.checkOut}`,
    due_date: input.checkIn,
    amount_xof: totalAmount,
    paid_amount_xof: paidAmount,
    status: isSettled ? "paid" : (paidAmount > 0 ? "partial" : "pending"),
    currency: "XOF",
  });

  // If money was received, record payment + ledger
  if (paidAmount > 0) {
    const { data: payment } = await supabase.from("payments").insert({
      customer_id: input.customerId, unit_id: input.unitId,
      source_type: "daily_booking", source_id: data.id,
      payment_date: input.checkOut, amount: paidAmount, currency: "XOF", exchange_rate_to_xof: 1,
    }).select("id").single();

    if (payment) {
      await insertLedgerEntry(supabase, {
        bookingId: data.id, unitId: input.unitId, buildingId: unitCheck.unit.building_id ?? null,
        paymentId: payment.id, amount: paidAmount, direction: "income",
        entryDate: input.checkOut,
        description: `日租历史补录 房间${unitCheck.unit.unit_no ?? "?"}`,
      });
    }
  }

  // Audit log
  await writeAuditLog({
    action: "daily_booking_backfill",
    entityType: "daily_booking",
    entityId: data.id,
    metadata: {
      reason: input.reason,
      check_in: input.checkIn,
      check_out: input.checkOut,
      amount: totalAmount,
      paid_amount: paidAmount,
      unit_id: input.unitId,
      customer_id: input.customerId,
    },
  });

  // Revalidate all financial pages
  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/management"); revalidatePath("/fr/management");
  revalidatePath("/finance"); revalidatePath("/fr/finance");
  revalidatePath("/reports"); revalidatePath("/fr/reports");

  return { success: true, data: await getDailyOperationSnapshot(supabase, data.id, input.unitId) };
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
  if (input.amount <= 0) return { success: false, error: "Amount must be positive." };
  const supabase = await createClient();
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
    return { success: false, error: "Invalid extension amount or nights." };
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
export async function cancelBooking(bookingId: string): Promise<DailyActionResult> {
  const user = await guardWrite();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("daily_cancel_booking_rpc", {
    p_booking_id: bookingId,
    p_actor: actorPayload(user),
  });
  if (error) return { success: false, error: error.message };
  return { success: true, data: data as DailyOperationSnapshot };
}
