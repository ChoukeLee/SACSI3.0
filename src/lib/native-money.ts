import type { LeaseContractRow, ReceivableRow } from "@/types/database";
import { formatMoney } from "./currency";

/** Independent currency buckets. No conversion or mixing of monetary units. */
export interface NativeCurrencySummary {
  currency: string;
  income: number;
  expense: number;
  liability_in: number;
  liability_out: number;
  receivable: number;
  paid: number;
  outstanding: number;
  overdue: number;
}

export function decodeNativeSummary(value: unknown): NativeCurrencySummary[] {
  if (value === undefined) return []; // Rolling deployment / legacy read model.
  if (!Array.isArray(value)) throw new Error("Invalid native currency summary");
  const seen = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || !["USD", "CNY"].includes(raw.currency) || seen.has(raw.currency))
      throw new Error("Invalid native currency summary");
    seen.add(raw.currency);
    for (const key of ["income", "expense", "liability_in", "liability_out", "receivable", "paid", "outstanding", "overdue"])
      if (typeof raw[key] !== "number" || !Number.isFinite(raw[key])) throw new Error("Invalid native currency amount");
    return raw as NativeCurrencySummary;
  });
}

export function nativeLease(contract: Pick<LeaseContractRow, "rent_currency">): boolean {
  return !!contract.rent_currency && contract.rent_currency !== "XOF";
}

export function leaseRentLabel(contract: LeaseContractRow, locale: "zh" | "fr" = "zh") {
  return nativeLease(contract)
    ? formatMoney(Number(contract.monthly_rent_amount), contract.rent_currency, locale) + ` ${contract.rent_currency}`
    : formatMoney(Number(contract.monthly_rent_xof), "XOF", locale);
}

export function nativeReceivableSummary(rows: ReceivableRow[], currency: string, today: string) {
  return rows.filter((r) => r.currency === currency && r.amount_native != null && r.status !== "cancelled" && (r.management_status ?? "managed") === "managed")
    .reduce((sum, r) => {
      const amount = Number(r.amount_native), paid = Number(r.paid_amount_native);
      const balance = Math.max(0, amount - paid);
      return { total: sum.total + amount, paid: sum.paid + paid, outstanding: sum.outstanding + balance,
        overdue: sum.overdue + (r.due_date < today ? balance : 0) };
    }, { total: 0, paid: 0, outstanding: 0, overdue: 0 });
}

export function financeRowMoney(row: { currency?: unknown; amount_native?: unknown; paid_amount_native?: unknown; amount_xof?: unknown; paid_amount_xof?: unknown }, paid = false) {
  const native = row.amount_native != null;
  return { currency: native ? String(row.currency) : "XOF", amount: Number(row[paid ? (native ? "paid_amount_native" : "paid_amount_xof") : (native ? "amount_native" : "amount_xof")]) };
}

export function financeRowLabel(row: Parameters<typeof financeRowMoney>[0], locale: "zh" | "fr", paid = false) {
  const value = financeRowMoney(row, paid);
  return `${formatMoney(value.amount, value.currency, locale)}${value.currency === "XOF" ? "" : ` ${value.currency}`}`;
}
