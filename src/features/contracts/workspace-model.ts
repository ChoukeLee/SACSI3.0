import type {
  CustomerRow,
  LeaseContractRow,
  PaymentRow,
  ReceivableRow,
  SaleContractRow,
  SalePaymentScheduleRow,
  UnitRow,
} from "@/types/database";
import type { LeaseBuilding } from "@/features/leases/project-scope";
import type { ContractReceivableSummary, ContractSort } from "./contract-list-model";
import type { LeaseOverdueResolution } from "@/features/leases/lease-receivable-summary";
import { readCimacContractAllocation } from "./cimac-contract-allocation";
export type WorkspaceKind = "lease" | "sale";
export type WorkspaceMode = "list" | "scope" | "detail" | "context";
export type WorkspaceContract = LeaseContractRow | SaleContractRow;
export type WorkspaceUnit = UnitRow & {
  unit_business_flags?: {
    business_type: "daily_rental" | "long_lease" | "sale";
    is_enabled: boolean;
    default_price_xof: number | null;
  }[];
};
export interface WorkspaceQuery {
  projectId: string;
  buildingId: string;
  status: string;
  search: string;
  sort: ContractSort["key"];
  direction: ContractSort["direction"];
  page: number;
  locale: "zh" | "fr";
}
export interface WorkspaceStats {
  scopeCount: number;
  active: number;
  rent: number;
  total: number;
  currentDue: number;
  outstanding: number;
  received: number;
  dueOutstanding: number;
  overdue: number;
  overdueContracts: number;
  unknownContracts: number;
  unknownAll: boolean;
  transferDone: number;
  dueSoon: number;
}
export interface WorkspaceData {
  kind: WorkspaceKind;
  mode: WorkspaceMode;
  query: WorkspaceQuery;
  today: string;
  page: number;
  pageSize: number;
  total: number;
  scopeCount: number;
  stats: WorkspaceStats;
  buildings: LeaseBuilding[];
  contracts: WorkspaceContract[];
  units: WorkspaceUnit[];
  customers: CustomerRow[];
  payments: PaymentRow[];
  receivables: ReceivableRow[];
  schedules: SalePaymentScheduleRow[];
  paymentCount: number;
  receivableCount: number;
  scheduleCount: number;
  summaries: Record<string, ContractReceivableSummary & { dueOutstanding: number }>;
  accruals: Record<string, LeaseOverdueResolution | null>;
  attentionDue: Record<string, string | null>;
}
export class WorkspaceReadError extends Error {
  constructor(public status = 503) {
    super("ContractWorkspaceUnavailable");
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseWorkspaceQuery(raw: Record<string, unknown>): WorkspaceQuery {
  const allowed = [
    "projectId",
    "buildingId",
    "status",
    "search",
    "sort",
    "direction",
    "page",
    "locale",
  ];
  if (
    Object.keys(raw).some((k) => !allowed.includes(k)) ||
    Object.values(raw).some((v) => typeof v !== "string" && typeof v !== "number")
  )
    throw new WorkspaceReadError(400);
  const query = {
    projectId: String(raw.projectId ?? ""),
    buildingId: String(raw.buildingId ?? ""),
    status: String(raw.status ?? "current"),
    search: String(raw.search ?? ""),
    sort: String(raw.sort ?? "unit"),
    direction: String(raw.direction ?? "asc"),
    page: Number(raw.page ?? 1),
    locale: String(raw.locale ?? "zh"),
  };
  if (
    [query.projectId, query.buildingId].some((v) => v !== "" && !uuid.test(v)) ||
    !["current", "all", "draft", "active", "terminated", "expired"].includes(query.status) ||
    query.search.length > 200 ||
    !["unit", "customer", "period", "amount", "balance", "status"].includes(query.sort) ||
    !["asc", "desc"].includes(query.direction) ||
    !["zh", "fr"].includes(query.locale) ||
    !Number.isSafeInteger(query.page) ||
    query.page < 1 ||
    query.page > 100000
  )
    throw new WorkspaceReadError(400);
  return query as WorkspaceQuery;
}
export function workspaceQueryKey(query: WorkspaceQuery) {
  return JSON.stringify([
    query.projectId,
    query.buildingId,
    query.status,
    query.search,
    query.sort,
    query.direction,
    query.page,
    query.locale,
  ]);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkspaceReadError();
  return value as Record<string, unknown>;
}
function finite(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new WorkspaceReadError();
  return value;
}
function decimal(value: unknown, nullable = false) {
  if (nullable && value === null) return;
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) ||
    !Number.isFinite(Number(value))
  )
    throw new WorkspaceReadError();
}
function date(value: unknown, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new WorkspaceReadError();
  }
  const parsed = new Date(value + "T00:00:00Z");
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new WorkspaceReadError();
}
function nullableText(value: unknown) {
  if (value !== null && typeof value !== "string") throw new WorkspaceReadError();
}
const paymentTypes = {
  lease: [
    "lease_rent",
    "lease_deposit",
    "lease_contract",
    "property_fee",
    "lease_agency_income",
    "lease_agency_expense",
    "lease_furniture_income",
    "lease_deposit_refund",
    "lease_deposit_deduction",
    "lease_rent_refund",
    "lease_other_income",
    "lease_other_expense",
  ],
  sale: [
    "sale",
    "sale_contract",
    "property_fee",
    "parking_fee",
    "sale_registration_fee",
    "sale_agency_income",
    "sale_agency_expense",
    "sale_other_income",
    "sale_other_expense",
  ],
};
export function decodeWorkspace(
  value: unknown,
  kind: WorkspaceKind,
  query: WorkspaceQuery,
  mode: WorkspaceMode,
  contractId?: string,
): WorkspaceData {
  const data = object(value);
  if (
    data.kind !== kind ||
    data.mode !== mode ||
    workspaceQueryKey(parseWorkspaceQuery(object(data.query))) !== workspaceQueryKey(query) ||
    typeof data.today !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(data.today)
  )
    throw new WorkspaceReadError();
  for (const key of [
    "buildings",
    "contracts",
    "units",
    "customers",
    "payments",
    "receivables",
    "schedules",
  ]) {
    if (!Array.isArray(data[key])) throw new WorkspaceReadError();
    const ids = new Set<string>();
    for (const item of data[key] as unknown[]) {
      const row = object(item);
      if (typeof row.id !== "string" || !uuid.test(row.id) || ids.has(row.id))
        throw new WorkspaceReadError();
      ids.add(row.id);
    }
  }
  for (const key of ["page", "pageSize", "total", "scopeCount"]) {
    const n = finite(data[key]);
    if (!Number.isSafeInteger(n) || n < 0) throw new WorkspaceReadError();
  }
  if (data.page !== query.page || data.pageSize !== 25) throw new WorkspaceReadError();
  const contracts = data.contracts as WorkspaceContract[];
  if (
    mode === "list" &&
    contracts.length !== Math.min(25, Math.max(0, Number(data.total) - (query.page - 1) * 25))
  )
    throw new WorkspaceReadError();
  if ((mode === "scope" || mode === "context") && contracts.length !== data.total)
    throw new WorkspaceReadError();
  if (mode === "detail" && (contracts.length !== 1 || contracts[0].id !== contractId))
    throw new WorkspaceReadError();
  if (
    mode !== "detail" &&
    ((data.payments as unknown[]).length ||
      (data.receivables as unknown[]).length ||
      (data.schedules as unknown[]).length)
  )
    throw new WorkspaceReadError();
  for (const [key, rows] of [
    ["paymentCount", "payments"],
    ["receivableCount", "receivables"],
    ["scheduleCount", "schedules"],
  ])
    if (
      !Number.isSafeInteger(data[key]) ||
      Number(data[key]) < 0 ||
      data[key] !== (data[rows] as unknown[]).length
    )
      throw new WorkspaceReadError();
  const summaries = object(data.summaries),
    accruals = object(data.accruals),
    attention = object(data.attentionDue),
    stats = object(data.stats);
  for (const key of [
    "scopeCount",
    "active",
    "rent",
    "total",
    "currentDue",
    "outstanding",
    "received",
    "dueOutstanding",
    "overdue",
    "overdueContracts",
    "unknownContracts",
    "transferDone",
    "dueSoon",
  ])
    finite(stats[key]);
  if (
    typeof stats.unknownAll !== "boolean" ||
    stats.scopeCount !== data.scopeCount ||
    Number(data.total) > Number(data.scopeCount)
  )
    throw new WorkspaceReadError();
  const units = new Map((data.units as UnitRow[]).map((row) => [row.id, row])),
    customers = new Set((data.customers as CustomerRow[]).map((row) => row.id));
  const buildings = new Map((data.buildings as LeaseBuilding[]).map((row) => [row.id, row]));
  for (const unit of units.values()) {
    const building = buildings.get(unit.building_id);
    if (
      !building ||
      (query.projectId && building.project_id !== query.projectId) ||
      (query.buildingId && building.id !== query.buildingId) ||
      !Array.isArray((unit as WorkspaceUnit).unit_business_flags)
    )
      throw new WorkspaceReadError();
    for (const flag of (unit as WorkspaceUnit).unit_business_flags!) {
      if (typeof flag.business_type !== "string" || typeof flag.is_enabled !== "boolean")
        throw new WorkspaceReadError();
      decimal(flag.default_price_xof, true);
    }
  }
  for (const contract of contracts) {
    if (
      !["draft", "active", "terminated", "expired"].includes(contract.status) ||
      !units.has(contract.unit_id) ||
      !customers.has(contract.customer_id) ||
      typeof contract.updated_at !== "string"
    )
      throw new WorkspaceReadError();
    const summary = object(summaries[contract.id]);
    for (const key of ["total", "paid", "outstanding", "overdue", "count", "dueOutstanding"])
      finite(summary[key]);
    if (summary.nextDue !== null && typeof summary.nextDue !== "string")
      throw new WorkspaceReadError();
    if (
      !(contract.id in accruals) ||
      !(contract.id in attention) ||
      (attention[contract.id] !== null && typeof attention[contract.id] !== "string")
    )
      throw new WorkspaceReadError();
    if (accruals[contract.id] !== null) {
      const a = object(accruals[contract.id]);
      finite(a.amount);
      finite(a.startedPeriods);
      if (typeof a.dueDate !== "string" || !["contract", "receivable"].includes(String(a.source)))
        throw new WorkspaceReadError();
    }
  }
  for (const contract of contracts) {
    const c = contract as unknown as Record<string, unknown>;
    if (typeof c.contract_no !== "string") throw new WorkspaceReadError();
    if (kind === "lease") {
      for (const key of ["monthly_rent_xof", "deposit_amount_xof"]) decimal(c[key], true);
      // Legacy drafts may explicitly have no confirmed contract period yet.
      // Missing keys still fail validation; a legal unknown is not a fabricated date.
      date(c.start_date, true);
      date(c.expected_end_date, true);
      date(c.paid_through_date, true);
      date(c.actual_end_date, true);
      if (
        typeof c.payment_cycle !== "string" ||
        !("expected_end_confirmed" in c) ||
        (c.expected_end_confirmed !== null && typeof c.expected_end_confirmed !== "boolean")
      )
        throw new WorkspaceReadError();
    } else {
      decimal(c.total_amount_xof, true);
      date(c.signed_date);
      date(c.transfer_date, true);
      if (
        typeof c.payment_plan_type !== "string" ||
        typeof c.transfer_status !== "string" ||
        !("total_amount_confirmed" in c) ||
        (c.total_amount_confirmed !== null && typeof c.total_amount_confirmed !== "boolean")
      )
        throw new WorkspaceReadError();
    }
  }
  if (mode === "detail") {
    for (const payment of data.payments as PaymentRow[]) {
      if (payment.source_type === "cimac_customer_collection") {
        const contract = (data.contracts as WorkspaceContract[]).find((c) => c.id === contractId);
        const allocation =
          kind === "lease" && contract
            ? readCimacContractAllocation(payment, contractId, contract.customer_id)
            : null;
        if (
          !allocation ||
          !allocation.receivableIds.every((id) =>
            (data.receivables as ReceivableRow[]).some(
              (r) =>
                r.id === id &&
                r.source_type === "lease_contract" &&
                r.source_id === contractId &&
                ["lease_rent", "property_fee"].includes(r.category),
            ),
          )
        )
          throw new WorkspaceReadError();
      } else if (
        payment.source_id !== contractId ||
        !paymentTypes[kind].includes(payment.source_type)
      )
        throw new WorkspaceReadError();
      decimal(payment.amount);
      if (payment.exchange_rate_to_xof !== null) decimal(payment.exchange_rate_to_xof);
      date(payment.payment_date);
      if (typeof payment.currency !== "string") throw new WorkspaceReadError();
      const p = payment as unknown as Record<string, unknown>;
      for (const key of ["request_kind", "payment_method", "receipt_no", "notes"])
        nullableText(p[key]);
      if (
        !("reversal_of_payment_id" in p) ||
        (p.reversal_of_payment_id !== null &&
          (typeof p.reversal_of_payment_id !== "string" || !uuid.test(p.reversal_of_payment_id)))
      )
        throw new WorkspaceReadError();
    }
    for (const row of data.receivables as ReceivableRow[]) {
      if (row.source_id !== contractId || row.source_type !== `${kind}_contract`)
        throw new WorkspaceReadError();
      decimal(row.amount_xof);
      decimal(row.paid_amount_xof);
      date(row.due_date);
      if (
        !["pending", "partial", "paid", "overdue", "cancelled"].includes(row.status) ||
        typeof row.category !== "string" ||
        !("management_status" in row) ||
        (row.management_status !== null &&
          !["managed", "historical_pending", "excluded"].includes(String(row.management_status)))
      )
        throw new WorkspaceReadError();
    }
    for (const row of data.schedules as SalePaymentScheduleRow[]) {
      if (kind !== "sale" || row.sale_contract_id !== contractId) throw new WorkspaceReadError();
      decimal(row.amount_xof);
      date(row.due_date);
      if (
        !Number.isSafeInteger(row.installment_no) ||
        row.installment_no < 1 ||
        typeof row.status !== "string"
      )
        throw new WorkspaceReadError();
    }
    const managed = (data.receivables as ReceivableRow[]).filter(
      (row) => row.status !== "cancelled" && (row.management_status ?? "managed") === "managed",
    );
    if (managed.length !== object(summaries[contractId!]).count) throw new WorkspaceReadError();
  }
  return data as unknown as WorkspaceData;
}
