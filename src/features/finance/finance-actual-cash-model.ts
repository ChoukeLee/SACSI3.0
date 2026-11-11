import type { PaymentRow } from "@/types/database";
import type { FinanceReadResult } from "./finance-read";
import type { OperatingAssetDirectoryData } from "@/features/asset-operations/operating-asset-directory-model";
import { isNonCashLedgerCategory } from "@/lib/display-labels";

export type ActualCashKind = "income" | "expense" | "deposit_in" | "deposit_out" | "mixed";
export interface FinanceActualCashRow {
  id: string;
  date: string;
  kind: ActualCashKind;
  cashDirection: "in" | "out";
  category: string;
  amountNative: number;
  currency: string;
  bookedAmountXof: number | null;
  assetLabel: string;
  description: string;
  paymentId: string | null;
  ledgerId: string | null;
  operatingAssetId: string | null;
}
export interface FinanceActualCashSnapshot {
  projectId: string;
  dateFrom: string;
  dateTo: string;
  rows: FinanceActualCashRow[];
  incomeXof: number;
  expenseXof: number;
  rentIncomeXof: number;
  rentReceiptCount: number;
  expenseReceiptCount: number;
  depositInXof: number;
  depositOutXof: number;
  nativeTotals: { currency: string; incoming: number; outgoing: number }[];
  unverifiedLedgerCount: number;
  unknownBookedCount: number;
  excludedNonCashCount: number;
  duplicateOperatingCount: number;
  costCoverageComplete: boolean;
}
export interface ActualCashAssetLink {
  id: string;
  payment_id: string | null;
  ledger_entry_id: string | null;
}
type Ledger = FinanceReadResult["rows"][number];
const valid = (value: number) =>
  Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER / 100;
const round = (value: number) => Math.round(value * 100) / 100;
const inPeriod = (date: string, from: string, to: string) => date >= from && date <= to;
const receiptSources = new Set([
  "manual",
  "daily_booking",
  "lease_rent",
  "lease_contract",
  "sale",
  "sale_contract",
  "property_fee",
  "parking_fee",
  "lease_agency_income",
  "lease_furniture_income",
  "lease_other_income",
  "sale_agency_income",
  "sale_other_income",
  "sale_registration_fee",
  "lease_deposit",
  "lease_deposit_refund",
  "lease_rent_refund",
  "sale_refund",
]);
const recognizedPayment = (payment: PaymentRow) =>
  receiptSources.has(payment.source_type) ||
  /^(?:lease|sale)_[a-z_]+_expense$/.test(payment.source_type);

/** Only explicit payment links or verified operating cash facts establish cash.
 * Standalone entries and non-cash allocations never become receipts by renaming. */
export function buildFinanceActualCash({
  projectId,
  dateFrom,
  dateTo,
  ledger,
  payments,
  operations,
  operationLinks = [],
  reversedPaymentIds = [],
}: {
  projectId: string;
  dateFrom: string;
  dateTo: string;
  ledger: Ledger[];
  payments: PaymentRow[];
  operations?: OperatingAssetDirectoryData | null;
  operationLinks?: ActualCashAssetLink[];
  reversedPaymentIds?: string[];
}): FinanceActualCashSnapshot {
  const result: FinanceActualCashSnapshot = {
    projectId,
    dateFrom,
    dateTo,
    rows: [],
    incomeXof: 0,
    expenseXof: 0,
    rentIncomeXof: 0,
    rentReceiptCount: 0,
    expenseReceiptCount: 0,
    depositInXof: 0,
    depositOutXof: 0,
    nativeTotals: [],
    unverifiedLedgerCount: 0,
    unknownBookedCount: 0,
    excludedNonCashCount: 0,
    duplicateOperatingCount: 0,
    // A list of recorded expenses cannot prove that every cost has been supplied.
    costCoverageComplete: false,
  };
  const rowsByPayment = new Map<string, Ledger[]>();
  const seenLedger = new Set<string>();
  for (const row of ledger) {
    if (seenLedger.has(String(row.id))) continue;
    seenLedger.add(String(row.id));
    if (isNonCashLedgerCategory(row.category)) {
      result.excludedNonCashCount++;
      continue;
    }
    if (typeof row.payment_id !== "string") {
      result.unverifiedLedgerCount++;
      continue;
    }
    const linked = rowsByPayment.get(row.payment_id) ?? [];
    linked.push(row);
    rowsByPayment.set(row.payment_id, linked);
  }
  const seenPayments = new Set<string>();
  const paymentMap = new Map(payments.map((payment) => [payment.id, payment]));
  const reversed = new Set([
    ...reversedPaymentIds,
    ...payments.flatMap((payment) =>
      payment.reversal_of_payment_id ? [payment.reversal_of_payment_id] : [],
    ),
  ]);
  const native = new Map<string, { currency: string; incoming: number; outgoing: number }>();
  const addNative = (currency: string, amount: number, outgoing: boolean) => {
    const bucket = native.get(currency) ?? { currency, incoming: 0, outgoing: 0 };
    if (outgoing) bucket.outgoing = round(bucket.outgoing + amount);
    else bucket.incoming = round(bucket.incoming + amount);
    native.set(currency, bucket);
  };
  for (const payment of payments) {
    if (seenPayments.has(payment.id)) continue;
    seenPayments.add(payment.id);
    const linked = rowsByPayment.get(payment.id);
    if (!linked) continue;
    rowsByPayment.delete(payment.id);
    if (payment.payment_method === "offset" || payment.source_type === "lease_deposit_deduction") {
      result.excludedNonCashCount += linked.length;
      continue;
    }
    const amount = Number(payment.amount),
      rate = Number(payment.exchange_rate_to_xof);
    if (
      !valid(amount) ||
      amount <= 0 ||
      payment.reversal_of_payment_id ||
      reversed.has(payment.id) ||
      payment.request_kind?.includes("reversal") ||
      !recognizedPayment(payment) ||
      (payment.currency === "XOF" && rate !== 1) ||
      !["XOF", "CNY", "USD", "EUR"].includes(payment.currency) ||
      (payment.payment_method &&
        !["cash", "check", "bank_transfer", "other"].includes(payment.payment_method)) ||
      !inPeriod(payment.payment_date, dateFrom, dateTo) ||
      linked.some((row) => payment.unit_id && row.unit_id && payment.unit_id !== row.unit_id) ||
      (payment.source_type === "manual" &&
        (linked.length !== 1 ||
          payment.source_id !== linked[0].id ||
          linked[0].entry_date !== payment.payment_date))
    ) {
      result.unverifiedLedgerCount += linked.length;
      continue;
    }
    const booked =
      payment.currency === "XOF"
        ? amount
        : payment.native_settlement || !valid(rate) || rate <= 0
          ? null
          : round(amount * rate);
    const totals = { income: 0, expense: 0, liability_in: 0, liability_out: 0 };
    let validPieces = true;
    for (const row of linked) {
      const direction = String(row.direction) as keyof typeof totals;
      const value = Number(row.amount_xof);
      if (!(direction in totals) || !valid(value) || value < 0) {
        validPieces = false;
        break;
      }
      totals[direction] = round(totals[direction] + value);
    }
    const totalBooked = round(Object.values(totals).reduce((sum, value) => sum + value, 0));
    const nativeProof =
      booked !== null ||
      (linked.every(
        (row) =>
          row.currency === payment.currency &&
          row.amount_native !== null &&
          valid(Number(row.amount_native)) &&
          Number(row.amount_native) > 0,
      ) &&
        Math.abs(linked.reduce((sum, row) => sum + Number(row.amount_native), 0) - amount) <= 0.01);
    if (
      !validPieces ||
      !nativeProof ||
      !valid(totalBooked) ||
      (booked !== null && (!valid(booked) || Math.abs(totalBooked - booked) > 0.01)) ||
      (booked === null && totalBooked !== 0)
    ) {
      result.unverifiedLedgerCount += linked.length;
      continue;
    }
    const directions = new Set(linked.map((row) => String(row.direction)));
    if (
      (directions.has("income") || directions.has("liability_in")) &&
      (directions.has("expense") || directions.has("liability_out"))
    ) {
      result.unverifiedLedgerCount += linked.length;
      continue;
    }
    const outgoing = directions.has("expense") || directions.has("liability_out");
    const kind: ActualCashKind =
      directions.size !== 1
        ? "mixed"
        : directions.has("liability_in")
          ? "deposit_in"
          : directions.has("liability_out")
            ? "deposit_out"
            : directions.has("expense")
              ? "expense"
              : "income";
    const categories = [...new Set(linked.map((row) => String(row.category)))];
    result.rows.push({
      id: `payment:${payment.id}`,
      date: payment.payment_date,
      kind,
      cashDirection: outgoing ? "out" : "in",
      category: categories.length === 1 ? categories[0] : "payment_bundle",
      amountNative: amount,
      currency: payment.currency,
      bookedAmountXof: booked,
      assetLabel: [
        ...new Set(
          linked.map((row) => [row.building_label, row.unit_label].filter(Boolean).join(" · ")),
        ),
      ]
        .filter(Boolean)
        .join(" / "),
      description: linked
        .map((row) => String(row.description || ""))
        .filter(Boolean)
        .join("；"),
      paymentId: payment.id,
      ledgerId: String(linked[0].id),
      operatingAssetId: null,
    });
    addNative(payment.currency, amount, outgoing);
    if (linked.some((row) => row.direction === "income" && row.category === "lease_rent"))
      result.rentReceiptCount++;
    if (directions.has("expense")) result.expenseReceiptCount++;
    if (booked === null) {
      result.unknownBookedCount++;
      continue;
    }
    result.incomeXof = round(result.incomeXof + totals.income);
    result.expenseXof = round(result.expenseXof + totals.expense);
    result.depositInXof = round(result.depositInXof + totals.liability_in);
    result.depositOutXof = round(result.depositOutXof + totals.liability_out);
    result.rentIncomeXof = round(
      result.rentIncomeXof +
        linked.reduce(
          (sum, row) =>
            row.direction === "income" && row.category === "lease_rent"
              ? sum + Number(row.amount_xof)
              : sum,
          0,
        ),
    );
  }
  for (const linked of rowsByPayment.values()) result.unverifiedLedgerCount += linked.length;
  const countedPayments = new Set(result.rows.map((row) => row.paymentId).filter(Boolean));
  const countedLedger = new Set(
    ledger
      .filter((row) => typeof row.payment_id === "string" && countedPayments.has(row.payment_id))
      .map((row) => String(row.id)),
  );
  const links = new Map(operationLinks.map((link) => [link.id, link]));
  if (operations?.projectId === projectId) {
    const assets = new Map(operations.assets.map((asset) => [asset.id, asset]));
    const seenEntries = new Set<string>();
    for (const entry of operations.entries) {
      if (seenEntries.has(entry.id)) continue;
      seenEntries.add(entry.id);
      const asset = assets.get(entry.assetId),
        link = links.get(entry.id);
      if (
        !asset ||
        entry.status !== "verified" ||
        !entry.cashDate ||
        !inPeriod(entry.cashDate, dateFrom, dateTo)
      )
        continue;
      // The identity columns are read explicitly. Never deduplicate by matching amounts or names.
      if (
        (link?.payment_id && countedPayments.has(link.payment_id)) ||
        (link?.ledger_entry_id && countedLedger.has(link.ledger_entry_id))
      ) {
        result.duplicateOperatingCount++;
        continue;
      }
      if (link?.payment_id) {
        const payment = paymentMap.get(link.payment_id);
        if (
          !payment ||
          reversed.has(payment.id) ||
          payment.reversal_of_payment_id ||
          payment.request_kind?.includes("reversal") ||
          payment.payment_method === "offset" ||
          !recognizedPayment(payment) ||
          Number(payment.amount) <= 0 ||
          payment.payment_date !== entry.cashDate ||
          payment.currency !== entry.currency ||
          Number(payment.amount) !== entry.amountNative
        ) {
          result.unverifiedLedgerCount++;
          continue;
        }
      }
      const booked = entry.bookedAmountXof;
      const kind =
        entry.kind === "deposit_in"
          ? "deposit_in"
          : entry.kind === "deposit_out"
            ? "deposit_out"
            : entry.kind;
      result.rows.push({
        id: `operation:${entry.id}`,
        date: entry.cashDate,
        kind,
        cashDirection: kind === "expense" || kind === "deposit_out" ? "out" : "in",
        category: entry.category === "rent" ? "lease_rent" : entry.category || "other",
        amountNative: entry.amountNative,
        currency: entry.currency,
        bookedAmountXof: booked,
        assetLabel: asset.displayName,
        description: entry.description,
        paymentId: null,
        ledgerId: null,
        operatingAssetId: asset.id,
      });
      addNative(entry.currency, entry.amountNative, kind === "expense" || kind === "deposit_out");
      if (kind === "income" && entry.category === "rent") result.rentReceiptCount++;
      if (kind === "expense") result.expenseReceiptCount++;
      if (booked === null) {
        result.unknownBookedCount++;
        continue;
      }
      if (kind === "income") result.incomeXof = round(result.incomeXof + booked);
      if (kind === "expense") result.expenseXof = round(result.expenseXof + booked);
      if (kind === "deposit_in") result.depositInXof = round(result.depositInXof + booked);
      if (kind === "deposit_out") result.depositOutXof = round(result.depositOutXof + booked);
      if (kind === "income" && entry.category === "rent")
        result.rentIncomeXof = round(result.rentIncomeXof + booked);
    }
  }
  result.nativeTotals = [...native.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  result.rows.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return result;
}
