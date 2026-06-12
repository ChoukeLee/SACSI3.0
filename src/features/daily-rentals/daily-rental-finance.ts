import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Centralized financial calculations for daily rental bookings.
 * Every server action that touches money must go through this module.
 *
 * Invariant: all amounts are XOF integers.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type BillingStatus = "prepaid" | "partially_paid" | "need_top_up" | "settled";

export interface DailyBookingFinanceState {
  /** Original gross total from nightly_price × nights (before discount). */
  grossAmount: number;
  /** Manual discount subtracted from gross. */
  discount: number;
  /** Final amount the customer owes: gross - discount, or explicit override. */
  finalAmount: number;
  /** Total received from all payments for this booking. */
  paidAmount: number;
  /** balanceDue = max(0, finalAmount - paidAmount). */
  balanceDue: number;
  /** Derived billing status. */
  billingStatus: BillingStatus;
}

export interface DailyBookingForFinance {
  id: string;
  unit_id: string;
  customer_id: string;
  check_in: string;
  check_out: string | null;
  checkout_mode: "fixed" | "open" | null;
  actual_check_out: string | null;
  nightly_price_xof: number;
  total_amount_xof: number;
  prepaid_amount_xof: number;
  manual_discount_amount_xof: number | null;
  final_amount_xof: number | null;
  billing_status: string | null;
  status: string;
}

export interface DailyBookingAmountState {
  nights: number;
  grossAmount: number;
  discount: number;
  finalAmount: number;
  effectiveCheckOut: string;
}

// ── Core financial computation ─────────────────────────────────────────────

/** Compute the unified financial state for a booking + its payments. */
export function computeFinanceState(
  booking: DailyBookingForFinance,
  payments: { amount: number }[],
): DailyBookingFinanceState {
  const { grossAmount, discount, finalAmount } = computeBookingAmountState(booking);
  const paidAmount = payments.reduce((s, p) => s + Number(p.amount), 0);
  const balanceDue = Math.max(0, finalAmount - paidAmount);

  const billingStatus = resolveBillingStatus(paidAmount, finalAmount, booking.status);

  return { grossAmount, discount, finalAmount, paidAmount, balanceDue, billingStatus };
}

export function computeBookingAmountState(
  booking: DailyBookingForFinance,
  referenceDate = new Date().toISOString().slice(0, 10),
): DailyBookingAmountState {
  const effectiveCheckOut = resolveEffectiveCheckOut(booking, referenceDate);
  const nights = Math.max(1, dateDiffDays(booking.check_in, effectiveCheckOut));
  const grossAmount = Number(booking.total_amount_xof);
  const discount = Number(booking.manual_discount_amount_xof ?? 0);
  const finalAmount = Math.max(0, grossAmount - discount);

  return { nights, grossAmount, discount, finalAmount, effectiveCheckOut };
}

function resolveEffectiveCheckOut(
  booking: DailyBookingForFinance,
  referenceDate: string,
): string {
  const mode = booking.checkout_mode ?? "fixed";
  if (mode === "fixed" && booking.check_out) return booking.check_out;
  if (mode === "open" && booking.actual_check_out) return booking.actual_check_out;
  return referenceDate;
}

function dateDiffDays(start: string, end: string): number {
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  return Math.ceil((endTime - startTime) / (1000 * 60 * 60 * 24));
}

// ── Billing status resolver ────────────────────────────────────────────────

export function resolveBillingStatus(
  paidAmount: number,
  finalAmount: number,
  bookingStatus?: string,
): BillingStatus {
  if (paidAmount >= finalAmount) {
    return bookingStatus === "checked_out" ? "settled" : "prepaid";
  }
  return paidAmount > 0 ? "partially_paid" : "need_top_up";
}

// ── Payment total (db-bound) ───────────────────────────────────────────────

export async function sumPayments(
  supabase: SupabaseClient,
  bookingId: string,
): Promise<number> {
  const { data } = await supabase
    .from("payments")
    .select("amount")
    .eq("source_type", "daily_booking")
    .eq("source_id", bookingId);
  return (data ?? []).reduce((s, p) => s + Number(p.amount), 0);
}

// ── Sync helpers ───────────────────────────────────────────────────────────

/**
 * Reconcile daily_bookings.prepaid_amount_xof from the canonical
 * receivable.paid_amount_xof. Call this after any payment / receivable change.
 */
export async function syncBookingPrepaidFromReceivables(
  supabase: SupabaseClient,
  bookingId: string,
): Promise<void> {
  const { data: recs } = await supabase
    .from("receivables")
    .select("paid_amount_xof")
    .eq("source_type", "daily_booking")
    .eq("source_id", bookingId)
    .neq("status", "cancelled");
  const canonicalPaid = (recs ?? []).reduce((s, r) => s + Number(r.paid_amount_xof), 0);
  await supabase
    .from("daily_bookings")
    .update({ prepaid_amount_xof: canonicalPaid })
    .eq("id", bookingId);
}

/**
 * Compute and persist billing_status on the booking row.
 */
export async function syncBillingStatus(
  supabase: SupabaseClient,
  bookingId: string,
): Promise<void> {
  const { data: booking } = await supabase
    .from("daily_bookings")
    .select("total_amount_xof, final_amount_xof, prepaid_amount_xof, manual_discount_amount_xof, status")
    .eq("id", bookingId)
    .single();

  if (!booking) return;

  const final = Number(booking.final_amount_xof ?? booking.total_amount_xof);
  const paid = Number(booking.prepaid_amount_xof);
  const status = resolveBillingStatus(paid, final, booking.status);

  await supabase
    .from("daily_bookings")
    .update({ billing_status: status })
    .eq("id", bookingId);
}

export async function syncBookingAmounts(
  supabase: SupabaseClient,
  bookingId: string,
): Promise<DailyBookingAmountState | null> {
  const { data: booking } = await supabase
    .from("daily_bookings")
    .select("id, unit_id, customer_id, check_in, check_out, checkout_mode, actual_check_out, nightly_price_xof, total_amount_xof, prepaid_amount_xof, manual_discount_amount_xof, final_amount_xof, billing_status, status")
    .eq("id", bookingId)
    .single();

  if (!booking || booking.status === "cancelled") return null;

  const amountState = computeBookingAmountState(booking as DailyBookingForFinance);

  await supabase
    .from("daily_bookings")
    .update({
      final_amount_xof: amountState.finalAmount,
    })
    .eq("id", bookingId);

  const { data: receivables } = await supabase
    .from("receivables")
    .select("id, status")
    .eq("source_type", "daily_booking")
    .eq("source_id", bookingId);

  const activeReceivables = (receivables ?? []).filter((r) => r.status !== "cancelled");
  if (activeReceivables.length === 1) {
    await supabase
      .from("receivables")
      .update({ amount_xof: amountState.finalAmount })
      .eq("id", activeReceivables[0].id);
  }

  return amountState;
}

/**
 * Full financial sync after any money-affecting action:
 * 1. Sync receivable paid_amount_xof from payments.
 * 2. Sync booking prepaid_amount_xof from receivables.
 * 3. Sync booking billing_status.
 */
export async function syncBookingFinance(
  supabase: SupabaseClient,
  bookingId: string,
): Promise<void> {
  // Re-export to avoid circular dependency — called from actions.ts
  const { syncReceivablesForSource } = await import("@/features/finance/receivables");
  await syncBookingAmounts(supabase, bookingId);
  await syncReceivablesForSource("daily_booking", bookingId);
  await syncBookingPrepaidFromReceivables(supabase, bookingId);
  await syncBillingStatus(supabase, bookingId);
}

// ── Ledger entry creation ──────────────────────────────────────────────────

export interface LedgerEntryInput {
  bookingId: string;
  unitId: string;
  buildingId: string | null;
  paymentId: string | null;
  amount: number;
  direction: "income" | "expense";
  description: string;
  entryDate?: string;
}

export async function insertLedgerEntry(
  supabase: SupabaseClient,
  input: LedgerEntryInput,
): Promise<void> {
  await supabase.from("ledger_entries").insert({
    building_id: input.buildingId ?? null,
    unit_id: input.unitId,
    payment_id: input.paymentId,
    entry_date: input.entryDate ?? new Date().toISOString().slice(0, 10),
    direction: input.direction,
    category: "daily_rental",
    amount_xof: input.amount,
    description: input.description,
  });
}

/**
 * Reverse all ledger entries linked to a payment.
 * Inserts reversal entries — does NOT delete original rows.
 */
export async function reverseLedgerEntriesForPayment(
  supabase: SupabaseClient,
  paymentId: string,
): Promise<void> {
  const { data: entries } = await supabase
    .from("ledger_entries")
    .select("*")
    .eq("payment_id", paymentId);

  if (!entries || entries.length === 0) return;

  const today = new Date().toISOString().slice(0, 10);
  const reversals = entries.map((e) => {
    const revDirection =
      e.direction === "income" ? "expense" :
      e.direction === "expense" ? "income" :
      e.direction === "liability_in" ? "liability_out" :
      e.direction === "liability_out" ? "liability_in" : e.direction;
    return {
      unit_id: e.unit_id,
      building_id: e.building_id,
      entry_date: today,
      direction: revDirection,
      category: e.category,
      amount_xof: e.amount_xof,
      amount_cny: e.amount_cny,
      description: `冲销 ${e.description ?? "收款记录"}`,
    };
  });
  await supabase.from("ledger_entries").insert(reversals);
}
