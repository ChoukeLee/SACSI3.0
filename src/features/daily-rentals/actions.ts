"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAuth, requireRole } from "@/lib/auth";
import type { DailyBookingRow } from "@/types/database";

// ── Permission guards ──
async function guardWrite() {
  const user = await requireAuth();
  if (user.role === "boss") throw new Error("Boss role is read-only.");
}
async function guardCancel() { await requireRole("admin"); }

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

  return { hasConflict: false };
}

// ── Create booking (supports fixed + open modes) ──

export async function createBooking(input: {
  unitId: string; customerId: string; checkIn: string;
  checkOut?: string; checkoutMode?: "fixed" | "open";
  nightlyPriceXof: number; notes?: string; otaSource?: string;
}): Promise<{ success: boolean; data?: DailyBookingRow; error?: string }> {
  await guardWrite();
  const supabase = await createClient();

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
    prepaid_amount_xof: 0,
    billing_status: "need_top_up",
    status: "pending_review",
    ota_source: input.otaSource ?? null,
    notes: input.notes ?? null,
  }).select("*").single();

  if (error) return { success: false, error: error.message };

  await supabase.from("units").update({ status: "reserved" }).eq("id", input.unitId);
  await supabase.from("audit_logs").insert({
    action: "create", entity_type: "daily_booking", entity_id: data.id,
    metadata: { unit_id: input.unitId, customer_id: input.customerId, check_in: input.checkIn, checkout_mode: mode },
  });

  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/daily-rentals/overview"); revalidatePath("/fr/daily-rentals/overview");
  return { success: true, data };
}

// ── Confirm ──
export async function confirmBooking(bookingId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("daily_bookings").update({ status: "confirmed" }).eq("id", bookingId).eq("status", "pending_review");
  if (error) return { success: false, error: error.message };
  await supabase.from("audit_logs").insert({ action: "confirm", entity_type: "daily_booking", entity_id: bookingId, metadata: {} });
  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/daily-rentals/overview"); revalidatePath("/fr/daily-rentals/overview");
  return { success: true };
}

// ── Check-in (open-ended bookings can check in without prepayment) ──
export async function checkIn(bookingId: string, prepaidAmount: number): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { data: booking } = await supabase.from("daily_bookings")
    .select("*").eq("id", bookingId).eq("status", "confirmed").single();
  if (!booking) return { success: false, error: "Booking not found or not confirmed." };

  // Open-ended bookings can check in without prepayment; fixed bookings require at least partial prepay
  if (booking.checkout_mode !== "open" && prepaidAmount <= 0) {
    return { success: false, error: "At least partial prepayment is required for fixed bookings." };
  }

  const billingStatus = prepaidAmount >= Number(booking.total_amount_xof) ? "prepaid" : "partially_paid";

  await supabase.from("daily_bookings").update({
    status: "checked_in", prepaid_amount_xof: prepaidAmount, billing_status: billingStatus,
  }).eq("id", bookingId);

  await supabase.from("units").update({ status: "daily_occupied" }).eq("id", booking.unit_id);

  if (prepaidAmount > 0) {
    const { data: payment } = await supabase.from("payments").insert({
      customer_id: null, unit_id: booking.unit_id, source_type: "daily_booking", source_id: bookingId,
      payment_date: new Date().toISOString().slice(0, 10), amount: prepaidAmount, currency: "XOF", exchange_rate_to_xof: 1,
    }).select("id").single();
    await supabase.from("ledger_entries").insert({
      building_id: null, unit_id: booking.unit_id, payment_id: payment?.id,
      entry_date: new Date().toISOString().slice(0, 10), direction: "income", category: "daily_rental",
      amount_xof: prepaidAmount, description: `日租预付 booking=${bookingId}`,
    });
  }

  await supabase.from("audit_logs").insert({
    action: "check_in", entity_type: "daily_booking", entity_id: bookingId,
    metadata: { prepaid_amount: prepaidAmount, checkout_mode: booking.checkout_mode },
  });

  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/daily-rentals/overview"); revalidatePath("/fr/daily-rentals/overview");
  return { success: true };
}

// ── Supplementary payment (for open-ended bookings) ──
export async function recordSupplementaryPayment(input: {
  bookingId: string; amount: number; paymentDate?: string; receiptNo?: string;
}): Promise<{ success: boolean; error?: string }> {
  if (input.amount <= 0) return { success: false, error: "Amount must be positive." };
  const supabase = await createClient();

  const { data: booking } = await supabase.from("daily_bookings")
    .select("*").eq("id", input.bookingId).eq("status", "checked_in").single();
  if (!booking) return { success: false, error: "Booking not found or not checked in." };

  const newPrepaid = Number(booking.prepaid_amount_xof) + input.amount;
  const billingStatus = newPrepaid >= Number(booking.final_amount_xof ?? booking.total_amount_xof) ? "prepaid" : "partially_paid";

  await supabase.from("daily_bookings").update({
    prepaid_amount_xof: newPrepaid, billing_status: billingStatus,
  }).eq("id", input.bookingId);

  const { data: payment } = await supabase.from("payments").insert({
    customer_id: booking.customer_id, unit_id: booking.unit_id,
    source_type: "daily_booking", source_id: input.bookingId,
    payment_date: input.paymentDate ?? new Date().toISOString().slice(0, 10),
    amount: input.amount, currency: "XOF", exchange_rate_to_xof: 1,
    receipt_no: input.receiptNo ?? null,
  }).select("id").single();

  await supabase.from("ledger_entries").insert({
    unit_id: booking.unit_id, payment_id: payment?.id,
    entry_date: input.paymentDate ?? new Date().toISOString().slice(0, 10),
    direction: "income", category: "daily_rental",
    amount_xof: input.amount, description: `日租补缴 booking=${input.bookingId}`,
  });

  await supabase.from("audit_logs").insert({
    action: "supplementary_payment", entity_type: "daily_booking", entity_id: input.bookingId,
    metadata: { amount: input.amount, total_prepaid: newPrepaid },
  });

  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/daily-rentals/overview"); revalidatePath("/fr/daily-rentals/overview");
  return { success: true };
}

// ── Check-out (supports fixed + open modes with discount) ──
export async function checkOut(bookingId: string, input: {
  finalAmount?: number; actualCheckOut?: string;
  discountAmount?: number; discountReason?: string;
}): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { data: booking } = await supabase.from("daily_bookings")
    .select("*").eq("id", bookingId).eq("status", "checked_in").single();
  if (!booking) return { success: false, error: "Booking not found or not checked in." };

  const actualCheckOut = input.actualCheckOut ?? new Date().toISOString().slice(0, 10);

  // Calculate final amount if not provided
  let finalAmount = input.finalAmount;
  if (finalAmount == null) {
    const checkIn = new Date(booking.check_in);
    const checkOutDate = new Date(actualCheckOut);
    const nights = Math.max(1, Math.ceil((checkOutDate.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)));
    const gross = Math.round(nights * Number(booking.nightly_price_xof));
    finalAmount = gross - (input.discountAmount ?? 0);
  }

  const update: Record<string, unknown> = {
    status: "checked_out", total_amount_xof: finalAmount,
    final_amount_xof: finalAmount, billing_status: "settled",
  };
  if (booking.checkout_mode === "open") {
    update.actual_check_out = actualCheckOut;
  }
  if (input.discountAmount) {
    update.manual_discount_amount_xof = input.discountAmount;
    update.manual_discount_reason = input.discountReason ?? null;
  }

  await supabase.from("daily_bookings").update(update).eq("id", bookingId);

  await supabase.from("units").update({ status: "cleaning_pending" }).eq("id", booking.unit_id);

  // Remaining payment if needed
  const currentPaid = Number(booking.prepaid_amount_xof);
  const remaining = finalAmount - currentPaid;
  if (remaining > 0) {
    const { data: payment } = await supabase.from("payments").insert({
      customer_id: booking.customer_id, unit_id: booking.unit_id,
      source_type: "daily_booking", source_id: bookingId,
      payment_date: actualCheckOut, amount: remaining, currency: "XOF", exchange_rate_to_xof: 1,
    }).select("id").single();
    await supabase.from("ledger_entries").insert({
      unit_id: booking.unit_id, payment_id: payment?.id,
      entry_date: actualCheckOut, direction: "income", category: "daily_rental",
      amount_xof: remaining, description: `日租结算 booking=${bookingId}`,
    });
  }

  await supabase.from("cleaning_tasks").insert({
    unit_id: booking.unit_id, daily_booking_id: bookingId, is_completed: false,
  });

  await supabase.from("audit_logs").insert({
    action: "check_out", entity_type: "daily_booking", entity_id: bookingId,
    metadata: { final_amount: finalAmount, actual_check_out: actualCheckOut, discount: input.discountAmount ?? 0 },
  });

  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/daily-rentals/overview"); revalidatePath("/fr/daily-rentals/overview");
  return { success: true };
}

// ── Apply discount (without checking out) ──
export async function applyDiscount(input: {
  bookingId: string; amount: number; reason: string;
}): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const gross = input.amount > 0 ? input.amount : 0;
  const { data: booking } = await supabase.from("daily_bookings")
    .select("total_amount_xof, nightly_price_xof, checkout_mode").eq("id", input.bookingId).single();
  if (!booking) return { success: false, error: "Booking not found." };

  const newFinal = Math.max(0, Number(booking.total_amount_xof) - gross);
  await supabase.from("daily_bookings").update({
    manual_discount_amount_xof: gross,
    manual_discount_reason: input.reason,
    final_amount_xof: newFinal,
    billing_status: Number(booking.total_amount_xof) <= newFinal ? "prepaid" : "need_top_up",
  }).eq("id", input.bookingId);

  await supabase.from("audit_logs").insert({
    action: "apply_discount", entity_type: "daily_booking", entity_id: input.bookingId,
    metadata: { discount: gross, reason: input.reason },
  });

  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/daily-rentals/overview"); revalidatePath("/fr/daily-rentals/overview");
  return { success: true };
}

// ── Complete cleaning ──
export async function completeCleaning(taskId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: task } = await supabase.from("cleaning_tasks").select("id, unit_id, is_completed").eq("id", taskId).single();
  if (!task) return { success: false, error: "Cleaning task not found." };
  if (task.is_completed) return { success: false, error: "Task already completed." };
  await supabase.from("cleaning_tasks").update({ is_completed: true, completed_at: new Date().toISOString() }).eq("id", taskId);
  await supabase.from("units").update({ status: "available" }).eq("id", task.unit_id);
  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/daily-rentals/overview"); revalidatePath("/fr/daily-rentals/overview");
  return { success: true };
}

// ── Extend stay ──
export async function extendStay(bookingId: string, newCheckOut: string, extraNights: number, extraAmount: number): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: booking } = await supabase.from("daily_bookings")
    .select("*").eq("id", bookingId).eq("status", "checked_in").single();
  if (!booking) return { success: false, error: "Booking not found or not checked in." };

  if (booking.checkout_mode === "open") {
    // For open-ended, just update is fine since there's no fixed check_out
    await supabase.from("daily_bookings").update({
      total_amount_xof: Number(booking.total_amount_xof) + extraAmount,
      billing_status: "need_top_up",
    }).eq("id", bookingId);
  } else {
    const conflict = await checkConflicts(booking.unit_id, booking.check_out!, newCheckOut, bookingId);
    if (conflict.hasConflict) return { success: false, error: conflict.reason ?? "Conflict on extended dates." };
    await supabase.from("daily_bookings").update({
      check_out: newCheckOut,
      total_amount_xof: Number(booking.total_amount_xof) + extraAmount,
      billing_status: "need_top_up",
    }).eq("id", bookingId);
  }

  await supabase.from("audit_logs").insert({
    action: "extend_stay", entity_type: "daily_booking", entity_id: bookingId,
    metadata: { extra_nights: extraNights, extra_amount: extraAmount },
  });

  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/daily-rentals/overview"); revalidatePath("/fr/daily-rentals/overview");
  return { success: true };
}

// ── Cancel ──
export async function cancelBooking(bookingId: string): Promise<{ success: boolean; error?: string }> {
  await guardCancel();
  const supabase = await createClient();
  const { data: booking } = await supabase.from("daily_bookings")
    .select("id, unit_id, status").eq("id", bookingId).in("status", ["pending_review", "confirmed"]).single();
  if (!booking) return { success: false, error: "Booking not found or cannot be cancelled." };
  await supabase.from("daily_bookings").update({ status: "cancelled" }).eq("id", bookingId);
  await supabase.from("units").update({ status: "available" }).eq("id", booking.unit_id);
  await supabase.from("audit_logs").insert({ action: "cancel", entity_type: "daily_booking", entity_id: bookingId, metadata: {} });
  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/daily-rentals/overview"); revalidatePath("/fr/daily-rentals/overview");
  return { success: true };
}
