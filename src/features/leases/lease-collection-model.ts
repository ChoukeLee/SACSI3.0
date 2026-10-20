import type { CurrencyCode } from "@/types/domain";
import type { LeaseContractRow, ReceivableRow } from "@/types/database";
import type { LeaseCollectionInput } from "./lease-collection-types";

export interface LeaseCollectionDraft {
  currency: CurrencyCode;
  amount: string;
  amountUnit: "unit" | "wan";
  paymentDate: string;
  paymentMethod: "" | "cash" | "check" | "bank_transfer" | "other";
  externalReceiptNo: string;
  actualCollector: string;
  collectorBasis: string;
  notes: string;
  /** Explicit opt-in only; a proposal never changes coverage by itself. */
  syncPaidThrough?: boolean;
  /** Every allocation is expressed in the selected currency's base unit, never 万. */
  allocations: Record<string, string>;
}

export interface LeaseCollectionBill {
  id: string;
  title: string;
  category: "lease_rent" | "property_fee";
  currency: CurrencyCode;
  outstanding: number;
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
  dueDate: string;
  expectedUpdatedAt?: string;
}

export interface LeaseCollectionIssue {
  field: string;
  code: string;
}

export interface LeaseCollectionCoverageProposal {
  expectedPaidThroughDate: string;
  expectedContractUpdatedAt: string;
  throughDate: string;
  receivableIds: string[];
}

export type LeaseCollectionSubmission =
  | {
      ok: true;
      input: Omit<LeaseCollectionInput, "requestId">;
      allocatedAmount: number;
    }
  | { ok: false; issues: LeaseCollectionIssue[] };

const currencies = new Set<string>(["XOF", "USD", "CNY"]);
const payableStatuses = new Set<string>(["pending", "partial", "overdue"]);
const paymentMethods = new Set<string>(["cash", "check", "bank_transfer", "other"]);
// Same ceiling as the atomic collection endpoint: 999,999,999,999.99 base units.
const maxMinor = BigInt("99999999999999");

function decimalMinor(text: string, decimalPlaces: number): bigint | null {
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimalPlaces) return null;
  // Keep untrusted pasted input bounded before constructing a bigint.
  if (whole.length > 16) return null;
  const result = BigInt(whole + fraction.padEnd(decimalPlaces, "0"));
  return result <= maxMinor ? result : null;
}

/** Exact minor units; no epsilon, rounding, coercion, or acceptance of NaN/Infinity. */
export function moneyMinor(value: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const minor = decimalMinor(String(value), 2);
  return minor === null ? null : Number(minor);
}

/** Strict human-entered decimal. 万 means exactly 10,000 base units. */
export function parseCollectionMoney(text: string, unit: "unit" | "wan" = "unit"): number | null {
  if (typeof text !== "string" || (unit !== "unit" && unit !== "wan")) return null;
  const minor = decimalMinor(text.trim(), unit === "wan" ? 6 : 2);
  if (minor === null) return null;
  const result = Number(minor) / 100;
  // Some large decimal values cannot survive JS number transport without losing a cent.
  return moneyMinor(result) === Number(minor) ? result : null;
}

/** Format a validated amount for an input without introducing binary division tails. */
export function formatCollectionMoneyInput(value: number, unit: "unit" | "wan" = "unit"): string {
  if (unit !== "unit" && unit !== "wan") return "";
  const minor = moneyMinor(value);
  if (minor === null) return "";
  const decimals = unit === "wan" ? 6 : 2;
  const digits = String(minor).padStart(decimals + 1, "0");
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  const whole = digits.slice(0, -decimals);
  return fraction ? `${whole}.${fraction}` : whole;
}

function realDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function contractReady(contract: LeaseContractRow): boolean {
  return (
    !!contract.id?.trim() &&
    !!contract.unit_id?.trim() &&
    !!contract.customer_id?.trim() &&
    contract.status === "active"
  );
}

function buildingMatches(row: ReceivableRow, expectedBuildingId?: string): boolean {
  return (
    typeof row.building_id === "string" &&
    !!row.building_id.trim() &&
    (expectedBuildingId === undefined || row.building_id === expectedBuildingId)
  );
}

function period(row: ReceivableRow): { start: string | null; end: string | null } | null {
  const start = row.service_period_start ?? null;
  const end = row.service_period_end ?? null;
  if (start === null && end === null) return { start, end };
  // A historical receipt may explicitly confirm only its period end. Preserve
  // that fact without inferring a start from due_date or contract coverage.
  if (start === null && realDate(end)) return { start, end };
  if (!realDate(start) || !realDate(end) || start > end) return null;
  return { start, end };
}

function nextDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * An optional proposal supported by a complete, contiguous rent-bill proof.
 * It never derives service periods from dates of receipt, due dates or amounts.
 */
export function getLeaseCollectionCoverageProposal(
  contract: LeaseContractRow,
  receivables: readonly ReceivableRow[],
  draft: Pick<LeaseCollectionDraft, "currency" | "allocations">,
  today: string,
  expectedBuildingId?: string,
): LeaseCollectionCoverageProposal | null {
  const old = contract.paid_through_date;
  const commenced = (contract as LeaseContractRow & { commencement_state?: string })
    .commencement_state;
  if (
    !contractReady(contract) ||
    commenced !== "started" ||
    contract.actual_end_date != null ||
    !realDate(today) ||
    !realDate(old) ||
    !realDate(contract.start_date) ||
    contract.start_date > today ||
    nextDate(old) < contract.start_date ||
    draft.currency !== contract.rent_currency ||
    !currencies.has(draft.currency) ||
    !/^\d{4}-\d{2}-\d{2}T/.test(contract.updated_at) ||
    !Number.isFinite(Date.parse(contract.updated_at)) ||
    (contract.expected_end_confirmed === true && !realDate(contract.expected_end_date))
  )
    return null;
  const available = new Map(
    getLeaseCollectionBills(contract, receivables, expectedBuildingId).bills.map((row) => [
      row.id,
      row,
    ]),
  );
  const allocations = new Map<string, number>();
  for (const [id, text] of Object.entries(draft.allocations)) {
    if (!text.trim()) continue;
    const bill = available.get(id),
      amount = parseCollectionMoney(text);
    if (
      !bill ||
      amount === null ||
      amount <= 0 ||
      bill.currency !== draft.currency ||
      amount > bill.outstanding
    )
      return null;
    allocations.set(id, moneyMinor(amount)!);
  }
  const rent = receivables.filter(
    (row) =>
      row.source_type === "lease_contract" &&
      row.source_id === contract.id &&
      row.category === "lease_rent" &&
      row.status !== "cancelled",
  );
  if (new Set(rent.map((row) => row.id)).size !== rent.length) return null;
  const rows = rent.map((row) => {
    const native = row.currency === "USD" || row.currency === "CNY";
    const total = moneyMinor(native ? row.amount_native! : row.amount_xof);
    const paid = moneyMinor(native ? row.paid_amount_native! : row.paid_amount_xof);
    const applied = allocations.get(row.id) ?? 0;
    const dates = period(row);
    const fullPeriod = dates?.start && dates.end && !!row.service_period_source?.trim();
    return {
      row,
      total,
      paid,
      after: paid === null ? null : paid + applied,
      dates,
      fullPeriod,
      applied,
    };
  });
  const eligible = rows.filter(
    ({ row, total, paid, after, fullPeriod, applied }) =>
      row.management_status === "managed" &&
      buildingMatches(row, expectedBuildingId) &&
      row.unit_id === contract.unit_id &&
      row.customer_id === contract.customer_id &&
      row.currency === draft.currency &&
      fullPeriod &&
      total !== null &&
      total > 0 &&
      paid !== null &&
      paid <= total &&
      after === total &&
      (row.status === "paid" || applied > 0) &&
      (row.currency === "XOF"
        ? row.amount_native == null && row.paid_amount_native == null
        : row.amount_xof === 0 && row.paid_amount_xof === 0),
  );
  const proof: typeof eligible = [];
  let cursor = nextDate(old);
  for (;;) {
    const next = eligible.filter((item) => item.dates!.start === cursor);
    if (next.length > 1) return null;
    if (next.length === 0) break;
    const item = next[0];
    if (contract.expected_end_confirmed === true && item.dates!.end! > contract.expected_end_date)
      break;
    proof.push(item);
    cursor = nextDate(item.dates!.end!);
    if (proof.length > 100) return null;
  }
  if (!proof.length || !proof.some((item) => item.applied > 0)) return null;
  const through = proof[proof.length - 1].dates!.end!;
  const proofIds = new Set(proof.map((item) => item.row.id));
  for (const item of rows) {
    if (proofIds.has(item.row.id)) continue;
    // A second overlapping obligation cannot be ignored to claim full coverage.
    if (item.dates?.start && item.dates.end && item.dates.start <= through && item.dates.end > old)
      return null;
    if (item.row.management_status !== "managed") continue;
    if (item.total === null || item.paid === null || item.after === null) return null;
    if (item.after < item.total && (!item.fullPeriod || item.dates!.start! <= through)) return null;
  }
  return {
    expectedPaidThroughDate: old,
    expectedContractUpdatedAt: contract.updated_at,
    throughDate: through,
    receivableIds: proof.map((item) => item.row.id),
  };
}

/**
 * Present only existing, positively identified obligations. Historical/closed/other
 * contract rows are not actionable. Suspicious candidate rows are counted, not repaired.
 */
export function getLeaseCollectionBills(
  contract: LeaseContractRow,
  receivables: readonly ReceivableRow[],
  expectedBuildingId?: string,
): { bills: LeaseCollectionBill[]; excludedCount: number } {
  const candidates = receivables.filter(
    (row) =>
      row.source_type === "lease_contract" &&
      row.source_id === contract.id &&
      ["lease_rent", "property_fee"].includes(row.category) &&
      payableStatuses.has(row.status) &&
      row.management_status === "managed",
  );
  const counts = new Map<string, number>();
  for (const row of candidates) counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  const bills: LeaseCollectionBill[] = [];
  let excludedCount = 0;
  for (const row of candidates) {
    const category = row.category as LeaseCollectionBill["category"];
    const currency = row.currency;
    const native = currency === "USD" || currency === "CNY";
    const servicePeriod = period(row);
    const amount = moneyMinor(native ? row.amount_native! : row.amount_xof);
    const paid = moneyMinor(native ? row.paid_amount_native! : row.paid_amount_xof);
    const validCurrency =
      currencies.has(currency) &&
      (category === "property_fee"
        ? currency === "XOF"
        : currencies.has(contract.rent_currency ?? "") && currency === contract.rent_currency);
    const isolatedCurrency = native
      ? row.amount_xof === 0 && row.paid_amount_xof === 0
      : row.amount_native == null && row.paid_amount_native == null;
    if (
      !contractReady(contract) ||
      !buildingMatches(row, expectedBuildingId) ||
      !row.id?.trim() ||
      counts.get(row.id) !== 1 ||
      row.unit_id !== contract.unit_id ||
      row.customer_id !== contract.customer_id ||
      !validCurrency ||
      !isolatedCurrency ||
      !realDate(row.due_date) ||
      !servicePeriod ||
      amount === null ||
      paid === null ||
      amount <= 0 ||
      paid >= amount ||
      (row.status === "pending" && paid !== 0) ||
      (row.status === "partial" && paid === 0)
    ) {
      excludedCount++;
      continue;
    }
    const outstanding = (amount - paid) / 100;
    if (moneyMinor(outstanding) !== amount - paid) {
      excludedCount++;
      continue;
    }
    bills.push({
      id: row.id,
      title: row.title,
      category,
      currency: currency as CurrencyCode,
      outstanding,
      servicePeriodStart: servicePeriod.start,
      servicePeriodEnd: servicePeriod.end,
      dueDate: row.due_date,
      ...(row.updated_at ? { expectedUpdatedAt: row.updated_at } : {}),
    });
  }
  bills.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  return { bills, excludedCount };
}

/** Build a reviewable exact allocation; never choose bills or allocate by chronology. */
export function buildLeaseCollectionSubmission(
  contract: LeaseContractRow,
  receivables: readonly ReceivableRow[],
  draft: LeaseCollectionDraft,
  today: string,
  expectedBuildingId?: string,
): LeaseCollectionSubmission {
  const issues: LeaseCollectionIssue[] = [];
  const add = (field: string, code: string) => issues.push({ field, code });
  if (!contractReady(contract)) add("contract", "invalid_contract");
  if (!currencies.has(draft.currency)) add("currency", "unsupported_currency");
  if (!["unit", "wan"].includes(draft.amountUnit)) add("amountUnit", "unsupported_unit");
  if (draft.amountUnit === "wan" && draft.currency !== "XOF") add("amountUnit", "unsupported_unit");
  const amount = parseCollectionMoney(draft.amount, draft.amountUnit);
  const totalMinor = amount === null ? null : moneyMinor(amount);
  if (totalMinor === null || totalMinor <= 0) add("amount", "invalid_amount");
  if (!realDate(draft.paymentDate) || !realDate(today)) add("paymentDate", "invalid_date");
  else if (draft.paymentDate > today) add("paymentDate", "future_date");
  if (!paymentMethods.has(draft.paymentMethod)) add("paymentMethod", "required");

  const externalReceiptNo = draft.externalReceiptNo.trim();
  const actualCollector = draft.actualCollector.trim();
  const collectorBasis = draft.collectorBasis.trim();
  const notes = draft.notes.trim();
  if (actualCollector && !collectorBasis) add("collectorBasis", "collector_basis_required");
  if (collectorBasis && !actualCollector) add("actualCollector", "collector_required");
  for (const [field, value, limit] of [
    ["externalReceiptNo", externalReceiptNo, 200],
    ["actualCollector", actualCollector, 100],
    ["collectorBasis", collectorBasis, 1000],
    ["notes", notes, 2000],
  ] as const) {
    if (value.length > limit) add(field, "too_long");
  }

  const available = new Map(
    getLeaseCollectionBills(contract, receivables, expectedBuildingId).bills.map((b) => [b.id, b]),
  );
  const entries = Object.entries(draft.allocations).filter(([, value]) => value.trim() !== "");
  if (!entries.length) add("allocations", "unallocated");
  if (entries.length > 100) add("allocations", "too_many_allocations");
  const allocations: LeaseCollectionInput["allocations"] = [];
  let allocatedMinor = BigInt(0);
  for (const [id, text] of entries) {
    const field = `allocations.${id}`;
    const bill = available.get(id);
    if (!bill) {
      add(field, "unavailable_receivable");
      continue;
    }
    if (bill.currency !== draft.currency) add(field, "currency_mismatch");
    const allocated = parseCollectionMoney(text);
    const minor = allocated === null ? null : moneyMinor(allocated);
    if (minor === null || minor <= 0) {
      add(field, "invalid_amount");
      continue;
    }
    if (minor > moneyMinor(bill.outstanding)!) add(field, "exceeds_balance");
    allocatedMinor += BigInt(minor);
    allocations.push({
      receivableId: bill.id,
      amount: allocated!,
      expectedOutstanding: bill.outstanding,
      ...(bill.expectedUpdatedAt ? { expectedUpdatedAt: bill.expectedUpdatedAt } : {}),
    });
  }
  if (totalMinor !== null && allocatedMinor !== BigInt(totalMinor))
    add("allocations", "amount_mismatch");
  if (allocatedMinor > maxMinor) add("allocations", "invalid_amount");
  const coverage = draft.syncPaidThrough
    ? getLeaseCollectionCoverageProposal(contract, receivables, draft, today, expectedBuildingId)
    : null;
  if (draft.syncPaidThrough && !coverage) add("coverage", "coverage_unavailable");
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    allocatedAmount: Number(allocatedMinor) / 100,
    input: {
      contractId: contract.id,
      currency: draft.currency,
      amount: amount!,
      paymentDate: draft.paymentDate,
      paymentMethod: draft.paymentMethod as LeaseCollectionInput["paymentMethod"],
      ...(externalReceiptNo ? { externalReceiptNo } : {}),
      ...(actualCollector ? { actualCollector } : {}),
      ...(collectorBasis ? { collectorBasis } : {}),
      ...(notes ? { notes } : {}),
      allocations,
      ...(coverage ? { coverage } : {}),
    },
  };
}
