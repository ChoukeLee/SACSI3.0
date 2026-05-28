"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAuth, requireRole } from "@/lib/auth";
import type { DailyBookingRow } from "@/types/database";
import {
  allowCancelBooking,
  allowCheckIn,
  allowCheckOut,
  allowCompleteCleaning,
  allowConfirmBooking,
  allowCreateBooking,
  resolveUnitStatusAfterDailyChange,
} from "./daily-rental-policy";
import {
  createReceivable, syncReceivablesForSource,
  updateReceivableAmount, cancelReceivablesForSource,
} from "@/features/finance/receivables";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Helpers ──

/** Keep daily_bookings.prepaid_amount_xof in sync with receivable.paid_amount_xof after payment changes. */
async function syncBookingPrepaid(supabase: SupabaseClient, bookingId: string) {
  const { data: recs } = await supabase.from("receivables")
    .select("paid_amount_xof")
    .eq("source_type", "daily_booking")
    .eq("source_id", bookingId)
    .neq("status", "cancelled");
  const canonicalPaid = (recs ?? []).reduce((s, r) => s + Number(r.paid_amount_xof), 0);
  await supabase.from("daily_bookings").update({ prepaid_amount_xof: canonicalPaid }).eq("id", bookingId);
}

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

  const createPolicy = allowCreateBooking({
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    checkoutMode: input.checkoutMode,
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

  // Create receivable for this booking
  const { data: unit } = await supabase.from("units").select("building_id").eq("id", input.unitId).single();
  await createReceivable({
    building_id: unit?.building_id ?? null,
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
  

  return { success: true, data };
}

// ── Confirm ──
export async function confirmBooking(bookingId: string): Promise<{ success: boolean; error?: string }> {
  await guardWrite();
  const supabase = await createClient();
  const { data: booking } = await supabase.from("daily_bookings").select("*").eq("id", bookingId).single();
  if (!booking) return { success: false, error: "Booking not found." };
  const policy = allowConfirmBooking(booking);
  if (!policy.allowed) return { success: false, error: policy.reason };

  const { error } = await supabase.from("daily_bookings").update({ status: "confirmed" }).eq("id", bookingId).eq("status", "pending_review");
  if (error) return { success: false, error: error.message };
  await supabase.from("audit_logs").insert({ action: "confirm", entity_type: "daily_booking", entity_id: bookingId, metadata: {} });
  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/management"); revalidatePath("/fr/management");
  

  return { success: true };
}

// ── Check-in (open-ended bookings can check in without prepayment) ──
export async function checkIn(bookingId: string, prepaidAmount: number): Promise<{ success: boolean; error?: string }> {
  await guardWrite();
  const supabase = await createClient();

  const { data: booking } = await supabase.from("daily_bookings")
    .select("*").eq("id", bookingId).single();
  if (!booking) return { success: false, error: "Booking not found." };

  const policy = allowCheckIn(booking, prepaidAmount);
  if (!policy.allowed) return { success: false, error: policy.reason };

  const billingStatus = prepaidAmount >= Number(booking.total_amount_xof) ? "prepaid" : "partially_paid";

  await supabase.from("daily_bookings").update({
    status: "checked_in", prepaid_amount_xof: prepaidAmount, billing_status: billingStatus,
  }).eq("id", bookingId);

  await supabase.from("units").update({ status: "daily_occupied" }).eq("id", booking.unit_id);

  if (prepaidAmount > 0) {
    const { data: unit } = await supabase.from("units").select("building_id").eq("id", booking.unit_id).single();
    const { data: payment } = await supabase.from("payments").insert({
      customer_id: booking.customer_id, unit_id: booking.unit_id, source_type: "daily_booking", source_id: bookingId,
      payment_date: new Date().toISOString().slice(0, 10), amount: prepaidAmount, currency: "XOF", exchange_rate_to_xof: 1,
    }).select("id").single();
    await supabase.from("ledger_entries").insert({
      building_id: unit?.building_id ?? null, unit_id: booking.unit_id, payment_id: payment?.id,
      entry_date: new Date().toISOString().slice(0, 10), direction: "income", category: "daily_rental",
      amount_xof: prepaidAmount, description: `日租预付 booking=${bookingId}`,
    });
  }

  await supabase.from("audit_logs").insert({
    action: "check_in", entity_type: "daily_booking", entity_id: bookingId,
    metadata: { prepaid_amount: prepaidAmount, checkout_mode: booking.checkout_mode },
  });

  // Sync receivable
  if (prepaidAmount > 0) {
    await syncReceivablesForSource("daily_booking", bookingId);
  }
  await syncBookingPrepaid(supabase, bookingId);

  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/management"); revalidatePath("/fr/management");
  

  return { success: true };
}

// ── Supplementary payment (for open-ended bookings) ──
export async function recordSupplementaryPayment(input: {
  bookingId: string; amount: number; paymentDate?: string; receiptNo?: string;
}): Promise<{ success: boolean; error?: string }> {
  await guardWrite();
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

  const { data: unit } = await supabase.from("units").select("building_id").eq("id", booking.unit_id).single();
  const { data: payment } = await supabase.from("payments").insert({
    customer_id: booking.customer_id, unit_id: booking.unit_id,
    source_type: "daily_booking", source_id: input.bookingId,
    payment_date: input.paymentDate ?? new Date().toISOString().slice(0, 10),
    amount: input.amount, currency: "XOF", exchange_rate_to_xof: 1,
    receipt_no: input.receiptNo ?? null,
  }).select("id").single();

  await supabase.from("ledger_entries").insert({
    building_id: unit?.building_id ?? null, unit_id: booking.unit_id, payment_id: payment?.id,
    entry_date: input.paymentDate ?? new Date().toISOString().slice(0, 10),
    direction: "income", category: "daily_rental",
    amount_xof: input.amount, description: `日租补缴 booking=${input.bookingId}`,
  });

  await supabase.from("audit_logs").insert({
    action: "supplementary_payment", entity_type: "daily_booking", entity_id: input.bookingId,
    metadata: { amount: input.amount, total_prepaid: newPrepaid },
  });

  await syncReceivablesForSource("daily_booking", input.bookingId);
  await syncBookingPrepaid(supabase, input.bookingId);

  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/management"); revalidatePath("/fr/management");
  

  return { success: true };
}

// ── Reverse a supplementary payment ──
export async function deletePayment(paymentId: string): Promise<{ success: boolean; error?: string }> {
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
  const { data: entries } = await supabase.from("ledger_entries")
    .select("*").eq("payment_id", paymentId);
  if (entries && entries.length > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const reversals = entries.map(e => {
      const revDirection =
        e.direction === "income" ? "expense" :
        e.direction === "expense" ? "income" :
        e.direction === "liability_in" ? "liability_out" :
        e.direction === "liability_out" ? "liability_in" : e.direction;
      return {
        unit_id: e.unit_id, building_id: e.building_id,
        entry_date: today, direction: revDirection, category: e.category,
        amount_xof: e.amount_xof, amount_cny: e.amount_cny,
        description: `冲销 payment=${paymentId.slice(0, 8)}`,
      };
    });
    await supabase.from("ledger_entries").insert(reversals);
  }

  await supabase.from("payments").delete().eq("id", paymentId);

  await supabase.from("audit_logs").insert({
    action: "payment_reversed", entity_type: "payment", entity_id: paymentId,
    metadata: { amount: payment.amount, booking_id: payment.source_id, unit_id: payment.unit_id },
  });

  await syncReceivablesForSource("daily_booking", payment.source_id);
  await syncBookingPrepaid(supabase, payment.source_id);

  // Recompute billing_status from canonical prepaid
  const { data: bookingAfter } = await supabase.from("daily_bookings")
    .select("prepaid_amount_xof, final_amount_xof, total_amount_xof, status")
    .eq("id", payment.source_id).single();
  if (bookingAfter) {
    const final = Number(bookingAfter.final_amount_xof ?? bookingAfter.total_amount_xof);
    const prepaid = Number(bookingAfter.prepaid_amount_xof);
    const billingStatus = bookingAfter.status === "checked_out" || prepaid >= final ? bookingAfter.status === "checked_out" ? "settled" : "prepaid" : "partially_paid";
    await supabase.from("daily_bookings").update({ billing_status: billingStatus }).eq("id", payment.source_id);
  }

  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/management"); revalidatePath("/fr/management");

  return { success: true };
}

// ── Check-out (supports fixed + open modes with discount) ──
export async function checkOut(bookingId: string, input: {
  finalAmount?: number; actualCheckOut?: string;
  discountAmount?: number; discountReason?: string;
}): Promise<{ success: boolean; error?: string }> {
  await guardWrite();
  const supabase = await createClient();

  const { data: booking } = await supabase.from("daily_bookings")
    .select("*").eq("id", bookingId).single();
  if (!booking) return { success: false, error: "Booking not found." };
  const policy = allowCheckOut(booking);
  if (!policy.allowed) return { success: false, error: policy.reason };

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
    const { data: unit } = await supabase.from("units").select("building_id").eq("id", booking.unit_id).single();
    const { data: payment } = await supabase.from("payments").insert({
      customer_id: booking.customer_id, unit_id: booking.unit_id,
      source_type: "daily_booking", source_id: bookingId,
      payment_date: actualCheckOut, amount: remaining, currency: "XOF", exchange_rate_to_xof: 1,
    }).select("id").single();
    await supabase.from("ledger_entries").insert({
      building_id: unit?.building_id ?? null, unit_id: booking.unit_id, payment_id: payment?.id,
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

  // Sync receivable: update amount for open bookings, then sync paid amount
  const { data: receivables } = await supabase.from("receivables")
    .select("id").eq("source_type", "daily_booking").eq("source_id", bookingId).limit(1);
  if (receivables && receivables.length > 0) {
    await updateReceivableAmount(receivables[0].id, finalAmount);
  }
  await syncReceivablesForSource("daily_booking", bookingId);
  await syncBookingPrepaid(supabase, bookingId);

  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/management"); revalidatePath("/fr/management");
  

  return { success: true };
}

// ── Apply discount (without checking out) ──
export async function applyDiscount(input: {
  bookingId: string; amount: number; reason: string;
}): Promise<{ success: boolean; error?: string }> {
  await guardWrite();
  const supabase = await createClient();
  const gross = input.amount > 0 ? input.amount : 0;
  const { data: booking } = await supabase.from("daily_bookings")
    .select("total_amount_xof, prepaid_amount_xof, nightly_price_xof, checkout_mode").eq("id", input.bookingId).single();
  if (!booking) return { success: false, error: "Booking not found." };

  const newFinal = Math.max(0, Number(booking.total_amount_xof) - gross);
  await supabase.from("daily_bookings").update({
    manual_discount_amount_xof: gross,
    manual_discount_reason: input.reason,
    final_amount_xof: newFinal,
    billing_status: Number(booking.prepaid_amount_xof) >= newFinal ? "prepaid" : "need_top_up",
  }).eq("id", input.bookingId);

  await supabase.from("audit_logs").insert({
    action: "apply_discount", entity_type: "daily_booking", entity_id: input.bookingId,
    metadata: { discount: gross, reason: input.reason },
  });

  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/management"); revalidatePath("/fr/management");
  

  return { success: true };
}

// ── Set fixed checkout (convert open-ended → fixed) ──

export async function setFixedCheckout(bookingId: string, newCheckOut: string): Promise<{ success: boolean; error?: string }> {
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
  const newBillingStatus = Number(booking.prepaid_amount_xof) >= newTotal ? "prepaid" : "need_top_up";

  await supabase.from("daily_bookings").update({
    checkout_mode: "fixed",
    check_out: newCheckOut,
    total_amount_xof: newTotal,
    billing_status: newBillingStatus,
  }).eq("id", bookingId);

  await supabase.from("audit_logs").insert({
    action: "set_fixed_checkout", entity_type: "daily_booking", entity_id: bookingId,
    metadata: { previous_mode: "open", new_check_out: newCheckOut, new_total: newTotal },
  });

  const { data: receivables } = await supabase.from("receivables")
    .select("id").eq("source_type", "daily_booking").eq("source_id", bookingId).limit(1);
  if (receivables && receivables.length > 0) {
    await updateReceivableAmount(receivables[0].id, newTotal);
  }

  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/management"); revalidatePath("/fr/management");

  return { success: true };
}

// ── Complete cleaning ──
export async function completeCleaning(taskId: string): Promise<{ success: boolean; error?: string }> {
  await guardWrite();
  const supabase = await createClient();
  const { data: task } = await supabase.from("cleaning_tasks").select("id, unit_id, is_completed").eq("id", taskId).single();
  const policy = allowCompleteCleaning(task);
  if (!policy.allowed) return { success: false, error: policy.reason };
  if (!task) return { success: false, error: "cleaningTaskNotFound" };
  await supabase.from("cleaning_tasks").update({ is_completed: true, completed_at: new Date().toISOString() }).eq("id", taskId);
  const nextStatus = await resolveUnitStatusAfterDailyChange(supabase, task.unit_id);
  await supabase.from("units").update({ status: nextStatus }).eq("id", task.unit_id);
  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/management"); revalidatePath("/fr/management");
  

  return { success: true };
}

// ── Extend stay ──
export async function extendStay(bookingId: string, newCheckOut: string, extraNights: number, extraAmount: number): Promise<{ success: boolean; error?: string }> {
  await guardWrite();
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
  revalidatePath("/management"); revalidatePath("/fr/management");
  

  return { success: true };
}

// ── Cancel ──
export async function cancelBooking(bookingId: string): Promise<{ success: boolean; error?: string }> {
  await guardCancel();
  const supabase = await createClient();
  const { data: booking } = await supabase.from("daily_bookings")
    .select("id, unit_id, status").eq("id", bookingId).single();
  if (!booking) return { success: false, error: "Booking not found." };
  const policy = allowCancelBooking(booking);
  if (!policy.allowed) return { success: false, error: policy.reason };
  await supabase.from("daily_bookings").update({ status: "cancelled" }).eq("id", bookingId);
  const nextStatus = await resolveUnitStatusAfterDailyChange(supabase, booking.unit_id, { excludeBookingId: bookingId });
  await supabase.from("units").update({ status: nextStatus }).eq("id", booking.unit_id);
  await supabase.from("audit_logs").insert({ action: "cancel", entity_type: "daily_booking", entity_id: bookingId, metadata: {} });
  await cancelReceivablesForSource("daily_booking", bookingId);
  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/management"); revalidatePath("/fr/management");
  

  return { success: true };
}
