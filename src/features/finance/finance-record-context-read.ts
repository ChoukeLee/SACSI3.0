import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FinanceKind } from "./finance-read";
import { CIMAC_PROJECT_ID } from "./cimac-export-model";
import {
  decodeFinanceRecordContext,
  financeRecordContextUuid,
  type FinanceRecordContext,
} from "./finance-record-context";

type Row = Record<string, unknown>;
type Client = Pick<SupabaseClient, "from"> & Partial<Pick<SupabaseClient, "rpc">>;
export class FinanceRecordContextReadError extends Error {
  constructor(public readonly status: 403 | 404 | 503) {
    super(
      status === 404
        ? "financeRecordContextNotFound"
        : status === 403
          ? "financeRecordContextPermissionDenied"
          : "financeRecordContextUnavailable",
    );
  }
}
const fail = (): never => {
  throw new FinanceRecordContextReadError(503);
};
function text(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : fail();
}
function nullableId(value: unknown): string | null {
  if (value === null) return null;
  return typeof value === "string" && financeRecordContextUuid.test(value) ? value : fail();
}
function numeric(value: unknown): number {
  if (typeof value !== "number" && (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value)))
    fail();
  const result = Number(value);
  return Number.isFinite(result) && Math.abs(result) <= Number.MAX_SAFE_INTEGER / 100
    ? result
    : fail();
}
async function one(
  client: Client,
  table: string,
  columns: string,
  target: string,
): Promise<Row | null> {
  const { data, error } = await client.from(table).select(columns).eq("id", target).maybeSingle();
  if (error) throw new FinanceRecordContextReadError(error.code === "42501" ? 403 : 503);
  const row: unknown = data;
  if (row === null) return null; // RLS-hidden associations remain unknown, not a substitute source.
  if (!row || typeof row !== "object" || Array.isArray(row) || (row as Row).id !== target) fail();
  return row as Row;
}

const ledgerColumns =
  "id,building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,description,currency,amount_native";
const receivableColumns =
  "id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,status,management_status,service_period_start,service_period_end,service_period_source,currency,amount_native,paid_amount_native";

async function exactRows(
  client: Client,
  table: string,
  columns: string,
  keys: string[],
): Promise<Row[] | null> {
  if (!keys.length) return [];
  const { data, error } = await client.from(table).select(columns).in("id", keys);
  if (error) throw new FinanceRecordContextReadError(error.code === "42501" ? 403 : 503);
  const raw: unknown = data;
  if (!Array.isArray(raw)) return fail();
  const expected = new Set(keys);
  for (const row of raw as Row[])
    if (!row || typeof row !== "object" || !expected.delete(String(row.id))) fail();
  return expected.size ? null : (raw as Row[]);
}

function minor(value: unknown): bigint {
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(raw)) return fail();
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
}

/** A customer receipt is never relabelled as a single-contract payment header. */
async function readCustomerCollectionContext(
  client: Client,
  context: FinanceRecordContext,
  row: Row,
  payment: Row,
): Promise<FinanceRecordContext> {
  if (
    !context.unit ||
    context.building?.projectId !== CIMAC_PROJECT_ID ||
    payment.unit_id !== null ||
    payment.source_id !== payment.customer_id ||
    payment.currency !== "XOF" ||
    payment.native_settlement !== false ||
    numeric(payment.exchange_rate_to_xof) !== 1 ||
    payment.payment_date !== row.entry_date ||
    row.direction !== "income" ||
    row.currency !== "XOF" ||
    row.amount_native !== null
  )
    return decodeFinanceRecordContext(context);
  const customerId = nullableId(payment.customer_id);
  if (!customerId) return decodeFinanceRecordContext(context);
  if (!client.rpc) return decodeFinanceRecordContext(context);
  const proof = await client.rpc("cimac_customer_collection_proof_rpc", {
    p_payment_id: payment.id,
  });
  if (proof.error)
    throw new FinanceRecordContextReadError(proof.error.code === "42501" ? 403 : 503);
  if (proof.data !== true) return decodeFinanceRecordContext(context);
  const [allocationResult, ledgerResult] = await Promise.all([
    client
      .from("payment_receivable_allocations")
      .select("payment_id,receivable_id,amount_xof")
      .eq("payment_id", String(payment.id))
      .limit(101),
    client
      .from("ledger_entries")
      .select(ledgerColumns)
      .eq("payment_id", String(payment.id))
      .limit(101),
  ]);
  for (const result of [allocationResult, ledgerResult])
    if (result.error)
      throw new FinanceRecordContextReadError(result.error.code === "42501" ? 403 : 503);
  const allocations = allocationResult.data as Row[] | null,
    ledger = ledgerResult.data as Row[] | null;
  if (
    !Array.isArray(allocations) ||
    !Array.isArray(ledger) ||
    !allocations.length ||
    allocations.length > 100 ||
    ledger.length !== allocations.length
  )
    return decodeFinanceRecordContext(context);
  const receivableIds = new Set<string>();
  for (const allocation of allocations) {
    const receivableId = nullableId(allocation.receivable_id);
    if (allocation.payment_id !== payment.id || !receivableId || receivableIds.has(receivableId))
      return decodeFinanceRecordContext(context);
    receivableIds.add(receivableId);
  }
  const receivables = await exactRows(
    client,
    "receivables",
    "id,unit_id,building_id,customer_id,source_type,source_id,category,currency,amount_native,paid_amount_native",
    [...receivableIds],
  );
  if (!receivables) return decodeFinanceRecordContext(context);
  const unitIds = new Set<string>(),
    buildingIds = new Set<string>();
  for (const receivable of receivables) {
    const unitId = nullableId(receivable.unit_id),
      buildingId = nullableId(receivable.building_id);
    if (
      !unitId ||
      !buildingId ||
      !nullableId(receivable.source_id) ||
      receivable.customer_id !== customerId ||
      receivable.source_type !== "lease_contract" ||
      !["lease_rent", "property_fee"].includes(String(receivable.category)) ||
      receivable.currency !== "XOF" ||
      receivable.amount_native !== null ||
      receivable.paid_amount_native !== null
    )
      return decodeFinanceRecordContext(context);
    unitIds.add(unitId);
    buildingIds.add(buildingId);
  }
  const [units, buildings] = await Promise.all([
    exactRows(client, "units", "id,building_id", [...unitIds]),
    exactRows(client, "buildings", "id,project_id", [...buildingIds]),
  ]);
  if (!units || !buildings || buildings.some((item) => item.project_id !== CIMAC_PROJECT_ID))
    return decodeFinanceRecordContext(context);
  const unitBuildings = new Map(units.map((item) => [item.id, item.building_id]));
  if (receivables.some((item) => unitBuildings.get(item.unit_id) !== item.building_id))
    return decodeFinanceRecordContext(context);
  const byId = new Map(receivables.map((item) => [item.id, item]));
  const groups = new Map<string, bigint>(),
    posted = new Map<string, bigint>();
  let total = BigInt(0);
  const matchingContracts = new Set<string>();
  for (const allocation of allocations) {
    const receivable = byId.get(allocation.receivable_id)!;
    const value = minor(allocation.amount_xof);
    if (value <= BigInt(0)) return decodeFinanceRecordContext(context);
    const key = `${receivable.unit_id}:${receivable.building_id}:${receivable.category}`;
    groups.set(key, (groups.get(key) ?? BigInt(0)) + value);
    total += value;
    if (
      receivable.unit_id === row.unit_id &&
      receivable.building_id === row.building_id &&
      receivable.category === row.category &&
      value === minor(row.amount_xof)
    )
      matchingContracts.add(String(receivable.source_id));
  }
  const seen = new Set<string>();
  for (const entry of ledger) {
    const entryId = nullableId(entry.id);
    if (
      !entryId ||
      seen.has(entryId) ||
      entry.payment_id !== payment.id ||
      entry.entry_date !== payment.payment_date ||
      entry.direction !== "income" ||
      entry.currency !== "XOF" ||
      entry.amount_native !== null
    )
      return decodeFinanceRecordContext(context);
    seen.add(entryId);
    const key = `${entry.unit_id}:${entry.building_id}:${entry.category}`;
    posted.set(key, (posted.get(key) ?? BigInt(0)) + minor(entry.amount_xof));
  }
  const principal = ledger.find((entry) => entry.id === row.id);
  if (
    !principal ||
    ["unit_id", "building_id", "category", "entry_date"].some(
      (key) => principal[key] !== row[key],
    ) ||
    minor(principal.amount_xof) !== minor(row.amount_xof) ||
    total !== minor(payment.amount) ||
    groups.size !== posted.size ||
    [...groups].some(([key, value]) => posted.get(key) !== value) ||
    !matchingContracts.size
  )
    return decodeFinanceRecordContext(context);
  let contractLabel: string | null = null;
  if (matchingContracts.size === 1) {
    const contract = await one(
      client,
      "lease_contracts",
      "id,unit_id,customer_id,contract_no",
      [...matchingContracts][0],
    );
    if (contract && contract.unit_id === row.unit_id && contract.customer_id === customerId)
      contractLabel = text(contract.contract_no);
  }
  context.paymentMethod = payment.payment_method === null ? null : text(payment.payment_method);
  // source_id remains the real customer ID; paymentId is already a separate field.
  context.source = {
    type: "cimac_customer_collection",
    id: customerId,
    label: contractLabel,
    href: null,
    linkKind: null,
  };
  const customer = await one(client, "customers", "id,name", customerId);
  if (customer) context.customer = { id: customerId, label: text(customer.name) };
  return decodeFinanceRecordContext(context);
}

/** Bounded, selected-ID lookups using only the authenticated caller's RLS client. */
export async function readFinanceRecordContext(
  client: Client,
  query: { kind: FinanceKind; id: string },
): Promise<FinanceRecordContext> {
  const row = await one(
    client,
    query.kind === "ledger" ? "ledger_entries" : "receivables",
    query.kind === "ledger" ? ledgerColumns : receivableColumns,
    query.id,
  );
  if (!row) throw new FinanceRecordContextReadError(404);
  const unitId = nullableId(row.unit_id),
    buildingId = nullableId(row.building_id);
  const unit = unitId ? await one(client, "units", "id,unit_no,building_id", unitId) : null;
  const effectiveBuildingId = buildingId ?? (unit ? nullableId(unit.building_id) : null);
  const building = effectiveBuildingId
    ? await one(client, "buildings", "id,display_name,project_id", effectiveBuildingId)
    : null;
  const principalScopeConsistent = !unit || !buildingId || unit.building_id === buildingId;
  const context: FinanceRecordContext = {
    kind: query.kind,
    id: query.id,
    amountXof: numeric(row.amount_xof),
    ...(row.amount_native != null
      ? {
          nativeAmount: numeric(row.amount_native),
          currency: text(row.currency),
          ...(query.kind === "receivables"
            ? { nativePaidAmount: numeric(row.paid_amount_native) }
            : {}),
        }
      : {}),
    date: text(query.kind === "ledger" ? row.entry_date : row.due_date),
    category: text(row.category),
    direction:
      query.kind === "ledger" ? (row.direction as FinanceRecordContext["direction"]) : null,
    title:
      query.kind === "ledger"
        ? row.description === null
          ? null
          : text(row.description)
        : text(row.title),
    paidAmountXof: query.kind === "receivables" ? numeric(row.paid_amount_xof) : null,
    status: query.kind === "receivables" ? text(row.status) : null,
    managementStatus:
      query.kind === "receivables"
        ? row.management_status === null
          ? null
          : text(row.management_status)
        : null,
    paymentId: query.kind === "ledger" ? nullableId(row.payment_id) : null,
    paymentMethod: null,
    building: building
      ? {
          id: text(building.id),
          label: text(building.display_name),
          projectId: nullableId(building.project_id),
        }
      : null,
    unit:
      unit && building && principalScopeConsistent
        ? { id: text(unit.id), label: text(unit.unit_no) }
        : null,
    customer: null,
    source: null,
    period: null,
  };
  if (query.kind === "receivables") {
    const start = row.service_period_start,
      end = row.service_period_end,
      source = row.service_period_source;
    if (start !== null || end !== null || source !== null)
      context.period = {
        start: start === null ? null : text(start),
        end: end === null ? null : text(end),
        source: source === null ? null : text(source),
      };
  }
  if (!principalScopeConsistent || !building) return decodeFinanceRecordContext(context);

  // A payment ID is evidence only through the exact ledger link. Its unit/source
  // must still agree with this selected row before associated metadata is exposed.
  const payment = context.paymentId
    ? await one(
        client,
        "payments",
        "id,unit_id,customer_id,source_type,source_id,payment_method,amount,currency,exchange_rate_to_xof,native_settlement,payment_date",
        context.paymentId,
      )
    : null;
  let sourceType: string | null =
    query.kind === "receivables"
      ? text(row.source_type)
      : payment
        ? text(payment.source_type)
        : null;
  let sourceId: string | null =
    query.kind === "receivables"
      ? nullableId(row.source_id)
      : payment
        ? nullableId(payment.source_id)
        : null;
  const paymentUnitId = payment ? nullableId(payment.unit_id) : null;
  if (paymentUnitId && unitId && paymentUnitId !== unitId)
    return decodeFinanceRecordContext(context);
  if (payment && sourceType === "cimac_customer_collection")
    return readCustomerCollectionContext(client, context, row, payment);

  const matchesScope = async (candidateUnitId: string | null) => {
    if (!candidateUnitId || (unitId && candidateUnitId !== unitId)) return false;
    if (paymentUnitId && paymentUnitId !== candidateUnitId) return false;
    const candidate =
      unit && unit.id === candidateUnitId
        ? unit
        : await one(client, "units", "id,unit_no,building_id", candidateUnitId);
    return Boolean(candidate && candidate.building_id === building.id);
  };
  const paymentMethod = () =>
    payment?.payment_method === null || !payment ? null : text(payment.payment_method);
  if (payment && paymentUnitId && (await matchesScope(paymentUnitId)))
    context.paymentMethod = paymentMethod();
  if (payment && sourceType === "manual" && sourceId === row.id && !paymentUnitId && !unitId)
    context.paymentMethod = paymentMethod();

  let contract: Row | null = null;
  if (sourceId && sourceType === "daily_booking") {
    contract = await one(client, "daily_bookings", "id,unit_id,guest_customer_id", sourceId);
  } else if (sourceId && sourceType?.startsWith("lease")) {
    contract = await one(client, "lease_contracts", "id,unit_id,customer_id,contract_no", sourceId);
    sourceType = "lease_contract";
  } else if (sourceId && sourceType?.startsWith("sale")) {
    contract = await one(client, "sale_contracts", "id,unit_id,customer_id,contract_no", sourceId);
    sourceType = "sale_contract";
  } else if (sourceId && ["property_fee", "parking_fee"].includes(sourceType ?? "")) {
    // Both businesses use these kinds. Exact UUID links only; never latest-by-room.
    const [lease, sale] = await Promise.all([
      one(client, "lease_contracts", "id,unit_id,customer_id,contract_no", sourceId),
      one(client, "sale_contracts", "id,unit_id,customer_id,contract_no", sourceId),
    ]);
    if (Boolean(lease) !== Boolean(sale)) {
      contract = lease ?? sale;
      sourceType = lease ? "lease_contract" : "sale_contract";
    }
  }
  if (!contract || !(await matchesScope(nullableId(contract.unit_id))))
    return decodeFinanceRecordContext(context);
  // A contract may have been corrected after this financial record was posted.
  // Its current customer cannot replace a conflicting explicit historical customer.
  // Legacy daily customer_id is the booking agent, not guest evidence, so daily
  // bookings continue to resolve only through their explicit guest_customer_id.
  const customerId = nullableId(
    sourceType === "daily_booking" ? contract.guest_customer_id : contract.customer_id,
  );
  if (sourceType !== "daily_booking") {
    const financialCustomerId =
      query.kind === "receivables"
        ? nullableId(row.customer_id)
        : payment
          ? nullableId(payment.customer_id)
          : null;
    if (financialCustomerId && financialCustomerId !== customerId)
      return decodeFinanceRecordContext(context);
  }
  sourceId = text(contract.id);
  const projectId = context.building?.projectId;
  const route =
    sourceType === "lease_contract" ? "/leases" : sourceType === "sale_contract" ? "/sales" : null;
  const href =
    route && projectId ? `${route}?${new URLSearchParams({ project: projectId })}` : null;
  context.source = {
    type: text(sourceType),
    id: sourceId,
    label: contract.contract_no === undefined ? null : text(contract.contract_no),
    href,
    linkKind: href ? "workspace" : null,
  };
  context.paymentMethod = paymentMethod();
  // Only this exact authorized contract/booking supplies a customer. The current
  // room occupant and legacy daily booking-agent identity are not guest evidence.
  const customer = customerId ? await one(client, "customers", "id,name", customerId) : null;
  if (customer) context.customer = { id: text(customer.id), label: text(customer.name) };
  return decodeFinanceRecordContext(context);
}
