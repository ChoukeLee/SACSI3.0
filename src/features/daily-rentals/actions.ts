"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAuth, requireRole, type CurrentUser } from "@/lib/auth";
import type { CleaningTaskRow, DailyBookingRow, PaymentRow, ReceivableRow, UnitRow } from "@/types/database";
import type { UnitStatus } from "@/types/domain";
import {
  allowCancelBooking,
  allowCheckIn,
  allowCheckOut,
  allowCompleteCleaning,
  allowConfirmBooking,
  allowCreateBooking,
  resolveUnitStatusAfterDailyChange,
  todayIso,
} from "./daily-rental-policy";
import {
  createReceivable,
  updateReceivableAmount,
  cancelReceivablesForSource,
} from "@/features/finance/receivables";
import {
  sumPayments,
  syncBookingFinance,
  insertLedgerEntry,
  reverseLedgerEntriesForPayment,
} from "./daily-rental-finance";
import { writeAuditLog } from "@/lib/audit";
import { getSetting } from "@/lib/settings";

// ── Permission guards ──
async function guardWrite() {
  const user = await requireAuth();
  if (user.role === "boss") throw new Error("Boss role is read-only.");
  return user;
}
async function guardCancel() {
  return requireRole("admin");
}

function dailyRpcEnabled() {
  return process.env.DAILY_RENTAL_RPC_ENABLED === "true";
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
}): Promise<DailyActionResult> {
  await guardWrite();
  const supabase = await createClient();

  const unitCheck = await getDailyRentalUnit(supabase, input.unitId);
  if (!unitCheck.success) return { success: false, error: unitCheck.error };

  const createPolicy = allowCreateBooking({
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    checkoutMode: input.checkoutMode,
    unitStatus: (unitCheck.unit.status ?? null) as UnitStatus | null,
  });
  if (!createPolicy.allowed) return { success: false, error: createPolicy.reason };

  const { data: customer } = await supabase
    .from("customers").select("is_blacklisted, blacklist_reason").eq("id", input.customerId).single();
  if (customer?.is_blacklisted) {
    return { success: false, error: `Customer is blacklisted: ${customer.blacklist_reason}` };
  }

  const mode = input.checkoutMode ?? "fixed";
  const conflict = await checkConflicts(input.unitId, input.checkIn, input.checkOut, undefined);
  if (conflict.hasConflict) {
    return { success: false, error: conflict.reason ?? "Date conflict detected." };
  }

  // Calculate total for fixed mode; open mode starts with 1 night estimate
  let totalAmount = 0;
  if (mode === "fixed" && input.checkOut) {
    const nights = Math.max(1, Math.ceil(
      (new Date(input.checkOut).getTime() - new Date(input.checkIn).getTime()) / (1000 * 60 * 60 * 24)
    ));
    totalAmount = Math.round(input.nightlyPriceXof * nights);
  } else {
    totalAmount = input.nightlyPriceXof; // 1 night minimum for open
  }

  const { data, error } = await supabase.from("daily_bookings").insert({
    unit_id: input.unitId, customer_id: input.customerId,
    check_in: input.checkIn,
    check_out: mode === "fixed" ? (input.checkOut ?? input.checkIn) : null,
    checkout_mode: mode,
    nightly_price_xof: input.nightlyPriceXof,
    total_amount_xof: totalAmount,
    final_amount_xof: totalAmount,
    prepaid_amount_xof: 0,
    billing_status: "need_top_up",
    status: "pending_review",
    ota_source: input.otaSource ?? null,
    notes: input.notes ?? null,
  }).select("*").single();

  if (error) return { success: false, error: error.message };

  const unitStatusResult = await applyUnitStatus(supabase, input.unitId, "reserved");
  if (!unitStatusResult.success) return unitStatusResult;
  await writeAuditLog({
    action: "create", entityType: "daily_booking", entityId: data.id,
    metadata: { unit_id: input.unitId, customer_id: input.customerId, check_in: input.checkIn, checkout_mode: mode },
  });

  // Create receivable for this booking
  await createReceivable({
    building_id: unitCheck.unit.building_id ?? null,
    unit_id: input.unitId,
    customer_id: input.customerId,
    source_type: "daily_booking",
    source_id: data.id,
    category: "daily_rental",
    title: `日租 ${data.check_in}`,
    due_date: input.checkIn,
    amount_xof: totalAmount,
    paid_amount_xof: 0,
    status: "pending",
    currency: "XOF",
  });

  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/management"); revalidatePath("/fr/management");
  revalidatePath("/finance"); revalidatePath("/fr/finance");
  revalidatePath("/reports"); revalidatePath("/fr/reports");
  

  return { success: true, data: await getDailyOperationSnapshot(supabase, data.id, input.unitId) };
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
  if (dailyRpcEnabled()) {
    const { data, error } = await supabase.rpc("daily_confirm_booking_rpc", {
      p_booking_id: bookingId,
      p_actor: actorPayload(user),
    });
    if (error) return { success: false, error: error.message };
    return { success: true, data: data as DailyOperationSnapshot };
  }
  const { data: booking } = await supabase.from("daily_bookings").select("*").eq("id", bookingId).single();
  if (!booking) return { success: false, error: "Booking not found." };
  const policy = allowConfirmBooking(booking);
  if (!policy.allowed) return { success: false, error: policy.reason };

  const { data: updatedBooking, error } = await supabase
    .from("daily_bookings")
    .update({ status: "confirmed" })
    .eq("id", bookingId)
    .eq("status", "pending_review")
    .select("id")
    .maybeSingle();
  if (error) return { success: false, error: error.message };
  if (!updatedBooking) return { success: false, error: "bookingNotPendingReview" };
  await writeAuditLog({ action: "confirm", entityType: "daily_booking", entityId: bookingId, metadata: {} });
  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/management"); revalidatePath("/fr/management");
  revalidatePath("/finance"); revalidatePath("/fr/finance");
  revalidatePath("/reports"); revalidatePath("/fr/reports");
  

  return { success: true, data: await getDailyOperationSnapshot(supabase, bookingId, booking.unit_id) };
}

// ── Check-in (payment is optional; finance state tracks unpaid balance) ──
export async function checkIn(bookingId: string, prepaidAmount: number): Promise<DailyActionResult> {
  const user = await guardWrite();
  const supabase = await createClient();
  if (dailyRpcEnabled()) {
    const { data, error } = await supabase.rpc("daily_check_in_booking_rpc", {
      p_booking_id: bookingId,
      p_prepaid_amount: prepaidAmount,
      p_actor: actorPayload(user),
    });
    if (error) return { success: false, error: error.message };
    return { success: true, data: data as DailyOperationSnapshot };
  }

  const { data: booking } = await supabase.from("daily_bookings")
    .select("*").eq("id", bookingId).single();
  if (!booking) return { success: false, error: "Booking not found." };

  // Fetch unit status, open cleaning tasks, and other checked_in bookings
  const [{ data: unit }, { data: openCleaning }, { data: otherCheckedIn }] = await Promise.all([
    supabase.from("units").select("status").eq("id", booking.unit_id).single(),
    supabase.from("cleaning_tasks").select("id").eq("unit_id", booking.unit_id).eq("is_completed", false).limit(1),
    supabase.from("daily_bookings").select("id").eq("unit_id", booking.unit_id).eq("status", "checked_in").neq("id", bookingId).limit(1),
  ]);

  const policy = allowCheckIn({
    booking,
    prepaidAmount,
    hasOpenCleaningTask: (openCleaning?.length ?? 0) > 0,
    otherCheckedInCount: otherCheckedIn?.length ?? 0,
    unitStatus: (unit?.status ?? null) as UnitStatus | null,
  });
  if (!policy.allowed) return { success: false, error: policy.reason };

  const { data: updatedBooking, error: bookingUpdateError } = await supabase
    .from("daily_bookings")
    .update({ status: "checked_in" })
    .eq("id", bookingId)
    .eq("status", "confirmed")
    .select("id")
    .maybeSingle();
  if (bookingUpdateError) return { success: false, error: bookingUpdateError.message };
  if (!updatedBooking) return { success: false, error: "bookingNotConfirmed" };

  const unitStatusResult = await applyUnitStatus(supabase, booking.unit_id, "daily_occupied");
  if (!unitStatusResult.success) return unitStatusResult;

  if (prepaidAmount > 0) {
    const { data: unit } = await supabase.from("units").select("building_id, unit_no").eq("id", booking.unit_id).single();
    const { data: payment } = await supabase.from("payments").insert({
      customer_id: booking.customer_id, unit_id: booking.unit_id, source_type: "daily_booking", source_id: bookingId,
      payment_date: new Date().toISOString().slice(0, 10), amount: prepaidAmount, currency: "XOF", exchange_rate_to_xof: 1,
    }).select("id").single();
    if (payment) {
      await insertLedgerEntry(supabase, {
        bookingId, unitId: booking.unit_id, buildingId: unit?.building_id ?? null, paymentId: payment.id,
        amount: prepaidAmount, direction: "income", description: `日租预付 房间${unit?.unit_no ?? booking.unit_id}`,
      });
    }
  }

  await writeAuditLog({
    action: "check_in", entityType: "daily_booking", entityId: bookingId,
    metadata: { prepaid_amount: prepaidAmount, checkout_mode: booking.checkout_mode },
  });

  // Full financial sync: receivable → booking prepaid → billing status
  if (prepaidAmount > 0) {
    await syncBookingFinance(supabase, bookingId);
  }

  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/management"); revalidatePath("/fr/management");
  revalidatePath("/finance"); revalidatePath("/fr/finance");
  revalidatePath("/reports"); revalidatePath("/fr/reports");
  

  return { success: true, data: await getDailyOperationSnapshot(supabase, bookingId, booking.unit_id) };
}

// ── Supplementary payment (for in-house or checked-out daily bookings) ──
export async function recordSupplementaryPayment(input: {
  bookingId: string; amount: number; paymentDate?: string; receiptNo?: string;
}): Promise<DailyActionResult> {
  await guardWrite();
  if (input.amount <= 0) return { success: false, error: "Amount must be positive." };
  const supabase = await createClient();

  const { data: booking } = await supabase.from("daily_bookings")
    .select("*").eq("id", input.bookingId).in("status", ["checked_in", "checked_out"]).single();
  if (!booking) return { success: false, error: "Booking not found or not payable." };

  const { data: unit } = await supabase.from("units").select("building_id, unit_no").eq("id", booking.unit_id).single();
  const { data: payment } = await supabase.from("payments").insert({
    customer_id: booking.customer_id, unit_id: booking.unit_id,
    source_type: "daily_booking", source_id: input.bookingId,
    payment_date: input.paymentDate ?? new Date().toISOString().slice(0, 10),
    amount: input.amount, currency: "XOF", exchange_rate_to_xof: 1,
    receipt_no: input.receiptNo ?? null,
  }).select("id").single();

  if (payment) {
    await insertLedgerEntry(supabase, {
      bookingId: input.bookingId, unitId: booking.unit_id, buildingId: unit?.building_id ?? null,
      paymentId: payment.id, amount: input.amount, direction: "income",
      entryDate: input.paymentDate,
      description: `日租补缴 房间${unit?.unit_no ?? booking.unit_id}`,
    });
  }

  await writeAuditLog({
    action: "supplementary_payment", entityType: "daily_booking", entityId: input.bookingId,
    metadata: { amount: input.amount, payment_date: input.paymentDate ?? null, receipt_no: input.receiptNo ?? null },
  });

  await syncBookingFinance(supabase, input.bookingId);

  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/management"); revalidatePath("/fr/management");
  revalidatePath("/finance"); revalidatePath("/fr/finance");
  revalidatePath("/reports"); revalidatePath("/fr/reports");
  

  return { success: true, data: await getDailyOperationSnapshot(supabase, input.bookingId, booking.unit_id) };
}

// ── Reverse a supplementary payment ──
export async function deletePayment(paymentId: string): Promise<DailyActionResult> {
  await guardWrite();
  const supabase = await createClient();

  const { data: payment } = await supabase.from("payments")
    .select("id, source_id, source_type, amount, unit_id")
    .eq("id", paymentId).single();
  if (!payment) return { success: false, error: "Payment not found." };
  if (payment.source_type !== "daily_booking" || !payment.source_id) {
    return { success: false, error: "Only daily booking payments can be deleted here." };
  }

  const { data: booking } = await supabase.from("daily_bookings")
    .select("*").eq("id", payment.source_id).single();
  if (!booking) return { success: false, error: "Booking not found." };

  // Soft-delete ledger: insert reversal entries instead of physical DELETE
  await reverseLedgerEntriesForPayment(supabase, paymentId);

  await supabase.from("payments").delete().eq("id", paymentId);

  await writeAuditLog({
    action: "payment_reversed", entityType: "payment", entityId: paymentId,
    metadata: { amount: payment.amount, booking_id: payment.source_id, unit_id: payment.unit_id },
  });

  await syncBookingFinance(supabase, payment.source_id);

  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/management"); revalidatePath("/fr/management");
  revalidatePath("/finance"); revalidatePath("/fr/finance");
  revalidatePath("/reports"); revalidatePath("/fr/reports");

  return { success: true, data: await getDailyOperationSnapshot(supabase, payment.source_id, booking.unit_id) };
}

// ── Check-out (supports fixed + open modes with discount) ──
export async function checkOut(bookingId: string, input: {
  finalAmount?: number; actualCheckOut?: string;
  discountAmount?: number; discountReason?: string;
}): Promise<DailyActionResult> {
  const user = await guardWrite();
  const supabase = await createClient();
  if (dailyRpcEnabled()) {
    const checkoutUnitStatus = await getSetting<UnitStatus>("checkout_default_unit_status", "cleaning_pending");
    const { data, error } = await supabase.rpc("daily_check_out_booking_rpc", {
      p_booking_id: bookingId,
      p_actual_check_out: input.actualCheckOut ?? new Date().toISOString().slice(0, 10),
      p_final_amount: input.finalAmount ?? null,
      p_discount_amount: input.discountAmount ?? 0,
      p_discount_reason: input.discountReason ?? null,
      p_checkout_unit_status: checkoutUnitStatus,
      p_actor: actorPayload(user),
    });
    if (error) return { success: false, error: error.message };
    return { success: true, data: data as DailyOperationSnapshot };
  }

  const { data: booking } = await supabase.from("daily_bookings")
    .select("*").eq("id", bookingId).single();
  if (!booking) return { success: false, error: "Booking not found." };
  const policy = allowCheckOut(booking);
  if (!policy.allowed) return { success: false, error: policy.reason };

  const actualCheckOut = input.actualCheckOut ?? new Date().toISOString().slice(0, 10);
  if (actualCheckOut < booking.check_in) {
    return { success: false, error: "actualCheckOutBeforeCheckIn" };
  }

  const checkIn = new Date(booking.check_in);
  const checkOutDate = new Date(actualCheckOut);
  const nights = Math.max(1, Math.ceil((checkOutDate.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)));
  const grossAmount = Math.round(nights * Number(booking.nightly_price_xof));
  const discountAmount = Math.max(0, Number(input.discountAmount ?? 0));
  const finalAmount = Math.max(0, input.finalAmount ?? (grossAmount - discountAmount));

  const currentPaid = await sumPayments(supabase, bookingId);
  const update: Record<string, unknown> = {
    status: "checked_out",
    total_amount_xof: grossAmount,
    final_amount_xof: finalAmount,
    prepaid_amount_xof: currentPaid,
  };
  if (booking.checkout_mode === "open") {
    update.actual_check_out = actualCheckOut;
  }
  if (discountAmount > 0) {
    update.manual_discount_amount_xof = discountAmount;
    update.manual_discount_reason = input.discountReason ?? null;
  }

  const { data: updatedBooking, error: bookingUpdateError } = await supabase
    .from("daily_bookings")
    .update(update)
    .eq("id", bookingId)
    .eq("status", "checked_in")
    .select("id")
    .maybeSingle();
  if (bookingUpdateError) return { success: false, error: bookingUpdateError.message };
  if (!updatedBooking) return { success: false, error: "bookingNotCheckedIn" };

  const checkoutUnitStatus = await getSetting<UnitStatus>("checkout_default_unit_status", "cleaning_pending");
  const unitStatusResult = await applyUnitStatus(supabase, booking.unit_id, checkoutUnitStatus);
  if (!unitStatusResult.success) return unitStatusResult;

  // Any unpaid balance remains as a receivable. Do not create a payment or
  // ledger income here unless money was actually collected.

  if (checkoutUnitStatus === "cleaning_pending") {
    const { error: cleaningTaskError } = await supabase.from("cleaning_tasks").insert({
      unit_id: booking.unit_id, daily_booking_id: bookingId, is_completed: false,
    });
    if (cleaningTaskError) return { success: false, error: cleaningTaskError.message };
  }

  await writeAuditLog({
    action: "check_out", entityType: "daily_booking", entityId: bookingId,
    metadata: { final_amount: finalAmount, total_amount: grossAmount, nights, actual_check_out: actualCheckOut, discount: discountAmount, unit_status: checkoutUnitStatus },
  });

  // Sync receivable: update amount, then full financial sync
  const { data: receivables } = await supabase.from("receivables")
    .select("id").eq("source_type", "daily_booking").eq("source_id", bookingId).limit(1);
  if (receivables && receivables.length > 0) {
    await updateReceivableAmount(receivables[0].id, finalAmount);
  }
  await syncBookingFinance(supabase, bookingId);

  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/management"); revalidatePath("/fr/management");
  revalidatePath("/finance"); revalidatePath("/fr/finance");
  revalidatePath("/reports"); revalidatePath("/fr/reports");
  

  return { success: true, data: await getDailyOperationSnapshot(supabase, bookingId, booking.unit_id) };
}

// ── Apply discount (without checking out) ──
export async function applyDiscount(input: {
  bookingId: string; amount: number; reason: string;
}): Promise<DailyActionResult> {
  await guardWrite();
  const supabase = await createClient();
  const gross = input.amount > 0 ? input.amount : 0;
  const { data: booking } = await supabase.from("daily_bookings")
    .select("total_amount_xof, prepaid_amount_xof, status").eq("id", input.bookingId).single();
  if (!booking) return { success: false, error: "Booking not found." };
  if (booking.status !== "checked_in") return { success: false, error: "Discount can only be applied to checked-in bookings." };

  const newFinal = Math.max(0, Number(booking.total_amount_xof) - gross);
  const { data: updatedBooking, error: bookingUpdateError } = await supabase.from("daily_bookings").update({
    manual_discount_amount_xof: gross,
    manual_discount_reason: input.reason,
    final_amount_xof: newFinal,
  }).eq("id", input.bookingId).eq("status", "checked_in").select("id").maybeSingle();
  if (bookingUpdateError) return { success: false, error: bookingUpdateError.message };
  if (!updatedBooking) return { success: false, error: "bookingNotCheckedIn" };

  const { data: receivables } = await supabase.from("receivables")
    .select("id").eq("source_type", "daily_booking").eq("source_id", input.bookingId).limit(1);
  if (receivables && receivables.length > 0) {
    await updateReceivableAmount(receivables[0].id, newFinal);
  }
  await syncBookingFinance(supabase, input.bookingId);

  await writeAuditLog({
    action: "apply_discount", entityType: "daily_booking", entityId: input.bookingId,
    metadata: { discount: gross, reason: input.reason },
  });

  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/management"); revalidatePath("/fr/management");
  revalidatePath("/finance"); revalidatePath("/fr/finance");
  revalidatePath("/reports"); revalidatePath("/fr/reports");
  

  return { success: true, data: await getDailyOperationSnapshot(supabase, input.bookingId) };
}

// ── Set fixed checkout (convert open-ended → fixed) ──

export async function setFixedCheckout(bookingId: string, newCheckOut: string): Promise<DailyActionResult> {
  await guardWrite();
  const supabase = await createClient();

  const { data: booking } = await supabase.from("daily_bookings")
    .select("*").eq("id", bookingId).eq("status", "checked_in").single();
  if (!booking) return { success: false, error: "Booking not found or not checked in." };
  if (booking.checkout_mode !== "open") return { success: false, error: "Only open-ended bookings can be converted." };

  if (newCheckOut <= booking.check_in) {
    return { success: false, error: "Check-out date must be after check-in date." };
  }

  const conflict = await checkConflicts(booking.unit_id, booking.check_in, newCheckOut, bookingId);
  if (conflict.hasConflict) {
    return { success: false, error: conflict.reason ?? "Date conflict detected." };
  }

  const nights = Math.max(1, Math.ceil(
    (new Date(newCheckOut).getTime() - new Date(booking.check_in).getTime()) / (1000 * 60 * 60 * 24)
  ));
  const newTotal = Math.round(nights * Number(booking.nightly_price_xof));
  const discount = Number(booking.manual_discount_amount_xof ?? 0);
  const newFinal = Math.max(0, newTotal - discount);

  const { data: updatedBooking, error: bookingUpdateError } = await supabase.from("daily_bookings").update({
    checkout_mode: "fixed",
    check_out: newCheckOut,
    total_amount_xof: newTotal,
    final_amount_xof: newFinal,
  }).eq("id", bookingId).eq("status", "checked_in").select("id").maybeSingle();
  if (bookingUpdateError) return { success: false, error: bookingUpdateError.message };
  if (!updatedBooking) return { success: false, error: "bookingNotCheckedIn" };

  await writeAuditLog({
    action: "set_fixed_checkout", entityType: "daily_booking", entityId: bookingId,
    metadata: { previous_mode: "open", new_check_out: newCheckOut, new_total: newTotal },
  });

  const { data: receivables } = await supabase.from("receivables")
    .select("id").eq("source_type", "daily_booking").eq("source_id", bookingId).limit(1);
  if (receivables && receivables.length > 0) {
    await updateReceivableAmount(receivables[0].id, newFinal);
  }
  await syncBookingFinance(supabase, bookingId);

  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/management"); revalidatePath("/fr/management");
  revalidatePath("/finance"); revalidatePath("/fr/finance");
  revalidatePath("/reports"); revalidatePath("/fr/reports");

  return { success: true, data: await getDailyOperationSnapshot(supabase, bookingId, booking.unit_id) };
}

// ── Complete cleaning ──
export async function completeCleaning(taskId: string): Promise<DailyActionResult & { taskId?: string; unitId?: string; unitStatus?: UnitStatus }> {
  const user = await guardWrite();
  const supabase = await createClient();
  if (dailyRpcEnabled()) {
    const { data, error } = await supabase.rpc("daily_complete_cleaning_rpc", {
      p_task_id: taskId,
      p_actor: actorPayload(user),
    });
    if (error) return { success: false, error: error.message };
    const snapshot = data as DailyOperationSnapshot;
    const unitStatus = snapshot.unit?.status;
    return { success: true, data: snapshot, taskId, unitId: snapshot.unit?.id, unitStatus };
  }
  const { data: task, error: taskError } = await supabase.from("cleaning_tasks").select("id, unit_id, daily_booking_id, is_completed").eq("id", taskId).single();
  if (taskError || !task) return { success: false, error: "cleaningTaskNotFound" };
  const policy = allowCompleteCleaning(task);
  if (!policy.allowed) return { success: false, error: policy.reason };

  const completedAt = new Date().toISOString();
  const { error: taskUpdateError } = await supabase.from("cleaning_tasks").update({ is_completed: true, completed_at: completedAt }).eq("id", taskId);
  if (taskUpdateError) return { success: false, error: taskUpdateError.message };

  const nextStatus = await resolveUnitStatusAfterDailyChange(supabase, task.unit_id);
  const unitStatusResult = await applyUnitStatus(supabase, task.unit_id, nextStatus);
  if (!unitStatusResult.success) return unitStatusResult;

  const { data: unit } = await supabase.from("units").select("unit_no").eq("id", task.unit_id).single();
  try {
    await writeAuditLog({
      action: "complete_cleaning",
      entityType: "cleaning_task",
      entityId: task.id,
      entityLabel: unit?.unit_no ? `Room ${unit.unit_no}` : null,
      beforeData: { is_completed: task.is_completed },
      afterData: { is_completed: true, completed_at: completedAt },
      metadata: {
        unit_id: task.unit_id,
        unit_no: unit?.unit_no ?? null,
        daily_booking_id: task.daily_booking_id,
        next_status: nextStatus,
      },
    });
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "auditLogWriteFailed" };
  }

  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/front-desk"); revalidatePath("/fr/front-desk");
  revalidatePath("/management"); revalidatePath("/fr/management");
  revalidatePath("/data-quality"); revalidatePath("/fr/data-quality");
  revalidatePath("/settings/audit-logs"); revalidatePath("/fr/settings/audit-logs");

  return { success: true, taskId: task.id, unitId: task.unit_id, unitStatus: nextStatus, data: await getDailyOperationSnapshot(supabase, task.daily_booking_id ?? "", task.unit_id) };
}

export async function extendStay(bookingId: string, newCheckOut: string, extraNights: number, extraAmount: number): Promise<DailyActionResult> {
  await guardWrite();
  if (extraNights <= 0 || extraAmount < 0) {
    return { success: false, error: "Invalid extension amount or nights." };
  }
  const supabase = await createClient();
  const { data: booking } = await supabase.from("daily_bookings")
    .select("*").eq("id", bookingId).eq("status", "checked_in").single();
  if (!booking) return { success: false, error: "Booking not found or not checked in." };

  const newTotal = Number(booking.total_amount_xof) + extraAmount;
  const newFinal = Number(booking.final_amount_xof ?? booking.total_amount_xof) + extraAmount;

  if (booking.checkout_mode === "open") {
    // For open-ended, just update is fine since there's no fixed check_out
    const { data: updatedBooking, error: bookingUpdateError } = await supabase.from("daily_bookings").update({
      total_amount_xof: newTotal,
      final_amount_xof: newFinal,
    }).eq("id", bookingId).eq("status", "checked_in").select("id").maybeSingle();
    if (bookingUpdateError) return { success: false, error: bookingUpdateError.message };
    if (!updatedBooking) return { success: false, error: "bookingNotCheckedIn" };
  } else {
    if (!booking.check_out || newCheckOut <= booking.check_out) {
      return { success: false, error: "New check-out date must be after current check-out date." };
    }
    const conflict = await checkConflicts(booking.unit_id, booking.check_out!, newCheckOut, bookingId);
    if (conflict.hasConflict) return { success: false, error: conflict.reason ?? "Conflict on extended dates." };
    const { data: updatedBooking, error: bookingUpdateError } = await supabase.from("daily_bookings").update({
      check_out: newCheckOut,
      total_amount_xof: newTotal,
      final_amount_xof: newFinal,
    }).eq("id", bookingId).eq("status", "checked_in").select("id").maybeSingle();
    if (bookingUpdateError) return { success: false, error: bookingUpdateError.message };
    if (!updatedBooking) return { success: false, error: "bookingNotCheckedIn" };
  }

  const { data: receivables } = await supabase.from("receivables")
    .select("id").eq("source_type", "daily_booking").eq("source_id", bookingId).limit(1);
  if (receivables && receivables.length > 0) {
    await updateReceivableAmount(receivables[0].id, newFinal);
  }
  await syncBookingFinance(supabase, bookingId);

  await writeAuditLog({
    action: "extend_stay", entityType: "daily_booking", entityId: bookingId,
    metadata: { extra_nights: extraNights, extra_amount: extraAmount },
  });

  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/management"); revalidatePath("/fr/management");
  revalidatePath("/finance"); revalidatePath("/fr/finance");
  revalidatePath("/reports"); revalidatePath("/fr/reports");
  

  return { success: true, data: await getDailyOperationSnapshot(supabase, bookingId, booking.unit_id) };
}

// ── Cancel ──
export async function cancelBooking(bookingId: string): Promise<DailyActionResult> {
  const user = await guardCancel();
  const supabase = await createClient();
  if (dailyRpcEnabled()) {
    const { data, error } = await supabase.rpc("daily_cancel_booking_rpc", {
      p_booking_id: bookingId,
      p_actor: actorPayload(user),
    });
    if (error) return { success: false, error: error.message };
    return { success: true, data: data as DailyOperationSnapshot };
  }
  const { data: booking } = await supabase.from("daily_bookings")
    .select("id, unit_id, status").eq("id", bookingId).single();
  if (!booking) return { success: false, error: "Booking not found." };
  const policy = allowCancelBooking(booking);
  if (!policy.allowed) return { success: false, error: policy.reason };
  const { data: updatedBooking, error: bookingUpdateError } = await supabase
    .from("daily_bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId)
    .in("status", ["pending_review", "confirmed"])
    .select("id")
    .maybeSingle();
  if (bookingUpdateError) return { success: false, error: bookingUpdateError.message };
  if (!updatedBooking) return { success: false, error: "bookingCannotBeCancelled" };
  const nextStatus = await resolveUnitStatusAfterDailyChange(supabase, booking.unit_id, { excludeBookingId: bookingId });
  const unitStatusResult = await applyUnitStatus(supabase, booking.unit_id, nextStatus);
  if (!unitStatusResult.success) return unitStatusResult;

  // Reverse all payments + ledger entries for this booking
  const { data: bookingPayments } = await supabase
    .from("payments")
    .select("id")
    .eq("source_type", "daily_booking")
    .eq("source_id", bookingId);

  if (bookingPayments && bookingPayments.length > 0) {
    for (const p of bookingPayments) {
      await reverseLedgerEntriesForPayment(supabase, p.id);
    }
    await supabase.from("payments").delete().eq("source_type", "daily_booking").eq("source_id", bookingId);
  }

  await writeAuditLog({
    action: "cancel", entityType: "daily_booking", entityId: bookingId,
    metadata: { payments_reversed: bookingPayments?.length ?? 0 },
  });
  await cancelReceivablesForSource("daily_booking", bookingId);
  const { error: resetPaymentError } = await supabase.from("daily_bookings").update({ prepaid_amount_xof: 0 }).eq("id", bookingId);
  if (resetPaymentError) return { success: false, error: resetPaymentError.message };
  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/management"); revalidatePath("/fr/management");
  revalidatePath("/finance"); revalidatePath("/fr/finance");
  revalidatePath("/reports"); revalidatePath("/fr/reports");
  

  return { success: true, data: await getDailyOperationSnapshot(supabase, bookingId, booking.unit_id) };
}
