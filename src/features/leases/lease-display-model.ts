import { nativeLease } from "@/lib/native-money";
import type { WorkspaceUnit } from "@/features/contracts/workspace-model";
import type { LeaseContractRow, PaymentRow } from "@/types/database";

/** Use the recorded coverage cutoff for every apartment rent reminder badge. */
export function apartmentRentReminderLabel(
  attention: {
    kind: string;
    basis?: "paid_through";
    days: number | null;
    rentReminder?: { paidThrough: string; days: number };
  } | null,
  zh: boolean,
): string | null {
  if (attention?.kind !== "upcoming") return null;
  const days =
    attention.rentReminder?.days ?? (attention.basis === "paid_through" ? attention.days : null);
  if (days === null) return null;
  return days === 0
    ? zh
      ? "今日缴租到期"
      : "Couverture jusqu’à aujourd’hui"
    : zh
      ? `${days}天后缴租到期`
      : `Fin de couverture dans ${days} j`;
}

export function leaseTenantDisplayName(
  unit: Pick<WorkspaceUnit, "leaseTenantDisplay"> | null | undefined,
  sourceName: string | null | undefined,
) {
  const alias = unit?.leaseTenantDisplay;
  return alias && alias.sourceName === sourceName ? alias.displayName : (sourceName ?? undefined);
}

/** Preserve the recorded source currency, without guessing a present exchange rate. */
export function getRecordedOriginalPayment(payment: PaymentRow) {
  const metadata = payment.notes?.match(
    /original_currency=([A-Z]{3});original_amount=([\d.]+);original_period_months=(\d+)/,
  );
  if (!metadata) return null;
  const amount = Number(metadata[2]);
  const periodMonths = Number(metadata[3]);
  if (amount <= 0 || periodMonths <= 0) return null;
  return { currency: metadata[1], amount, periodMonths };
}

export function getOriginalMonthlyRent(contract: LeaseContractRow, payments: PaymentRow[]) {
  if (nativeLease(contract)) return null;
  const contractPayments = payments
    .filter((payment) => payment.source_id === contract.id && payment.source_type === "lease_rent")
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date));
  const originalCurrencyPayments = contractPayments.filter(
    (payment) => payment.currency !== "XOF" && Number(payment.exchange_rate_to_xof) > 0,
  );
  const originalCurrency = originalCurrencyPayments[0]?.currency;
  if (
    originalCurrency &&
    originalCurrencyPayments.every((payment) => payment.currency === originalCurrency)
  ) {
    return {
      currency: originalCurrency,
      amount:
        Number(contract.monthly_rent_xof) /
        Number(originalCurrencyPayments[0].exchange_rate_to_xof),
    };
  }
  for (const payment of contractPayments) {
    const recorded = getRecordedOriginalPayment(payment);
    if (recorded)
      return { currency: recorded.currency, amount: recorded.amount / recorded.periodMonths };
  }
  return null;
}
