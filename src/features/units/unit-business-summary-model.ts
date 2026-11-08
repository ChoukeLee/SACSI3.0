import type { CurrencyCode } from "@/types/domain";
import type {
  CustomerRow,
  LeaseContractRow,
  SaleContractRow,
  UnitRow,
  PaymentRow,
  ReceivableRow,
  LedgerEntryRow,
  SalePaymentScheduleRow,
} from "@/types/database";
import type { UnitWorkbenchBuilding } from "./unit-workbench-model";
import { buildSaleRecordOverview } from "@/features/sales/sale-room-overview-model";
import { buildLeaseRecordOverview } from "@/features/leases/lease-room-overview-model";
import { historicalXofAmount } from "@/lib/financial-amount";

export interface UnitBusinessMoney {
  currency: CurrencyCode;
  amount: number;
}

export interface UnitBusinessReceipt {
  id: string;
  recordId: string;
  unitId: string;
  role: "sale" | "lease";
  kind: "purchase" | "rent" | "deposit" | "agency" | "other" | "refund" | "expense";
  direction: "in" | "out";
  date: string;
  amount: UnitBusinessMoney;
  sourceRef: string | null;
}

export interface UnitBusinessBalance {
  basis: "verified_bills" | "registered" | "unknown";
  /** Null means unavailable. Empty verified-bill amounts means those bills are settled. */
  amounts: UnitBusinessMoney[] | null;
  sourceRef?: string | null;
}

interface UnitBusinessParty {
  recordId: string;
  unitId: string;
  customerId: string | null;
  customerName: string | null;
  status: string;
  historical: boolean;
  sourceRef: string | null;
  reviewReasons: string[];
  recentReceipts: UnitBusinessReceipt[];
  receiptCount: number;
}

export interface UnitSaleBrief extends UnitBusinessParty {
  signedDate: string | null;
  total: UnitBusinessMoney | null;
  received: UnitBusinessMoney[] | null;
  balance: UnitBusinessBalance;
  agencyReceived: UnitBusinessMoney[] | null;
  otherReceived: UnitBusinessMoney[] | null;
  refundPaid: UnitBusinessMoney[] | null;
}

export interface UnitLeaseBrief extends UnitBusinessParty {
  occupancy: string;
  monthlyRent: UnitBusinessMoney | null;
  rentReceived: UnitBusinessMoney[] | null;
  dueUnpaid: UnitBusinessMoney[] | null;
  /** All known rent bill balance, including bills not yet due, never price-minus-cash. */
  rentUnpaid: UnitBusinessMoney[] | null;
  paidThrough: string | null;
  startDate: string | null;
  nextDue: string | null;
  overdue: UnitBusinessMoney[] | null;
  depositReceived: UnitBusinessMoney[] | null;
  agencyReceived: UnitBusinessMoney[] | null;
  otherReceived: UnitBusinessMoney[] | null;
  refundPaid: UnitBusinessMoney[] | null;
}

export interface UnitDailyBrief {
  recordId: string;
  unitId: string;
  customerId: string | null;
  customerName: string | null;
  agentName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  status: string;
}

export interface UnitBusinessSummary {
  status: "ready" | "unavailable";
  today: string;
  sales: UnitSaleBrief[];
  leases: UnitLeaseBrief[];
  daily: UnitDailyBrief[];
  reviewReasons: string[];
}

export interface UnitBusinessSummaryInput {
  units: readonly UnitRow[];
  building: UnitWorkbenchBuilding;
  sales: readonly (SaleContractRow & { customerName: string | null })[];
  leases: readonly (LeaseContractRow & {
    customerName: string | null;
    source_reference?: string | null;
  })[];
  daily: readonly UnitDailyBrief[];
  payments: readonly PaymentRow[];
  ledger: readonly LedgerEntryRow[];
  receivables: readonly ReceivableRow[];
  schedules: readonly SalePaymentScheduleRow[];
  today: string;
}

const currencies: CurrencyCode[] = ["XOF", "CNY", "USD"];
function minor(value: unknown): number | null {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))
  )
    return null;
  const n = Number(value),
    c = Math.round(n * 100);
  return Number.isFinite(n) && n >= 0 && Number.isSafeInteger(c) && Math.abs(n - c / 100) < 1e-7
    ? c
    : null;
}
function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
  );
}
function amounts(values: readonly UnitBusinessMoney[]): UnitBusinessMoney[] {
  const totals = new Map<CurrencyCode, number>();
  for (const value of values)
    totals.set(value.currency, (totals.get(value.currency) ?? 0) + Math.round(value.amount * 100));
  return [...totals]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => ({ currency, amount: amount / 100 }));
}
const leaseKinds: Record<string, UnitBusinessReceipt["kind"]> = {
  lease_rent: "rent",
  lease_deposit: "deposit",
  lease_deposit_refund: "refund",
  lease_rent_refund: "refund",
  lease_agency_income: "agency",
  lease_agency_expense: "expense",
  lease_other_income: "other",
  lease_furniture_income: "other",
  lease_other_expense: "expense",
  property_fee: "other",
  parking_fee: "other",
};
const saleKinds: Record<string, UnitBusinessReceipt["kind"]> = {
  sale: "purchase",
  sale_contract: "purchase",
  sale_refund: "refund",
  sale_agency_income: "agency",
  sale_agency_expense: "expense",
  sale_registration_fee: "other",
  sale_other_income: "other",
  sale_other_expense: "expense",
  property_fee: "other",
  parking_fee: "other",
};

function cashForRecord(
  input: UnitBusinessSummaryInput,
  record: LeaseContractRow | SaleContractRow,
  role: "lease" | "sale",
) {
  const reviews: string[] = [],
    rows: UnitBusinessReceipt[] = [],
    seen = new Set<string>();
  const relevant = input.payments.filter((p) => p.source_id === record.id);
  const reversed = new Set(
    relevant.flatMap((p) => (p.reversal_of_payment_id ? [p.reversal_of_payment_id] : [])),
  );
  let uncertain = false;
  for (const p of relevant) {
    const known =
      role === "lease"
        ? p.source_type === "lease_contract" || Object.hasOwn(leaseKinds, p.source_type)
        : Object.hasOwn(saleKinds, p.source_type);
    if (!known) continue; // A manual room movement is never assigned to its current tenant.
    if (seen.has(p.id)) {
      reviews.push("duplicate_cash_record");
      uncertain = true;
      continue;
    }
    seen.add(p.id);
    if (p.payment_method === "offset") continue;
    if (p.reversal_of_payment_id || p.request_kind?.includes("reversal") || reversed.has(p.id)) {
      reviews.push("cash_reversal_requires_review");
      uncertain = true;
      continue;
    }
    if (
      (p.unit_id !== null && p.unit_id !== record.unit_id) ||
      (p.customer_id !== null && p.customer_id !== record.customer_id)
    ) {
      reviews.push("cash_party_mismatch");
      uncertain = true;
      continue;
    }
    const amount = minor(p.amount),
      currency = p.currency as CurrencyCode;
    const native = p.native_settlement === true;
    const contractCurrency =
      role === "sale"
        ? ((record as SaleContractRow).sale_currency ?? "XOF")
        : ((record as LeaseContractRow).rent_currency ?? "XOF");
    const rate = Number(p.exchange_rate_to_xof);
    if (
      !amount ||
      !currencies.includes(currency) ||
      !validDate(p.payment_date) ||
      (p.unit_id !== null && p.unit_id !== record.unit_id) ||
      (p.customer_id !== null && p.customer_id !== record.customer_id) ||
      (p.payment_method != null &&
        !["cash", "check", "bank_transfer", "other"].includes(p.payment_method)) ||
      (native
        ? currency === "XOF" ||
          currency !== contractCurrency ||
          p.exchange_rate_to_xof !== null ||
          p.unit_id !== record.unit_id ||
          p.customer_id !== record.customer_id
        : !Number.isFinite(rate) || rate <= 0 || (currency === "XOF" && rate !== 1))
    ) {
      reviews.push("cash_data_requires_review");
      uncertain = true;
      continue;
    }
    let kind = role === "sale" ? saleKinds[p.source_type] : leaseKinds[p.source_type];
    if (role === "lease" && p.source_type === "lease_contract") {
      const ledger = input.ledger.filter((l) => l.payment_id === p.id);
      const expectedXof = native ? null : historicalXofAmount(p.amount, rate);
      const line = ledger.length === 1 ? ledger[0] : null;
      const matching =
        line &&
        line.direction === "income" &&
        line.category === "lease_rent" &&
        (line.unit_id === null || line.unit_id === record.unit_id) &&
        (line.building_id === null || line.building_id === input.building.id) &&
        (native
          ? line.currency === currency && minor(line.amount_native) === amount
          : expectedXof !== null && minor(line.amount_xof) === minor(expectedXof));
      if (matching) kind = "rent";
      else {
        kind = "other";
        reviews.push("payment_purpose_requires_review");
        uncertain = true;
      }
    }
    rows.push({
      id: p.id,
      recordId: record.id,
      unitId: record.unit_id,
      role,
      kind,
      direction: kind === "expense" || kind === "refund" ? "out" : "in",
      date: p.payment_date,
      amount: { currency, amount: amount / 100 },
      sourceRef: p.external_receipt_no ?? p.receipt_no ?? p.notes,
    });
  }
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const total = (kind: UnitBusinessReceipt["kind"]): UnitBusinessMoney[] | null =>
    uncertain ? null : amounts(rows.filter((row) => row.kind === kind).map((row) => row.amount));
  return { reviews, rows, total };
}

function rentBills(input: UnitBusinessSummaryInput, record: LeaseContractRow) {
  const reviews: string[] = [],
    all: UnitBusinessMoney[] = [],
    due: UnitBusinessMoney[] = [],
    overdue: UnitBusinessMoney[] = [],
    dates: string[] = [];
  let confirmed = 0,
    invalid = false;
  const seen = new Set<string>();
  for (const bill of input.receivables.filter(
    (r) =>
      r.source_type === "lease_contract" &&
      r.source_id === record.id &&
      r.category === "lease_rent",
  )) {
    if (bill.status === "cancelled" || bill.management_status === "excluded") continue;
    const currency = bill.currency as CurrencyCode;
    const amount = minor(currency === "XOF" ? bill.amount_xof : bill.amount_native),
      paid = minor(currency === "XOF" ? bill.paid_amount_xof : bill.paid_amount_native);
    const valid =
      !seen.has(bill.id) &&
      currencies.includes(currency) &&
      currency === (record.rent_currency ?? "XOF") &&
      validDate(bill.due_date) &&
      amount !== null &&
      paid !== null &&
      paid <= amount &&
      ["paid", "pending", "partial", "overdue"].includes(bill.status) &&
      (bill.status !== "paid" || paid === amount) &&
      (bill.unit_id === null || bill.unit_id === record.unit_id) &&
      (bill.customer_id === null || bill.customer_id === record.customer_id) &&
      (bill.building_id === null || bill.building_id === input.building.id);
    seen.add(bill.id);
    if (!valid || bill.management_status !== "managed") {
      invalid = true;
      reviews.push("rent_bill_requires_review");
      continue;
    }
    confirmed++;
    if (amount! > paid!) {
      const value = { currency, amount: (amount! - paid!) / 100 };
      all.push(value);
      dates.push(bill.due_date);
      if (bill.due_date <= input.today) due.push(value);
      if (bill.due_date < input.today) overdue.push(value);
    }
  }
  const unknown = !confirmed || invalid;
  return {
    reviews,
    rentUnpaid: unknown ? null : amounts(all),
    dueUnpaid: unknown ? null : amounts(due),
    overdue: unknown ? null : amounts(overdue),
    nextDue: dates.sort()[0] ?? null,
  };
}

/** All supplied cash/bills are complete for the explicitly selected records; only recent rows are returned to the client. */
export function buildUnitBusinessSummaries(
  input: UnitBusinessSummaryInput,
): Record<string, UnitBusinessSummary> {
  if (!validDate(input.today)) throw new Error("InvalidUnitBusinessSummaryDate");
  const result: Record<string, UnitBusinessSummary> = {};
  const units = new Map(
    input.units.filter((u) => u.building_id === input.building.id).map((u) => [u.id, u]),
  );
  for (const id of units.keys())
    result[id] = {
      status: "ready",
      today: input.today,
      sales: [],
      leases: [],
      daily: [],
      reviewReasons: [],
    };
  const sales = input.sales.filter((s) => units.has(s.unit_id));
  const leases = input.leases.filter((s) => units.has(s.unit_id));
  const customers = [
    ...new Map(
      [...sales, ...leases].map((row) => [
        row.customer_id,
        { id: row.customer_id, name: row.customerName } as CustomerRow,
      ]),
    ).values(),
  ];
  const saleRows = buildSaleRecordOverview({
    units: [...units.values()],
    contracts: sales,
    customers,
    buildings: [input.building],
    today: input.today,
    payments: input.payments,
    // This view labels the balance as purchase principal. Property/parking and
    // other fees belong to their own details, never to unpaid purchase money.
    receivables: input.receivables.filter((r) =>
      ["sale_lump_sum", "sale_installment"].includes(r.category),
    ),
    schedules: input.schedules,
  });
  for (const row of saleRows) {
    const original = sales.find((s) => s.id === row.id)!;
    const cash = cashForRecord(input, original, "sale");
    const balance: UnitBusinessBalance =
      row.outstandingNative !== null
        ? { basis: "verified_bills", amounts: row.outstandingNative }
        : row.registeredBalance
          ? {
              basis: "registered",
              amounts: [
                { currency: row.registeredBalance.currency, amount: row.registeredBalance.amount },
              ],
              sourceRef: row.registeredBalance.sourceRef,
            }
          : { basis: "unknown", amounts: null };
    result[row.unit.id].sales.push({
      recordId: row.id,
      unitId: row.unit.id,
      customerId: original.customer_id,
      customerName: original.customerName,
      status: original.status,
      historical: row.historical,
      sourceRef: original.source_reference ?? null,
      reviewReasons: [...new Set([...row.reviewReasons, ...cash.reviews])],
      recentReceipts: cash.rows.slice(0, 6),
      receiptCount: cash.rows.length,
      signedDate: validDate(original.signed_date) ? original.signed_date : null,
      total: row.priceNative ?? null,
      received: cash.total("purchase"),
      balance,
      agencyReceived: cash.total("agency"),
      otherReceived: cash.total("other"),
      refundPaid: cash.total("refund"),
    });
  }
  const leaseRows = buildLeaseRecordOverview({
    units: [...units.values()],
    contracts: leases,
    customers,
    buildings: [],
    today: input.today,
    receivables: input.receivables,
  });
  for (const row of leaseRows) {
    const original = leases.find((s) => s.id === row.id)!;
    const cash = cashForRecord(input, original, "lease"),
      bills = rentBills(input, original);
    const currency = (original.rent_currency ?? "XOF") as CurrencyCode;
    const rent = minor(
      currency === "XOF" ? original.monthly_rent_xof : original.monthly_rent_amount,
    );
    result[row.unit.id].leases.push({
      recordId: row.id,
      unitId: row.unit.id,
      customerId: original.customer_id,
      customerName: original.customerName,
      status: original.status,
      historical: row.historical,
      sourceRef: original.source_reference ?? null,
      reviewReasons: [...new Set([...row.reviewReasons, ...cash.reviews, ...bills.reviews])],
      recentReceipts: cash.rows.slice(0, 6),
      receiptCount: cash.rows.length,
      occupancy: row.occupancy,
      monthlyRent:
        currencies.includes(currency) && rent !== null && rent > 0
          ? { currency, amount: rent / 100 }
          : null,
      rentReceived: cash.total("rent"),
      dueUnpaid: bills.dueUnpaid,
      rentUnpaid: bills.rentUnpaid,
      paidThrough: row.paidThrough,
      startDate: validDate(original.start_date) ? original.start_date : null,
      nextDue: bills.nextDue,
      overdue: bills.overdue,
      depositReceived: cash.total("deposit"),
      agencyReceived: cash.total("agency"),
      otherReceived: cash.total("other"),
      refundPaid: cash.total("refund"),
    });
  }
  for (const row of input.daily)
    if (units.has(row.unitId) && row.status === "checked_in") result[row.unitId].daily.push(row);
  for (const summary of Object.values(result)) {
    summary.reviewReasons = [
      ...new Set([
        ...summary.sales.flatMap((r) => r.reviewReasons),
        ...summary.leases.flatMap((r) => r.reviewReasons),
      ]),
    ];
    if (summary.daily.length > 1) summary.reviewReasons.push("multiple_current_daily_records");
  }
  return result;
}
