import type { DailyBookingRow } from "@/types/database";
import type { ReceiptSummary } from "./receipt-analysis-types";
import { calculateBilling } from "./billing";

export interface CalendarFinanceSnapshot {
  month: string;
  today: string;
  cash: ReceiptSummary | null;
  /** Legacy shape only; cash details are fetched separately with their classifier evidence. */
  includedPaymentIds?: string[];
  currentOutstanding: number;
  monthSettled: number;
}

/** Complete booking-position totals, not a cash-receipt metric. */
export function dailyBookingFinancePosition(bookings: DailyBookingRow[], today: string) {
  let currentOutstanding = 0;
  let monthSettled = 0;
  const outstandingBookings: DailyBookingRow[] = [];
  const settledBookings: DailyBookingRow[] = [];
  for (const booking of bookings) {
    if (booking.status !== "checked_in" && booking.status !== "checked_out") continue;
    const billing = calculateBilling(booking, today);
    if (billing.outstanding > 0) {
      currentOutstanding += billing.outstanding;
      outstandingBookings.push(booking);
    }
    // Do not infer an actual departure from a planned checkout date.
    if (
      booking.status === "checked_out" &&
      booking.actual_check_out?.startsWith(today.slice(0, 7))
    ) {
      monthSettled += billing.finalAmount;
      settledBookings.push(booking);
    }
  }
  return { currentOutstanding, monthSettled, outstandingBookings, settledBookings };
}
