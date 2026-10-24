import type {
  CimacCustomerAccount,
  CimacCustomerSummary,
  CimacCurrencyBalance,
} from "./cimac-billing-types";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const currencies = ["XOF", "USD", "CNY"];
const fail = (): never => {
  throw new Error("CimacAccountUnavailable");
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) return fail();
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return fail();
  return value;
}
function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return fail();
  return value as number;
}
function date(value: unknown) {
  if (typeof value !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return fail();
  const n = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== value) return fail();
  return value;
}
function timestamp(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return fail();
  return value;
}
function nullable(value: unknown, check: (value: unknown) => unknown) {
  if (value !== null) check(value);
}
function optionalText(value: unknown) {
  if (typeof value !== "string") return fail();
  return value;
}
function quantity(value: unknown) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,3})?$/.test(value))
    return fail();
  return value;
}
function array(value: unknown) {
  if (!Array.isArray(value) || value.length > 20000) return fail();
  return value;
}
/** Exact read-boundary arithmetic; null and absent values are never monetary zero. */
export function cimacReadMinor(value: unknown): bigint {
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(raw)) return fail();
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
}
function money(value: unknown): string {
  if (typeof value !== "string") return fail();
  cimacReadMinor(value);
  return value;
}
function balance(value: unknown): CimacCurrencyBalance {
  const row = record(value);
  if (!currencies.includes(String(row.currency))) return fail();
  const receivable = money(row.receivable),
    paid = money(row.paid),
    outstanding = money(row.outstanding),
    overdue = money(row.overdue);
  if (
    cimacReadMinor(paid) > cimacReadMinor(receivable) ||
    cimacReadMinor(outstanding) !== cimacReadMinor(receivable) - cimacReadMinor(paid) ||
    cimacReadMinor(overdue) > cimacReadMinor(outstanding)
  )
    return fail();
  return {
    currency: row.currency as CimacCurrencyBalance["currency"],
    receivable,
    paid,
    outstanding,
    overdue,
  };
}
function customer(value: unknown): CimacCustomerSummary {
  const row = record(value);
  nullable(row.phone, optionalText);
  const balances = array(row.balances).map(balance);
  if (new Set(balances.map((b) => b.currency)).size !== balances.length) return fail();
  return {
    id: id(row.id),
    name: text(row.name),
    phone: row.phone as string | null,
    unitCount: integer(row.unitCount),
    contractCount: integer(row.contractCount),
    pendingCount: integer(row.pendingCount),
    balances,
  };
}
function uniqueRows(value: unknown) {
  const rows = array(value).map((raw) => ({ ...record(raw) })),
    seen = new Set<string>();
  for (const row of rows) {
    const key = id(row.id);
    if (seen.has(key)) return fail();
    seen.add(key);
  }
  return rows;
}

/** Reject partial or inconsistent RPC output instead of rendering a reassuring zero. */
export function decodeCimacCustomerAccount(
  value: unknown,
  expectedCustomerId?: string,
): CimacCustomerAccount {
  const data = record(value),
    project = record(data.project),
    page = record(data.customerPage);
  id(project.id);
  text(project.display_name);
  if (project.code !== "CIMAC" || data.complete !== true || typeof data.canWrite !== "boolean")
    return fail();
  const directory = array(page.rows).map(customer);
  if (
    page.pageSize !== 50 ||
    integer(page.page) < 1 ||
    directory.length > 50 ||
    directory.length > integer(page.total) ||
    new Set(directory.map((c) => c.id)).size !== directory.length
  )
    return fail();
  const selected = data.selectedCustomerId === null ? null : id(data.selectedCustomerId);
  if (expectedCustomerId && selected !== expectedCustomerId) return fail();
  const current = data.customer === null ? null : customer(data.customer);
  if (current?.id !== (selected ?? undefined) && !(current === null && selected === null))
    return fail();
  const units = uniqueRows(data.units),
    contracts = uniqueRows(data.contracts),
    receivables = uniqueRows(data.receivables),
    payments = uniqueRows(data.payments),
    terms = uniqueRows(data.feeTerms),
    readings = uniqueRows(data.meterReadings);
  if (!selected && [units, contracts, receivables, payments, terms, readings].some((a) => a.length))
    return fail();
  const unitIds = new Set(units.map((u) => String(u.id))),
    contractIds = new Set(contracts.map((c) => String(c.id))),
    receivableIds = new Set(receivables.map((r) => String(r.id))),
    paymentIds = new Set(payments.map((p) => String(p.id)));
  const unitsById = new Map(units.map((u) => [String(u.id), u]));
  for (const u of units) {
    id(u.building_id);
    text(u.unit_no);
    text(u.code);
    text(u.kind);
    text(u.building_label);
    text(u.building_code);
    if (
      u.area_sqm !== null &&
      (typeof u.area_sqm !== "number" || !Number.isFinite(u.area_sqm) || u.area_sqm < 0)
    )
      return fail();
  }
  for (const c of contracts) {
    if (
      !["lease", "sale"].includes(String(c.kind)) ||
      id(c.customerId) !== selected ||
      !unitIds.has(id(c.unitId))
    )
      return fail();
    text(c.contractNo);
    text(c.status);
    const source = record(c.data);
    if (source.id !== c.id || source.customer_id !== selected || source.unit_id !== c.unitId)
      return fail();
  }
  for (const r of receivables) {
    nullable(r.customer_id, id);
    nullable(r.unit_id, id);
    nullable(r.source_id, id);
    if (r.building_id !== undefined) nullable(r.building_id, id);
    if (r.customer_id !== selected || (r.unit_id !== null && !unitIds.has(String(r.unit_id))))
      return fail();
    if (
      !currencies.includes(String(r.currency)) ||
      typeof r.collectible !== "boolean" ||
      !["pending", "partial", "paid", "overdue", "cancelled"].includes(String(r.status))
    )
      return fail();
    // A genuine building-only record is legal. A recorded unit and a different
    // recorded building are a historical association conflict, not valid debt
    // and not authority to silently repair either source fact.
    if (
      r.unit_id !== null &&
      r.building_id != null &&
      unitsById.get(String(r.unit_id))?.building_id !== r.building_id
    ) {
      r.reviewReason = "unit_building_mismatch";
      r.collectible = false;
    }
    text(r.title);
    text(r.category);
    date(r.due_date);
    timestamp(r.updated_at);
    for (const key of ["service_period_start", "service_period_end"])
      if (r[key] !== undefined) nullable(r[key], date);
    if (
      r.service_period_start &&
      r.service_period_end &&
      String(r.service_period_start) > String(r.service_period_end)
    )
      return fail();
    if (
      r.currency !== "XOF" &&
      (r.amount_native === null ||
        r.amount_native === undefined ||
        r.paid_amount_native === null ||
        r.paid_amount_native === undefined)
    ) {
      if (r.collectible) return fail();
      r.reviewReason ??= "native_amount_unknown";
      // Preserve the old row for review, without presenting its XOF storage
      // slots as an amount in its original currency.
      continue;
    }
    const amount = cimacReadMinor(r.currency === "XOF" ? r.amount_xof : r.amount_native);
    const paid = cimacReadMinor(r.currency === "XOF" ? r.paid_amount_xof : r.paid_amount_native);
    const remaining = amount > paid ? amount - paid : BigInt(0);
    if (cimacReadMinor(money(r.outstanding)) !== remaining) return fail();
    if (paid > amount) {
      if (r.collectible) return fail();
      r.reviewReason ??= "historical_overallocation";
    }
    if (
      r.currency !== "XOF" &&
      (cimacReadMinor(r.amount_xof) !== BigInt(0) ||
        cimacReadMinor(r.paid_amount_xof) !== BigInt(0))
    )
      return fail();
    if (
      r.collectible &&
      (r.currency !== "XOF" ||
        r.status === "cancelled" ||
        r.management_status !== "managed" ||
        r.customer_id !== selected ||
        !unitIds.has(String(r.unit_id)) ||
        !contractIds.has(String(r.source_id)) ||
        !["lease_rent", "property_fee"].includes(String(r.category)) ||
        paid === amount)
    )
      return fail();
  }
  for (const p of payments) {
    date(p.payment_date);
    text(p.source_type);
    if (
      !currencies.includes(String(p.currency)) ||
      (typeof p.amount !== "number" && typeof p.amount !== "string") ||
      !Number.isFinite(Number(p.amount)) ||
      Math.abs(Number(p.amount)) > Number.MAX_SAFE_INTEGER / 100 ||
      typeof p.protected_collection !== "boolean"
    )
      return fail();
    for (const key of ["actual_collector", "recorded_by", "receipt_no"])
      if (p[key] !== undefined) nullable(p[key], optionalText);
  }
  const allocations = array(data.allocations).map((raw) => {
    const a = record(raw);
    if (
      !paymentIds.has(id(a.paymentId)) ||
      !receivableIds.has(id(a.receivableId)) ||
      !currencies.includes(String(a.currency))
    )
      return fail();
    money(a.amount);
    return a;
  });
  const links = new Set<string>();
  for (const a of allocations) {
    const key = `${a.paymentId}:${a.receivableId}`;
    if (links.has(key)) return fail();
    links.add(key);
  }
  for (const t of terms) {
    if (
      t.customerId !== selected ||
      !unitIds.has(id(t.unitId)) ||
      !contractIds.has(id(t.contractId)) ||
      t.status !== "pending_review" ||
      !currencies.includes(String(t.currency))
    )
      return fail();
    text(t.source);
    timestamp(t.updatedAt);
    timestamp(t.createdAt);
    id(t.recordedBy);
    nullable(t.monthlyRate, money);
    nullable(t.chargeableArea, quantity);
    for (const key of ["startsOn", "endsOn", "annualStartsOn", "annualEndsOn"])
      nullable(t[key], date);
  }
  for (const m of readings) {
    if (
      m.customerId !== selected ||
      !unitIds.has(id(m.unitId)) ||
      !contractIds.has(id(m.contractId)) ||
      m.status !== "recorded_pending_rate" ||
      !["water", "electricity"].includes(String(m.meterKind))
    )
      return fail();
    text(m.meterNo);
    date(m.serviceMonth);
    date(m.readOn);
    if (!String(m.serviceMonth).endsWith("-01") || String(m.readOn) < String(m.serviceMonth))
      return fail();
    timestamp(m.updatedAt);
    timestamp(m.createdAt);
    id(m.recordedBy);
    const decimal = (value: unknown) => {
      const raw = quantity(value);
      const [whole, fraction = ""] = raw.split(".");
      return BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, "0"));
    };
    const n = decimal(m.currentReading);
    if (m.previousReading === null) {
      if (m.usage !== null) return fail();
    } else {
      const prev = decimal(m.previousReading);
      if (n < prev || m.usage === null || decimal(m.usage) !== n - prev) return fail();
    }
  }
  return {
    ...data,
    project,
    customerPage: { ...page, rows: directory },
    customer: current,
    units,
    contracts,
    receivables,
    payments,
    allocations,
    feeTerms: terms,
    meterReadings: readings,
  } as unknown as CimacCustomerAccount;
}
