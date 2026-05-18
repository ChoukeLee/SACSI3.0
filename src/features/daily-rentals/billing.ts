import type { DailyBookingRow } from "@/types/database";

/**
 * Centralized billing calculation for daily rental bookings.
 * All amount logic lives here — no scattering across pages.
 */

export interface BillingResult {
  /** Number of nights from check_in to referenceDate (or check_out/actual_check_out) */
  nights: number;
  /** Gross amount = nights × nightly_price_xof */
  grossAmount: number;
  /** Manual discount applied by admin */
  discount: number;
  /** Final amount = grossAmount - discount (or stored final_amount_xof) */
  finalAmount: number;
  /** Already paid */
  paid: number;
  /** Outstanding = finalAmount - paid */
  outstanding: number;
  /** Has stayed 30+ nights (monthly discount hint) */
  eligibleForMonthlyDiscount: boolean;
  /** Check-out mode */
  mode: "fixed" | "open";
  /** Effective end date for calculation */
  effectiveCheckOut: string;
}

export function calculateBilling(
  booking: DailyBookingRow,
  referenceDate?: string
): BillingResult {
  const mode = booking.checkout_mode ?? "fixed";
  const checkIn = new Date(booking.check_in);
  const today = new Date(referenceDate ?? new Date().toISOString().slice(0, 10));

  // Determine effective check-out date
  let effectiveCheckOut: Date;
  if (mode === "fixed" && booking.check_out) {
    effectiveCheckOut = new Date(booking.check_out);
  } else if (mode === "open" && booking.actual_check_out) {
    effectiveCheckOut = new Date(booking.actual_check_out);
  } else {
    // Open-ended without actual checkout: calculate up to today
    effectiveCheckOut = today;
  }

  // Minimum 1 night
  const nights = Math.max(1, Math.ceil(
    (effectiveCheckOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)
  ));

  const grossAmount = Math.round(nights * Number(booking.nightly_price_xof));
  const discount = Number(booking.manual_discount_amount_xof) || 0;
  const finalAmount = booking.final_amount_xof != null
    ? Number(booking.final_amount_xof)
    : grossAmount - discount;

  const paid = Number(booking.prepaid_amount_xof) || 0;

  return {
    nights,
    grossAmount,
    discount,
    finalAmount,
    paid,
    outstanding: Math.max(0, finalAmount - paid),
    eligibleForMonthlyDiscount: nights >= 30 && mode === "open",
    mode,
    effectiveCheckOut: effectiveCheckOut.toISOString().slice(0, 10),
  };
}

/**
 * Short billing mode label for overview display.
 */
export function billingModeLabel(mode: "fixed" | "open", locale: "zh" | "fr"): string {
  if (locale === "zh") {
    return mode === "fixed" ? "固定离店" : "开放式入住";
  }
  return mode === "fixed" ? "Départ fixe" : "Séjour ouvert";
}
