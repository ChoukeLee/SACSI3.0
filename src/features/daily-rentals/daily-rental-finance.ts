import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Centralized financial calculations for daily rental bookings.
 * Display calculations and an admin-only transaction repair facade.
 * Normal financial writes use their domain database RPCs.
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
  const isRunningOpenStay =
    (booking.checkout_mode ?? "fixed") === "open" &&
    booking.status === "checked_in" &&
    !booking.actual_check_out;
  const grossAmount = isRunningOpenStay
    ? Math.round(nights * Number(booking.nightly_price_xof))
    : Number(booking.total_amount_xof);
  const discount = Number(booking.manual_discount_amount_xof ?? 0);
  const finalAmount = Math.max(0, grossAmount - discount);

  return { nights, grossAmount, discount, finalAmount, effectiveCheckOut };
}

function resolveEffectiveCheckOut(booking: DailyBookingForFinance, referenceDate: string): string {
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

/** Admin repair only; ordinary receipts already synchronize inside their own RPC. */
export async function syncBookingFinance(
  supabase: SupabaseClient,
  bookingId: string,
  context?: { note?: string; issueId?: string },
): Promise<void> {
  const { data, error } = await supabase.rpc("finance_operation_rpc", {
    p_operation: "daily_sync",
    p_input: { bookingId, ...context },
    p_request_id: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error("财务同步结果未知，请核对审计后重试。");
}
