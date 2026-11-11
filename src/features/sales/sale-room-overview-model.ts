import type {
  CustomerRow,
  PaymentRow,
  ReceivableRow,
  SaleContractRow,
  SalePaymentScheduleRow,
} from "@/types/database";
import type { CurrencyCode } from "@/types/domain";
import type { WorkspaceUnit } from "@/features/contracts/workspace-model";
import type { LeaseBuilding } from "@/features/leases/project-scope";
import { salePrice, saleScheduleReceivable } from "./sale-workbench-model";

export interface SaleCurrencyAmount {
  currency: CurrencyCode;
  amount: number;
}
export interface SaleRegisteredBalance extends SaleCurrencyAmount {
  sourceRef: string;
}
export interface SalePendingBalanceSource extends SaleCurrencyAmount {
  id: string;
  category: string;
  title: string;
  notes: string | null;
  paymentDateUnspecified: boolean;
}
export interface SaleRecordAttention {
  kind: "overdue" | "upcoming" | "review" | "unsettled";
  dueDate: string | null;
  days: number | null;
  amounts: SaleCurrencyAmount[];
}
export interface SaleRecordOverviewRow {
  id: string;
  contract: SaleContractRow;
  unit: WorkspaceUnit;
  building: LeaseBuilding | null;
  customer: CustomerRow | null;
  historical: boolean;
  conflict: boolean;
  reviewReasons: string[];
  priceXof: number | null;
  priceNative?: SaleCurrencyAmount | null;
  registeredBalance?: SaleRegisteredBalance | null;
  /** Existing historical-pending bill balances, not managed principal or an agreed due date. */
  pendingBalanceNative?: SaleCurrencyAmount[];
  pendingBalanceSources?: SalePendingBalanceSource[];
  receivedNative: SaleCurrencyAmount[];
  outstandingNative: SaleCurrencyAmount[] | null;
  attention: SaleRecordAttention | null;
  nextDue: string | null;
}
export interface SaleRoomOverviewRow {
  unit: WorkspaceUnit;
  building: LeaseBuilding | null;
  record: SaleRecordOverviewRow | null;
  records: SaleRecordOverviewRow[];
  conflict: boolean;
  reviewReasons: string[];
}
export interface SaleRoomOverviewInput {
  units: readonly WorkspaceUnit[];
  contracts: readonly SaleContractRow[];
  customers: readonly CustomerRow[];
  buildings: readonly (Pick<LeaseBuilding, "id" | "code" | "display_name"> &
    Partial<Pick<LeaseBuilding, "project_id" | "project">>)[];
  today: string;
  /** These arrays must be the complete scoped context, never the selected record's detail. */
  payments?: readonly PaymentRow[];
  receivables?: readonly ReceivableRow[];
  schedules?: readonly SalePaymentScheduleRow[];
}
export const SALE_ROOM_PAYMENT_TYPES = [
  "sale",
  "sale_contract",
  "sale_refund",
  "property_fee",
  "parking_fee",
  "sale_registration_fee",
  "sale_agency_income",
  "sale_agency_expense",
  "sale_other_income",
  "sale_other_expense",
];
const currencies = ["XOF", "USD", "CNY"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function date(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
  );
}
function cents(value: unknown, signed = false): number | null {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))
  )
    return null;
  const n = Number(value),
    minor = Math.round(n * 100);
  return Number.isFinite(n) &&
    (signed || n >= 0) &&
    Number.isSafeInteger(minor) &&
    Math.abs(minor / 100 - n) < 0.0000001
    ? minor
    : null;
}
function totals(rows: { currency: CurrencyCode; amount: number }[]): SaleCurrencyAmount[] {
  const values = new Map<CurrencyCode, number>();
  for (const row of rows) values.set(row.currency, (values.get(row.currency) ?? 0) + row.amount);
  return [...values]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => ({ currency, amount: amount / 100 }));
}

/** Preserve stored bill balances without turning old imported dates into payment agreements. */
export function buildSalePendingBalanceSummary(
  contract: SaleContractRow,
  unit: WorkspaceUnit,
  receivables: readonly ReceivableRow[],
) {
  const sources: SalePendingBalanceSource[] = [];
  const ids = new Set<string>();
  for (const row of receivables) {
    if (
      row.source_type !== "sale_contract" ||
      row.source_id !== contract.id ||
      row.management_status !== "historical_pending" ||
      row.status === "cancelled"
    )
      continue;
    if (ids.has(row.id)) return { pendingBalanceNative: [], pendingBalanceSources: [] };
    ids.add(row.id);
    const native = row.currency !== "XOF";
    const amount = cents(native ? row.amount_native : row.amount_xof);
    const paid = cents(native ? row.paid_amount_native : row.paid_amount_xof);
    if (
      !["pending", "partial", "paid", "overdue"].includes(row.status) ||
      !currencies.includes(row.currency) ||
      amount === null ||
      paid === null ||
      paid > amount ||
      (row.status === "paid" && paid !== amount) ||
      (row.unit_id !== null && row.unit_id !== unit.id) ||
      (row.building_id !== null && row.building_id !== unit.building_id) ||
      (row.customer_id !== null && row.customer_id !== contract.customer_id)
    )
      continue;
    if (amount === paid) continue;
    const notes = typeof row.notes === "string" ? row.notes : null;
    sources.push({
      id: row.id,
      category: row.category,
      title: row.title,
      currency: row.currency as CurrencyCode,
      amount: (amount - paid) / 100,
      notes,
      paymentDateUnspecified:
        !!notes && /尾款付款安排未约定|未约定付款日|暂无付款日|暂无明确付款日/.test(notes),
    });
  }
  return {
    pendingBalanceNative: totals(
      sources.map((source) => ({ currency: source.currency, amount: cents(source.amount)! })),
    ),
    pendingBalanceSources: sources,
  };
}

/** Registered total, independent of receipts and receivable allocations. */
export function saleRegisteredPrice(contract: SaleContractRow): SaleCurrencyAmount | null {
  const currency = contract.sale_currency ?? "XOF";
  if (currency === "XOF") {
    const amount = salePrice(contract);
    return amount === null ? null : { currency, amount };
  }
  const amount = cents(contract.total_amount_native);
  return ["USD", "CNY"].includes(currency) &&
    contract.total_amount_confirmed === true &&
    contract.total_amount_xof !== null &&
    Number(contract.total_amount_xof) === 0 &&
    amount !== null &&
    amount > 0
    ? { currency, amount: amount / 100 }
    : null;
}

/** Source-stated purchase balance, independent of verified bills and payment allocations. */
export function saleRegisteredBalance(contract: SaleContractRow): SaleRegisteredBalance | null {
  const currency = contract.sale_currency ?? "XOF",
    amount = cents(contract.source_balance_native);
  return contract.registration_basis === "source_record" &&
    typeof contract.source_reference === "string" &&
    !!contract.source_reference.trim() &&
    typeof contract.source_balance_reference === "string" &&
    !!contract.source_balance_reference.trim() &&
    currencies.includes(currency) &&
    amount !== null
    ? { currency, amount: amount / 100, sourceRef: contract.source_balance_reference }
    : null;
}

/** Original-currency gross purchase receipts. Unknown historical method is not an offset. */
export function buildSalePurchaseReceiptSummary(
  contract: SaleContractRow,
  payments: readonly PaymentRow[],
) {
  const receipts: { currency: CurrencyCode; amount: number }[] = [],
    reviewReasons: string[] = [];
  const seen = new Set<string>();
  for (const payment of payments) {
    if (
      payment.source_id !== contract.id ||
      !["sale", "sale_contract"].includes(payment.source_type)
    )
      continue;
    if (seen.has(payment.id)) {
      reviewReasons.push("duplicate_cash_record");
      continue;
    }
    seen.add(payment.id);
    if (
      payment.payment_method === "offset" ||
      payment.reversal_of_payment_id ||
      payment.request_kind?.includes("reversal")
    )
      continue;
    const amount = cents(payment.amount),
      rate = Number(payment.exchange_rate_to_xof);
    const moneyBasis =
      payment.native_settlement === true
        ? payment.source_type === "sale_contract" &&
          ["USD", "CNY"].includes(payment.currency) &&
          payment.currency === (contract.sale_currency ?? "XOF") &&
          payment.unit_id === contract.unit_id &&
          payment.customer_id === contract.customer_id &&
          payment.exchange_rate_to_xof === null
        : Number.isFinite(rate) && rate > 0 && (payment.currency !== "XOF" || rate === 1);
    if (
      !currencies.includes(payment.currency) ||
      !date(payment.payment_date) ||
      amount === null ||
      amount <= 0 ||
      !moneyBasis ||
      (payment.payment_method != null &&
        !["cash", "check", "bank_transfer", "other"].includes(String(payment.payment_method))) ||
      (payment.unit_id !== null && payment.unit_id !== contract.unit_id) ||
      (payment.customer_id !== null && payment.customer_id !== contract.customer_id)
    ) {
      reviewReasons.push("cash_record_requires_review");
      continue;
    }
    receipts.push({ currency: payment.currency, amount });
  }
  return { amounts: totals(receipts), reviewReasons: [...new Set(reviewReasons)] };
}

/** Fail closed on incomplete or out-of-scope supplemental sale context reads. */
export function decodeSaleRoomFinance(
  value: { payments: unknown; receivables: unknown; schedules: unknown },
  contracts: readonly SaleContractRow[],
  units: readonly WorkspaceUnit[],
) {
  const records = new Map(contracts.map((row) => [row.id, row])),
    assets = new Map(units.map((row) => [row.id, row]));
  const invalid = () => new Error("SaleRoomFinanceUnavailable");
  function array<T>(raw: unknown, validate: (row: T) => boolean): T[] {
    if (!Array.isArray(raw)) throw invalid();
    const seen = new Set<string>();
    for (const item of raw) {
      if (
        !item ||
        typeof item !== "object" ||
        typeof item.id !== "string" ||
        !uuid.test(item.id) ||
        seen.has(item.id) ||
        !validate(item as T)
      )
        throw invalid();
      seen.add(item.id);
    }
    return raw as T[];
  }
  function matches(row: {
    source_id: string | null;
    unit_id: string | null;
    customer_id: string | null;
    building_id?: string | null;
  }) {
    const c = records.get(row.source_id ?? ""),
      u = c ? assets.get(c.unit_id) : undefined;
    return (
      !!c &&
      !!u &&
      (row.unit_id === null || row.unit_id === u.id) &&
      (row.customer_id === null || row.customer_id === c.customer_id) &&
      (row.building_id === undefined ||
        row.building_id === null ||
        row.building_id === u.building_id)
    );
  }
  const receivables = array<ReceivableRow>(
    value.receivables,
    (row) =>
      row.source_type === "sale_contract" &&
      matches(row) &&
      currencies.includes(row.currency) &&
      ["pending", "partial", "paid", "overdue", "cancelled"].includes(row.status) &&
      ["managed", "historical_pending", "excluded", null].includes(row.management_status ?? null) &&
      typeof row.category === "string" &&
      date(row.due_date) &&
      cents(row.amount_xof) !== null &&
      cents(row.paid_amount_xof) !== null &&
      (row.amount_native == null || cents(row.amount_native) !== null) &&
      (row.paid_amount_native == null || cents(row.paid_amount_native) !== null),
  );
  const payments = array<PaymentRow>(
    value.payments,
    (row) =>
      matches(row) &&
      SALE_ROOM_PAYMENT_TYPES.includes(row.source_type) &&
      currencies.includes(row.currency) &&
      date(row.payment_date) &&
      cents(row.amount, true) !== null &&
      typeof row.native_settlement === "boolean" &&
      (!row.native_settlement ||
        (row.source_type === "sale_contract" &&
          ["USD", "CNY"].includes(row.currency) &&
          row.currency === (records.get(row.source_id ?? "")?.sale_currency ?? "XOF") &&
          row.unit_id === records.get(row.source_id ?? "")?.unit_id &&
          row.customer_id === records.get(row.source_id ?? "")?.customer_id &&
          row.exchange_rate_to_xof === null)) &&
      (row.exchange_rate_to_xof === null ||
        (Number.isFinite(Number(row.exchange_rate_to_xof)) &&
          Number(row.exchange_rate_to_xof) > 0)) &&
      (row.payment_method === null ||
        ["cash", "check", "bank_transfer", "other", "offset"].includes(
          String(row.payment_method),
        )) &&
      (row.request_kind === null || typeof row.request_kind === "string") &&
      (row.reversal_of_payment_id === null ||
        (typeof row.reversal_of_payment_id === "string" && uuid.test(row.reversal_of_payment_id))),
  );
  const bills = new Map(receivables.map((row) => [row.id, row]));
  const schedules = array<SalePaymentScheduleRow>(
    value.schedules,
    (row) =>
      records.has(row.sale_contract_id) &&
      date(row.due_date) &&
      cents(row.amount_xof) !== null &&
      Number.isSafeInteger(row.installment_no) &&
      row.installment_no > 0 &&
      ["pending", "partial", "paid", "overdue", "cancelled"].includes(row.status) &&
      (!row.receivable_id || bills.get(row.receivable_id)?.source_id === row.sale_contract_id),
  );
  return { payments, receivables, schedules };
}

function finance(
  record: SaleContractRow,
  unit: WorkspaceUnit,
  historical: boolean,
  input: SaleRoomOverviewInput,
  reviews: string[],
) {
  if (input.payments === undefined) reviews.push("cash_records_not_read");
  const receiptSummary = buildSalePurchaseReceiptSummary(record, input.payments ?? []);
  reviews.push(...receiptSummary.reviewReasons);
  const receivedNative = receiptSummary.amounts;
  if (input.receivables === undefined || input.schedules === undefined) {
    reviews.push("complete_financial_context_not_read");
    return { receivedNative, outstandingNative: null, attention: null, nextDue: null };
  }
  const rows = input.receivables.filter(
    (row) => row.source_type === "sale_contract" && row.source_id === record.id,
  );
  const open: { currency: CurrencyCode; amount: number; dueDate: string }[] = [];
  const principalBalances: { currency: CurrencyCode; amount: number }[] = [];
  let uncertain = false;
  let verifiedBills = 0;
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.status === "cancelled" || row.management_status === "excluded") continue;
    const native = row.currency !== "XOF",
      amount = cents(native ? row.amount_native : row.amount_xof),
      paid = cents(native ? row.paid_amount_native : row.paid_amount_xof);
    const balance = amount !== null && paid !== null ? amount - paid : null;
    const shadowAmount = cents(row.amount_xof),
      shadowPaid = cents(row.paid_amount_xof);
    const evidence =
      balance !== null
        ? balance > 0
        : row.status === "partial" ||
          row.status === "overdue" ||
          (row.status === "pending" &&
            ((amount !== null && amount > 0) ||
              (shadowAmount !== null && shadowPaid !== null && shadowAmount > shadowPaid)));
    const valid =
      !seen.has(row.id) &&
      ["pending", "partial", "paid", "overdue"].includes(row.status) &&
      currencies.includes(row.currency) &&
      date(row.due_date) &&
      amount !== null &&
      paid !== null &&
      paid <= amount &&
      (row.status !== "paid" || balance === 0) &&
      (row.unit_id === null || row.unit_id === unit.id) &&
      (row.building_id === null || row.building_id === unit.building_id) &&
      (row.customer_id === null || row.customer_id === record.customer_id);
    seen.add(row.id);
    if (!valid) {
      reviews.push("billing_data_conflict");
      uncertain ||= evidence;
      continue;
    }
    if (row.management_status === "managed") {
      verifiedBills++;
      if (["sale_lump_sum", "sale_installment"].includes(row.category))
        principalBalances.push({ currency: row.currency as CurrencyCode, amount: balance! });
    }
    if (balance === 0) continue;
    if (row.management_status !== "managed") {
      reviews.push("historical_balance_requires_review");
      uncertain = true;
      continue;
    }
    open.push({ currency: row.currency as CurrencyCode, amount: balance!, dueDate: row.due_date });
  }
  const schedules = input.schedules.filter(
    (row) => row.sale_contract_id === record.id && row.status !== "cancelled",
  );
  for (const schedule of schedules) {
    const bill = saleScheduleReceivable(schedule, rows);
    if (!bill) {
      // A pending/partial plan without a confirmed linked balance is a review,
      // never proof that its full amount remains unpaid.
      if (schedule.status !== "paid" && (cents(schedule.amount_xof) ?? 0) > 0) {
        reviews.push("installment_balance_requires_review");
        uncertain = true;
      }
      continue;
    }
    if (
      schedule.receivable_id &&
      (schedule.due_date !== bill.due_date || cents(schedule.amount_xof) !== cents(bill.amount_xof))
    ) {
      reviews.push("installment_bill_conflict");
      uncertain = true;
    }
  }
  const nextDue = open.map((row) => row.dueDate).sort()[0] ?? null;
  const outstandingNative = uncertain || !verifiedBills ? null : totals(open);
  const registeredBalance = saleRegisteredBalance(record);
  // A source purchase balance cannot be compared to fees or translated using an assumed FX rate.
  const balanceConflict =
    registeredBalance !== null &&
    principalBalances.length > 0 &&
    (principalBalances.some((row) => row.currency !== registeredBalance.currency) ||
      principalBalances.reduce((sum, row) => sum + row.amount, 0) !==
        cents(registeredBalance.amount));
  if (balanceConflict) reviews.push("registered_balance_bill_conflict");
  if (uncertain || balanceConflict)
    return {
      receivedNative,
      outstandingNative,
      attention: { kind: "review" as const, dueDate: null, days: null, amounts: [] },
      nextDue,
    };
  const overdue = open.filter((row) => row.dueDate < input.today);
  const limit = new Date(input.today + "T00:00:00Z");
  limit.setUTCDate(limit.getUTCDate() + 15);
  const upcoming = open.filter(
    (row) => row.dueDate >= input.today && row.dueDate <= limit.toISOString().slice(0, 10),
  );
  const selected = overdue.length ? overdue : historical ? open : upcoming;
  const dueDate = selected.map((row) => row.dueDate).sort()[0] ?? null;
  const attention: SaleRecordAttention | null = dueDate
    ? {
        kind: overdue.length ? "overdue" : historical ? "unsettled" : "upcoming",
        dueDate,
        days:
          (Date.parse(dueDate + "T00:00:00Z") - Date.parse(input.today + "T00:00:00Z")) / 86400000,
        amounts: totals(selected),
      }
    : null;
  return { receivedNative, outstandingNative, attention, nextDue };
}

export function buildSaleRecordOverview(input: SaleRoomOverviewInput): SaleRecordOverviewRow[] {
  if (!date(input.today)) throw new Error("InvalidSaleRoomDate");
  const units = new Map(input.units.map((row) => [row.id, row])),
    buildings = new Map(
      input.buildings.map((row) => [
        row.id,
        { ...row, project_id: row.project_id ?? null, project: row.project ?? null },
      ]),
    ),
    customers = new Map(input.customers.map((row) => [row.id, row]));
  const contracts = [...new Map(input.contracts.map((row) => [row.id, row])).values()];
  return contracts.flatMap((contract) => {
    const unit = units.get(contract.unit_id);
    if (!unit) return [];
    const historical = ["terminated", "expired"].includes(contract.status);
    const conflict =
      !historical &&
      contracts.filter(
        (other) => other.unit_id === unit.id && !["terminated", "expired"].includes(other.status),
      ).length > 1;
    const reviewReasons: string[] = [];
    if (conflict) reviewReasons.push("multiple_current_records");
    if (saleRegisteredPrice(contract) === null) reviewReasons.push("price_requires_review");
    const registeredBalance = saleRegisteredBalance(contract);
    if (
      registeredBalance === null &&
      (contract.source_balance_native != null || contract.source_balance_reference != null)
    )
      reviewReasons.push("registered_balance_requires_review");
    if (contract.payment_plan_type === "unconfirmed")
      reviewReasons.push("payment_arrangement_requires_review");
    if (contract.signed_date && contract.signed_date > input.today)
      reviewReasons.push("future_registered_record");
    const financial = finance(contract, unit, historical, input, reviewReasons);
    const pendingBalance = buildSalePendingBalanceSummary(contract, unit, input.receivables ?? []);
    return [
      {
        id: contract.id,
        contract,
        unit,
        building: buildings.get(unit.building_id) ?? null,
        customer: customers.get(contract.customer_id) ?? null,
        historical,
        conflict,
        priceXof: salePrice(contract),
        priceNative: saleRegisteredPrice(contract),
        registeredBalance,
        ...financial,
        ...pendingBalance,
        reviewReasons: [...new Set(reviewReasons)],
      },
    ];
  });
}
export function buildSaleRoomOverview(input: SaleRoomOverviewInput): SaleRoomOverviewRow[] {
  const records = buildSaleRecordOverview(input),
    buildings = new Map(
      input.buildings.map((row) => [
        row.id,
        { ...row, project_id: row.project_id ?? null, project: row.project ?? null },
      ]),
    );
  return [...new Map(input.units.map((row) => [row.id, row])).values()].map((unit) => {
    const related = records.filter((row) => row.unit.id === unit.id),
      current = related.filter((row) => !row.historical),
      conflict = current.length > 1;
    return {
      unit,
      building: buildings.get(unit.building_id) ?? null,
      record: current.length === 1 ? current[0] : null,
      records: related,
      conflict,
      reviewReasons: conflict ? ["multiple_current_records"] : [],
    };
  });
}
