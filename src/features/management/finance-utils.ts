import type { PaymentRow } from "@/types/database";

const DAILY_PAYMENT_TYPES = new Set(["daily_booking", "daily_rental"]);

export function getCurrentMonthNonDailyPayments(payments: PaymentRow[], monthPrefix: string) {
  return payments
    .filter((payment) => {
      if (!payment.payment_date.startsWith(monthPrefix)) return false;
      return !DAILY_PAYMENT_TYPES.has(payment.source_type);
    })
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date));
}

export function sumPayments(payments: PaymentRow[]) {
  return payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
}
