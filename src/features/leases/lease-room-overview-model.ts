import type { CustomerRow, LeaseContractRow, ReceivableRow } from "@/types/database";
import type { CurrencyCode } from "@/types/domain";
import type { WorkspaceUnit } from "@/features/contracts/workspace-model";
import type { ContractReceivableSummary } from "@/features/contracts/contract-list-model";
import type { LeaseBuilding } from "./project-scope";
import { resolveLeaseAttention } from "./lease-receivable-summary";

export type LeaseRoomOccupancy =
  | "leased"
  | "scheduled"
  | "reserved"
  | "self_use"
  | "available"
  | "maintenance"
  | "locked"
  | "other_occupied"
  | "unknown"
  | "conflict";

export interface LeaseRoomAttention {
  kind: "overdue" | "upcoming" | "coverage";
  dueDate: string;
  days: number | null;
  amount: number | null;
  currency?: CurrencyCode;
  amountIsEstimated: false;
}

export interface LeaseRoomOverviewRow {
  unit: WorkspaceUnit;
  building: LeaseBuilding | null;
  contract: LeaseContractRow | null;
  customer: CustomerRow | null;
  records: LeaseContractRow[];
  occupancy: LeaseRoomOccupancy;
  attention: LeaseRoomAttention | null;
  conflict: boolean;
  paidThrough: string | null;
  reviewReasons: string[];
}

export interface LeaseRoomOverviewInput {
  units: readonly WorkspaceUnit[];
  contracts: readonly LeaseContractRow[];
  customers: readonly CustomerRow[];
  buildings: readonly LeaseBuilding[];
  today: string;
  summaries?: Record<string, ContractReceivableSummary & { dueOutstanding?: number }>;
  attentionDue?: Record<string, string | null>;
  /** Complete scoped bills. Undefined means these detailed balances were not read. */
  receivables?: readonly ReceivableRow[];
}

/** Validate the additional, RLS-scoped bill read before it reaches the browser. */
export function decodeLeaseRoomReceivables(
  value: unknown,
  contracts: readonly LeaseContractRow[],
  units: readonly WorkspaceUnit[],
): ReceivableRow[] {
  if (!Array.isArray(value)) throw new Error("LeaseRoomBillsUnavailable");
  const records = new Map(contracts.map((record) => [record.id, record]));
  const assets = new Map(units.map((unit) => [unit.id, unit]));
  const seen = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("LeaseRoomBillsUnavailable");
    const row = raw as ReceivableRow;
    const record = records.get(row.source_id ?? "");
    const unit = record ? assets.get(record.unit_id) : undefined;
    if (
      typeof row.id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(row.id) ||
      seen.has(row.id) ||
      row.source_type !== "lease_contract" ||
      !record ||
      !unit ||
      (row.unit_id !== null && row.unit_id !== unit.id) ||
      (row.building_id !== null && row.building_id !== unit.building_id) ||
      (row.customer_id !== null && row.customer_id !== record.customer_id) ||
      !["XOF", "CNY", "USD"].includes(row.currency) ||
      !["pending", "partial", "paid", "overdue", "cancelled"].includes(row.status) ||
      !["managed", "historical_pending", "excluded"].includes(String(row.management_status)) ||
      typeof row.category !== "string" ||
      !date(row.due_date) ||
      money(row.amount_xof) === null ||
      money(row.paid_amount_xof) === null ||
      (row.amount_native != null && money(row.amount_native) === null) ||
      (row.paid_amount_native != null && money(row.paid_amount_native) === null)
    )
      throw new Error("LeaseRoomBillsUnavailable");
    seen.add(row.id);
    return row;
  });
}

function date(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

function money(value: unknown): number | null {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))
  )
    return null;
  const amount = Number(value);
  const minor = Math.round(amount * 100);
  return Number.isFinite(amount) &&
    amount >= 0 &&
    Number.isSafeInteger(minor) &&
    Math.abs(minor / 100 - amount) < 0.0000001
    ? minor
    : null;
}

function coverage(record: LeaseContractRow, today: string): LeaseRoomAttention {
  return {
    kind: "coverage",
    dueDate: date(record.paid_through_date) ? record.paid_through_date : today,
    days: null,
    amount: null,
    amountIsEstimated: false,
  };
}

function noBillAttention(record: LeaseContractRow, today: string): LeaseRoomAttention | null {
  if (date(record.paid_through_date)) {
    const days =
      (Date.parse(`${record.paid_through_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86400000;
    // A distant registered coverage date is displayed as a source fact. Silence
    // here does not certify payment, complete bill coverage or absence of debt.
    if (days > 15) return null;
  }
  return coverage(record, today);
}

function billingAttention(
  record: LeaseContractRow,
  unit: WorkspaceUnit,
  input: LeaseRoomOverviewInput,
  reviews: string[],
): LeaseRoomAttention | null {
  if (!input.receivables) {
    const summary = input.summaries?.[record.id];
    // Legacy summaries cannot value native rent. A positive, explicitly XOF
    // bill balance (for example property fees) still takes priority over dates.
    if (
      summary &&
      summary.count > 0 &&
      (!Number.isFinite(summary.outstanding) ||
        !Number.isFinite(summary.overdue) ||
        summary.outstanding < 0 ||
        summary.overdue < 0 ||
        summary.overdue > summary.outstanding)
    ) {
      reviews.push("billing_data_conflict");
      return coverage(record, input.today);
    }
    if (
      summary &&
      summary.count > 0 &&
      ((record.rent_currency ?? "XOF") === "XOF" || summary.outstanding > 0 || summary.overdue > 0)
    ) {
      const resolved = resolveLeaseAttention({
        today: input.today,
        paidThroughDate: record.paid_through_date ?? null,
        outstanding: summary.outstanding,
        overdue: summary.overdue,
        nextDue: summary.nextDue,
      });
      return resolved && resolved.kind !== "coverage" ? { ...resolved, currency: "XOF" } : resolved;
    }
    return noBillAttention(record, input.today);
  }
  const rows = input.receivables.filter(
    (row) =>
      row.source_type === "lease_contract" &&
      row.source_id === record.id &&
      row.status !== "cancelled" &&
      (row.management_status ?? "managed") === "managed" &&
      ["lease_rent", "property_fee"].includes(row.category),
  );
  if (!rows.length) {
    const summary = input.summaries?.[record.id];
    if (summary && summary.count > 0 && (summary.outstanding > 0 || summary.overdue > 0)) {
      reviews.push("billing_data_conflict");
      return coverage(record, input.today);
    }
    return noBillAttention(record, input.today);
  }
  const groups = new Map<
    CurrencyCode,
    { outstanding: number; overdue: number; nextDue: string | null }
  >();
  const seen = new Set<string>();
  for (const row of rows) {
    const currency = row.currency as CurrencyCode;
    const native = currency !== "XOF";
    const amount = money(native ? row.amount_native : row.amount_xof);
    const paid = money(native ? row.paid_amount_native : row.paid_amount_xof);
    if (
      seen.has(row.id) ||
      !["XOF", "CNY", "USD"].includes(currency) ||
      !date(row.due_date) ||
      amount === null ||
      paid === null ||
      (row.unit_id !== null && row.unit_id !== unit.id) ||
      (row.building_id !== null && row.building_id !== unit.building_id) ||
      (row.customer_id !== null && row.customer_id !== record.customer_id) ||
      (row.category === "lease_rent" && currency !== (record.rent_currency ?? "XOF")) ||
      (row.category === "property_fee" && currency !== "XOF") ||
      (row.status === "paid" && paid < amount)
    ) {
      reviews.push("billing_data_conflict");
      return coverage(record, input.today);
    }
    seen.add(row.id);
    const balance = Math.max(0, amount - paid);
    const group = groups.get(currency) ?? { outstanding: 0, overdue: 0, nextDue: null };
    group.outstanding += balance;
    if (row.due_date < input.today) group.overdue += balance;
    if (balance > 0 && (!group.nextDue || row.due_date < group.nextDue))
      group.nextDue = row.due_date;
    groups.set(currency, group);
  }
  const candidates: LeaseRoomAttention[] = [];
  for (const [currency, group] of groups) {
    const resolved = resolveLeaseAttention({
      today: input.today,
      paidThroughDate: record.paid_through_date ?? null,
      outstanding: group.outstanding / 100,
      overdue: group.overdue / 100,
      nextDue: group.nextDue,
    });
    if (!resolved) continue;
    const attention: LeaseRoomAttention = {
      ...resolved,
      ...(resolved.kind !== "coverage" ? { currency } : {}),
    };
    if (attention.kind === "upcoming") {
      const through = new Date(`${input.today}T00:00:00Z`);
      through.setUTCDate(through.getUTCDate() + 15);
      const end = through.toISOString().slice(0, 10);
      // Amounts outside the reminder window do not inflate the imminent bill.
      attention.amount =
        rows
          .filter(
            (row) =>
              row.currency === currency && row.due_date >= input.today && row.due_date <= end,
          )
          .reduce(
            (sum, row) => sum + Math.max(0, money(nativeAmount(row))! - money(nativePaid(row))!),
            0,
          ) / 100;
    }
    candidates.push(attention);
  }
  const rank = { overdue: 0, upcoming: 1, coverage: 2 };
  candidates.sort((a, b) => rank[a.kind] - rank[b.kind] || a.dueDate.localeCompare(b.dueDate));
  const first = candidates[0] ?? null;
  if (
    first &&
    candidates.some((other) => other.kind === first.kind && other.currency !== first.currency)
  )
    return { ...first, amount: null, currency: undefined };
  return first;
}

function nativeAmount(row: ReceivableRow) {
  return row.currency === "XOF" ? row.amount_xof : row.amount_native;
}
function nativePaid(row: ReceivableRow) {
  return row.currency === "XOF" ? row.paid_amount_xof : row.paid_amount_native;
}

/** One asset, one card. Documents and contract numbers are never a data gate. */
export function buildLeaseRoomOverview(input: LeaseRoomOverviewInput): LeaseRoomOverviewRow[] {
  if (!date(input.today)) throw new Error("InvalidLeaseRoomDate");
  const buildings = new Map(input.buildings.map((row) => [row.id, row]));
  const customers = new Map(input.customers.map((row) => [row.id, row]));
  const records = new Map<string, LeaseContractRow[]>();
  for (const record of input.contracts) {
    const list = records.get(record.unit_id) ?? [];
    if (!list.some((existing) => existing.id === record.id)) list.push(record);
    records.set(record.unit_id, list);
  }
  const units = [...new Map(input.units.map((unit) => [unit.id, unit])).values()];
  return units.map((unit): LeaseRoomOverviewRow => {
    const history = [...(records.get(unit.id) ?? [])].sort(
      (a, b) =>
        String(b.start_date ?? "").localeCompare(String(a.start_date ?? "")) ||
        b.id.localeCompare(a.id),
    );
    const active = history.filter((record) => record.status === "active");
    const drafts = history.filter((record) => record.status === "draft" && !record.actual_end_date);
    const reviews: string[] = [];
    const conflict = active.length > 1 || (!active.length && drafts.length > 1);
    let contract = conflict ? null : (active[0] ?? drafts[0] ?? null);
    let occupancy: LeaseRoomOccupancy = "unknown";
    if (conflict) {
      reviews.push("multiple_current_records");
      occupancy = "conflict";
    } else if (contract) {
      if (date(contract.actual_end_date) && contract.actual_end_date <= input.today) {
        reviews.push("active_record_has_end");
        contract = null;
      } else {
        if (contract.actual_end_date) reviews.push("record_end_needs_review");
        const commencement = (contract as LeaseContractRow & { commencement_state?: string })
          .commencement_state;
        if (
          contract.status === "draft" ||
          (date(contract.start_date) && contract.start_date > input.today) ||
          commencement === "not_started"
        )
          occupancy = "scheduled";
        else if (date(contract.start_date) && contract.start_date <= input.today)
          occupancy = "leased";
        else {
          occupancy = "unknown";
          reviews.push("commencement_unverified");
        }
        if (date(contract.expected_end_date) && contract.expected_end_date < input.today)
          reviews.push("registered_period_needs_review");
      }
    }
    if (!contract && !conflict) {
      if (unit.status === "reserved") occupancy = "reserved";
      else if (unit.status === "daily_occupied" || unit.status === "cleaning_pending")
        occupancy = "other_occupied";
      else if (unit.status === "available" && unit.occupancy_verified === true)
        occupancy = "available";
      else if (unit.status === "leased" || history.length) reviews.push("current_use_unverified");
    }
    const condition = unit.operational_condition ?? unit.status;
    if (!conflict && condition === "maintenance") occupancy = "maintenance";
    if (!conflict && condition === "locked") occupancy = "locked";
    const paidThrough =
      contract && date(contract.paid_through_date) ? contract.paid_through_date : null;
    const attention = contract ? billingAttention(contract, unit, input, reviews) : null;
    return {
      unit,
      building: buildings.get(unit.building_id) ?? null,
      contract,
      customer: contract ? (customers.get(contract.customer_id) ?? null) : null,
      records: history,
      occupancy,
      attention,
      conflict,
      paidThrough,
      reviewReasons: reviews,
    };
  });
}

export interface LeaseRecordAttention extends Omit<LeaseRoomAttention, "kind"> {
  kind: LeaseRoomAttention["kind"] | "unsettled";
}

export interface LeaseRecordBalance {
  currency: CurrencyCode;
  category: ReceivableRow["category"];
  outstanding: number;
  overdue: number;
  nextDue: string | null;
}

export interface LeaseRecordOverviewRow {
  id: string;
  unit: WorkspaceUnit;
  building: LeaseBuilding | null;
  contract: LeaseContractRow;
  customer: CustomerRow | null;
  historical: boolean;
  occupancy: LeaseRoomOccupancy;
  attention: LeaseRecordAttention | null;
  paidThrough: string | null;
  conflict: boolean;
  reviewReasons: string[];
  balances: LeaseRecordBalance[];
}

function recordReviewAttention(
  rows: readonly ReceivableRow[],
  today: string,
): LeaseRecordAttention {
  const knownDate = rows
    .map((row) => row.due_date)
    .filter(date)
    .sort()[0];
  // For a review this is only a source date/as-of fallback, never a due-date claim.
  return {
    kind: "coverage",
    dueDate: knownDate ?? today,
    days: null,
    amount: null,
    amountIsEstimated: false,
  };
}

function recordBilling(
  record: LeaseContractRow,
  unit: WorkspaceUnit,
  historical: boolean,
  input: LeaseRoomOverviewInput,
  reviews: string[],
): { balances: LeaseRecordBalance[]; attention: LeaseRecordAttention | null } {
  const summary = input.summaries?.[record.id];
  if (!input.receivables) {
    if (!historical)
      return { balances: [], attention: billingAttention(record, unit, input, reviews) };
    if (summary && summary.count > 0 && (summary.outstanding > 0 || summary.overdue > 0)) {
      reviews.push("historical_balance_requires_review");
      return { balances: [], attention: recordReviewAttention([], input.today) };
    }
    return { balances: [], attention: null };
  }
  const sourceRows = input.receivables.filter(
    (row) => row.source_type === "lease_contract" && row.source_id === record.id,
  );
  const rows = sourceRows.filter(
    (row) => row.status !== "cancelled" && row.management_status !== "excluded",
  );
  const groups = new Map<
    string,
    {
      currency: CurrencyCode;
      category: ReceivableRow["category"];
      outstanding: number;
      overdue: number;
      nextDue: string | null;
    }
  >();
  const uncertain: ReceivableRow[] = [];
  const payable: { currency: CurrencyCode; balance: number; dueDate: string }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const currency = row.currency as CurrencyCode;
    // Original native money is authoritative; a shadow XOF valuation is not a second bill.
    const amount = money(nativeAmount(row)),
      paid = money(nativePaid(row));
    const open = amount !== null && paid !== null ? Math.max(0, amount - paid) : null;
    const shadowAmount = money(row.amount_xof),
      shadowPaid = money(row.paid_amount_xof);
    const uncertainNativeShadow =
      currency !== "XOF" &&
      row.status === "pending" &&
      shadowAmount !== null &&
      shadowPaid !== null &&
      shadowAmount > shadowPaid;
    const unpaidEvidence =
      open !== null
        ? open > 0
        : row.status === "overdue" ||
          row.status === "partial" ||
          (amount !== null && amount > 0 && paid === null && row.status === "pending") ||
          uncertainNativeShadow;
    const matches =
      (row.unit_id === null || row.unit_id === unit.id) &&
      (row.building_id === null || row.building_id === unit.building_id) &&
      (row.customer_id === null || row.customer_id === record.customer_id);
    const valid =
      !seen.has(row.id) &&
      matches &&
      ["XOF", "CNY", "USD"].includes(currency) &&
      ["pending", "partial", "paid", "overdue"].includes(row.status) &&
      date(row.due_date) &&
      amount !== null &&
      paid !== null &&
      typeof row.category === "string" &&
      (row.category !== "lease_rent" || currency === (record.rent_currency ?? "XOF")) &&
      (row.category !== "property_fee" || currency === "XOF") &&
      (row.status !== "paid" || open === 0);
    seen.add(row.id);
    if (!valid) {
      reviews.push("billing_data_conflict");
      if (unpaidEvidence) uncertain.push(row);
      continue;
    }
    if (open === 0) continue;
    if (row.management_status !== "managed") {
      reviews.push("historical_balance_requires_review");
      uncertain.push(row);
      continue;
    }
    payable.push({ currency, balance: open!, dueDate: row.due_date });
    const key = `${currency}:${row.category}`;
    const group = groups.get(key) ?? {
      currency,
      category: row.category,
      outstanding: 0,
      overdue: 0,
      nextDue: null,
    };
    group.outstanding += open!;
    if (row.due_date < input.today) group.overdue += open!;
    if (!group.nextDue || row.due_date < group.nextDue) group.nextDue = row.due_date;
    groups.set(key, group);
  }
  const balances = [...groups.values()].map((group) => ({
    ...group,
    outstanding: group.outstanding / 100,
    overdue: group.overdue / 100,
  }));
  if (uncertain.length)
    return { balances, attention: recordReviewAttention(uncertain, input.today) };
  const currencies = new Map<
    CurrencyCode,
    { outstanding: number; overdue: number; nextDue: string | null }
  >();
  for (const balance of groups.values()) {
    const total = currencies.get(balance.currency) ?? { outstanding: 0, overdue: 0, nextDue: null };
    total.outstanding += balance.outstanding;
    total.overdue += balance.overdue;
    if (balance.nextDue && (!total.nextDue || balance.nextDue < total.nextDue))
      total.nextDue = balance.nextDue;
    currencies.set(balance.currency, total);
  }
  const candidates: LeaseRecordAttention[] = [];
  for (const [currency, total] of currencies) {
    if (!total.nextDue) continue;
    if (historical) {
      const overdue = total.overdue > 0;
      candidates.push({
        kind: overdue ? "overdue" : "unsettled",
        dueDate: total.nextDue,
        days:
          (Date.parse(`${total.nextDue}T00:00:00Z`) - Date.parse(`${input.today}T00:00:00Z`)) /
          86400000,
        amount: (overdue ? total.overdue : total.outstanding) / 100,
        currency,
        amountIsEstimated: false,
      });
    } else {
      const resolved = resolveLeaseAttention({
        today: input.today,
        paidThroughDate: record.paid_through_date ?? null,
        outstanding: total.outstanding / 100,
        overdue: total.overdue / 100,
        nextDue: total.nextDue,
      });
      if (resolved) {
        if (resolved.kind === "upcoming") {
          const end = new Date(`${input.today}T00:00:00Z`);
          end.setUTCDate(end.getUTCDate() + 15);
          const through = end.toISOString().slice(0, 10);
          resolved.amount =
            payable
              .filter(
                (row) =>
                  row.currency === currency && row.dueDate >= input.today && row.dueDate <= through,
              )
              .reduce((sum, row) => sum + row.balance, 0) / 100;
        }
        candidates.push({ ...resolved, ...(resolved.kind !== "coverage" ? { currency } : {}) });
      }
    }
  }
  const rank = { overdue: 0, unsettled: 1, upcoming: 2, coverage: 3 };
  candidates.sort((a, b) => rank[a.kind] - rank[b.kind] || a.dueDate.localeCompare(b.dueDate));
  let attention = candidates[0] ?? null;
  if (
    attention &&
    candidates.some(
      (other) => other.kind === attention!.kind && other.currency !== attention!.currency,
    )
  )
    attention = { ...attention, amount: null, currency: undefined };
  if (attention) return { balances, attention };
  if (historical) {
    if (
      !sourceRows.length &&
      summary &&
      summary.count > 0 &&
      (summary.outstanding > 0 || summary.overdue > 0)
    ) {
      reviews.push("historical_balance_requires_review");
      return { balances, attention: recordReviewAttention([], input.today) };
    }
    // Closed records never acquire a debt or reminder from their old paid-through date.
    return { balances, attention: null };
  }
  return { balances, attention: billingAttention(record, unit, input, reviews) };
}

/** Every authorized rental record remains reachable, including former users of a room. */
export function buildLeaseRecordOverview(input: LeaseRoomOverviewInput): LeaseRecordOverviewRow[] {
  if (!date(input.today)) throw new Error("InvalidLeaseRoomDate");
  const units = new Map(input.units.map((unit) => [unit.id, unit]));
  const buildings = new Map(input.buildings.map((building) => [building.id, building]));
  const customers = new Map(input.customers.map((customer) => [customer.id, customer]));
  const roomRows = new Map(buildLeaseRoomOverview(input).map((row) => [row.unit.id, row]));
  return [...new Map(input.contracts.map((record) => [record.id, record])).values()].flatMap(
    (record) => {
      const unit = units.get(record.unit_id);
      if (!unit) return [];
      const historical =
        record.status === "terminated" ||
        record.status === "expired" ||
        (date(record.actual_end_date) && record.actual_end_date <= input.today);
      const room = roomRows.get(unit.id)!;
      const ownsRoomState = room.contract?.id === record.id;
      const conflict = !historical && record.status === "active" && room.conflict;
      const reviews = ownsRoomState ? [...room.reviewReasons] : [];
      if (conflict) reviews.push("multiple_current_records");
      if (record.status === "active" && historical) reviews.push("record_status_end_conflict");
      if (historical && date(record.actual_end_date) && record.actual_end_date > input.today)
        reviews.push("record_status_end_conflict");
      const financial = recordBilling(record, unit, historical, input, reviews);
      const occupancy: LeaseRoomOccupancy = historical
        ? "unknown"
        : conflict
          ? "conflict"
          : ownsRoomState
            ? room.occupancy
            : record.status === "draft" ||
                (date(record.start_date) && record.start_date > input.today)
              ? "scheduled"
              : "unknown";
      return [
        {
          id: record.id,
          unit,
          building: buildings.get(unit.building_id) ?? null,
          contract: record,
          customer: customers.get(record.customer_id) ?? null,
          historical,
          occupancy,
          attention: financial.attention,
          paidThrough: date(record.paid_through_date) ? record.paid_through_date : null,
          conflict,
          reviewReasons: [...new Set(reviews)],
          balances: financial.balances,
        },
      ];
    },
  );
}
