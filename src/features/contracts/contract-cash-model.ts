import type { PaymentRow } from "@/types/database";
import { historicalXofAmount } from "@/lib/financial-amount";
import { readCimacContractAllocation } from "./cimac-contract-allocation";
import { isCimacProtectedPayment } from "@/features/finance/cimac-payment-kinds";

export type ContractCashKind = "income" | "expense" | "deposit_in" | "deposit_out" | "excluded";
export interface ContractCashLine {
  kind: ContractCashKind;
  amountXof: number | null;
  reason?:
    | "non_cash_offset"
    | "invalid_amount"
    | "missing_historical_rate"
    | "currency_rate_mismatch"
    | "unsupported_source"
    | "unverified_reversal"
    | "invalid_payment_method"
    | "native_currency";
}

const INCOME_TYPES = new Set([
  "lease_rent",
  "lease_contract",
  "lease_agency_income",
  "lease_furniture_income",
  "lease_other_income",
  "sale",
  "sale_contract",
  "sale_agency_income",
  "sale_registration_fee",
  "sale_other_income",
  "property_fee",
  "parking_fee",
]);
const EXPENSE_TYPES = new Set([
  "lease_rent_refund",
  "lease_agency_expense",
  "lease_other_expense",
  "sale_agency_expense",
  "sale_other_expense",
  "sale_refund",
]);

/** Contract cash projection only. No note guessing, FX defaults, or allocation inference. */
export function classifyContractCashPayment(payment: PaymentRow): ContractCashLine {
  if (isCimacProtectedPayment(payment.source_type)) {
    const allocation = readCimacContractAllocation(payment);
    return allocation
      ? allocation.adjustmentKind === "refund"
        ? { kind: "expense", amountXof: -Number(allocation.amount) }
        : { kind: "income", amountXof: Number(allocation.amount) }
      : { kind: "excluded", amountXof: null, reason: "unsupported_source" };
  }
  if (payment.native_settlement)
    return { kind: "excluded", amountXof: null, reason: "native_currency" };
  if (payment.payment_method === "offset")
    return { kind: "excluded", amountXof: null, reason: "non_cash_offset" };
  if (
    payment.payment_method &&
    !["cash", "check", "bank_transfer", "other"].includes(payment.payment_method)
  )
    return { kind: "excluded", amountXof: null, reason: "invalid_payment_method" };
  if (payment.reversal_of_payment_id || payment.request_kind?.includes("reversal"))
    return { kind: "excluded", amountXof: null, reason: "unverified_reversal" };
  const amount = Number(payment.amount);
  const rate = Number(payment.exchange_rate_to_xof);
  if (!Number.isFinite(amount) || amount <= 0)
    return { kind: "excluded", amountXof: null, reason: "invalid_amount" };
  if (!Number.isFinite(rate) || rate <= 0)
    return { kind: "excluded", amountXof: null, reason: "missing_historical_rate" };
  if (payment.currency === "XOF" && rate !== 1)
    return { kind: "excluded", amountXof: null, reason: "currency_rate_mismatch" };
  if (!["XOF", "CNY", "USD"].includes(payment.currency))
    return { kind: "excluded", amountXof: null, reason: "missing_historical_rate" };
  const amountXof = historicalXofAmount(payment.amount, rate);
  if (amountXof === null) return { kind: "excluded", amountXof: null, reason: "invalid_amount" };
  if (payment.source_type === "lease_deposit") return { kind: "deposit_in", amountXof };
  if (payment.source_type === "lease_deposit_refund") return { kind: "deposit_out", amountXof };
  if (INCOME_TYPES.has(payment.source_type)) return { kind: "income", amountXof };
  if (EXPENSE_TYPES.has(payment.source_type)) return { kind: "expense", amountXof };
  // Deposit deductions are not cash refunds. Daily movements require their strict
  // database read model, including original-receipt and ledger evidence checks.
  return { kind: "excluded", amountXof: null, reason: "unsupported_source" };
}

export function summarizeContractCash(payments: PaymentRow[]) {
  let income = 0,
    expense = 0,
    depositIn = 0,
    depositOut = 0,
    excludedCount = 0,
    nonCashCount = 0;
  for (const payment of payments) {
    if (payment.native_settlement) continue; // Separately displayed in its contractual currency.
    const line = classifyContractCashPayment(payment);
    if (line.kind === "excluded") {
      if (line.reason === "non_cash_offset") nonCashCount++;
      else excludedCount++;
    } else {
      // Aggregate two-decimal minor units so 0.1 + 0.2 never leaks a floating
      // remainder into the read model. Individual conversion uses SQL precision.
      const cents = Math.round(line.amountXof! * 100);
      if (line.kind === "income") income += cents;
      else if (line.kind === "expense") expense += cents;
      else if (line.kind === "deposit_in") depositIn += cents;
      else depositOut += cents;
    }
  }
  return {
    income: income / 100,
    expense: expense / 100,
    net: (income - expense) / 100,
    depositIn: depositIn / 100,
    depositOut: depositOut / 100,
    excludedCount,
    nonCashCount,
  };
}
