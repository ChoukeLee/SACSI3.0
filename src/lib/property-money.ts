import type { LeaseContractRow, PaymentRow } from "@/types/database";
import { formatMoney, paymentDisplay } from "@/lib/currency";
import { formatXofWanExact, historicalXofAmount } from "@/lib/financial-amount";
import { nativeLease } from "@/lib/native-money";

type Locale = "zh" | "fr";
type DisplayAmount = number | string | null | undefined;

/** Formatting for the property workspaces; stored amounts and entry units are unchanged. */
export function formatPropertyXof(value: DisplayAmount, locale: Locale = "zh") {
  return formatXofWanExact(value, locale);
}

/** For cards that render their unit as a separate text element. */
export function formatPropertyXofNumber(value: DisplayAmount, locale: Locale = "zh") {
  return formatXofWanExact(value, locale, false);
}

export function formatPropertyMoney(
  value: DisplayAmount,
  currency: string | null | undefined,
  locale: Locale = "zh",
) {
  const code = String(currency ?? "XOF").toUpperCase();
  if (code === "XOF" || code === "FCFA") return formatPropertyXof(value, locale);
  if (value == null || String(value).trim() === "" || !Number.isFinite(Number(value))) return "—";
  return formatMoney(Number(value), code, locale);
}

export function propertyLeaseRentLabel(contract: LeaseContractRow, locale: Locale = "zh") {
  return nativeLease(contract)
    ? `${formatPropertyMoney(contract.monthly_rent_amount, contract.rent_currency, locale)} ${contract.rent_currency}`
    : formatPropertyXof(contract.monthly_rent_xof, locale);
}

/** Keep existing original-currency and historical-rate rules; scale XOF labels only. */
export function propertyPaymentDisplay(
  payment: Pick<PaymentRow, "amount" | "currency" | "exchange_rate_to_xof" | "native_settlement">,
  locale: Locale = "zh",
): { primary: string; secondary: string | null } {
  const display = paymentDisplay(payment, locale);
  const code = String(payment.currency ?? "XOF").toUpperCase();
  if (code === "XOF" || code === "FCFA")
    return { ...display, primary: formatPropertyXof(payment.amount, locale) };
  if (payment.native_settlement) return display;
  const reference = historicalXofAmount(
    Math.abs(Number(payment.amount)),
    Number(payment.exchange_rate_to_xof),
  );
  return {
    ...display,
    secondary:
      reference === null
        ? display.secondary
        : formatPropertyXof(Number(payment.amount) < 0 ? -reference : reference, locale),
  };
}
