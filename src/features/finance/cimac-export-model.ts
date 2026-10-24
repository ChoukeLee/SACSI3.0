/** Pure export boundaries. No credentials, database clients or business writes. */
import { cimacShopPropertyFeeNotice } from "./cimac-property-fee-policy";

export const CIMAC_PROJECT_ID = "33c1528b-6c2f-45fd-bbf1-92863765809a";

export type CimacExportQuery = {
  view:
    | "ledger"
    | "payments"
    | "deposits"
    | "refunds"
    | "property-fee-payments"
    | "property-fee-receivables";
  locale: "zh" | "fr";
  dateFrom?: string;
  dateTo?: string;
};

type Row = Record<string, unknown>;
export type CimacExportBundle = {
  readAt: string;
  ledger: Row[];
  payments: Row[];
  units: Row[];
  buildings: Row[];
  receivables?: Row[];
  /** Exact read-only proof for customer-level receipts in the property-fee export. */
  allocations?: Row[];
  collectionReceivables?: Row[];
  collectionLedger?: Row[];
  verifiedCollectionPaymentIds?: string[];
};

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const directions = new Set(["income", "expense", "liability_in", "liability_out"]);
const views = new Set([
  "ledger",
  "payments",
  "deposits",
  "refunds",
  "property-fee-payments",
  "property-fee-receivables",
]);
const own = (row: Row, key: string) => Object.prototype.hasOwnProperty.call(row, key);
const fail = (): never => {
  throw new Error("Invalid or incomplete CIMAC export data");
};

function record(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as Row;
}

function id(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) return fail();
  return value.toLowerCase();
}

function nullableId(row: Row, key: string): string | null {
  if (!own(row, key)) return fail();
  return row[key] === null ? null : id(row[key]);
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return fail();
  return value;
}

function optionalText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return fail();
  return value;
}

/** Do not coerce null, missing values or empty strings into a zero. */
function amount(value: unknown): number {
  if (
    typeof value !== "number" &&
    !(typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))
  )
    return fail();
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) return fail();
  return result;
}

function nativeMinor(value: unknown): bigint {
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(raw)) return fail();
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
}

function nativeLedger(row: Row): boolean {
  return (
    (row.currency === "CNY" || row.currency === "USD") &&
    row.amount_native !== null &&
    row.amount_native !== undefined
  );
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseCimacExportQuery(search: URLSearchParams): CimacExportQuery {
  const allowed = new Set(["view", "locale", "dateFrom", "dateTo"]);
  for (const key of search.keys()) {
    if (!allowed.has(key) || search.getAll(key).length !== 1)
      throw new Error("Invalid CIMAC export filter");
  }
  const view = search.get("view") ?? "ledger";
  const locale = search.get("locale") ?? "zh";
  if (!views.has(view) || !(locale === "zh" || locale === "fr"))
    throw new Error("Invalid CIMAC export filter");
  const query: CimacExportQuery = { view: view as CimacExportQuery["view"], locale };
  for (const key of ["dateFrom", "dateTo"] as const) {
    if (search.has(key)) {
      const value = search.get(key);
      if (!isDate(value)) throw new Error("Invalid CIMAC export date");
      query[key] = value;
    }
  }
  if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo)
    throw new Error("Invalid CIMAC export date range");
  return query;
}

/** The scalar RPC result is a full export, never one normal display page. */
export function decodeCimacLedger(data: unknown): Row[] {
  const source = record(data);
  if (
    source.kind !== "ledger" ||
    !Number.isSafeInteger(source.total) ||
    Number(source.total) < 0 ||
    Number(source.total) > 100_000 ||
    !Array.isArray(source.rows) ||
    source.rows.length !== source.total
  )
    return fail();
  const seen = new Set<string>();
  return source.rows.map((value) => {
    const row = record(value);
    const key = id(row.id);
    if (seen.has(key)) return fail();
    seen.add(key);
    if (!isDate(row.entry_date) || !directions.has(String(row.direction))) return fail();
    if (typeof row.direction !== "string" || !own(row, "amount_cny")) return fail();
    // Old exports may lack both native fields; that is unknown, never an inferred currency.
    if (own(row, "currency") || own(row, "amount_native")) {
      if (
        !own(row, "currency") ||
        !own(row, "amount_native") ||
        !["XOF", "CNY", "USD"].includes(String(row.currency))
      )
        return fail();
      if (row.currency === "XOF") {
        if (row.amount_native !== null) return fail();
      } else {
        nativeMinor(row.amount_native);
        if (
          amount(row.amount_xof) !== 0 ||
          (row.currency === "CNY" &&
            row.amount_cny !== null &&
            nativeMinor(row.amount_cny) !== nativeMinor(row.amount_native))
        )
          return fail();
      }
    }
    return {
      ...row,
      id: key,
      building_id: nullableId(row, "building_id"),
      unit_id: nullableId(row, "unit_id"),
      payment_id: nullableId(row, "payment_id"),
      category: text(row.category),
      amount_xof: amount(row.amount_xof),
      amount_cny: row.amount_cny === null ? null : amount(row.amount_cny),
    };
  });
}

/** Current book receivables; due dates are never substituted for service periods. */
export function decodeCimacReceivables(data: unknown): Row[] {
  const source = record(data);
  if (
    source.kind !== "receivables" ||
    !Number.isSafeInteger(source.total) ||
    Number(source.total) < 0 ||
    Number(source.total) > 100_000 ||
    !Array.isArray(source.rows) ||
    source.rows.length !== source.total
  )
    return fail();
  const seen = new Set<string>();
  return source.rows.map((value) => {
    const row = record(value),
      key = id(row.id);
    if (seen.has(key) || row.category !== "property_fee" || !isDate(row.due_date)) return fail();
    seen.add(key);
    if (
      typeof row.status !== "string" ||
      typeof row.management_status !== "string" ||
      !["pending", "partial", "paid", "overdue", "cancelled"].includes(row.status) ||
      !["managed", "historical_pending", "excluded"].includes(row.management_status)
    )
      return fail();
    for (const field of [
      "service_period_start",
      "service_period_end",
      "service_period_source",
      "service_period_confirmed_by",
    ]) {
      if (!own(row, field)) return fail();
    }
    const start = row.service_period_start,
      end = row.service_period_end;
    if ((start !== null && !isDate(start)) || (end !== null && !isDate(end))) return fail();
    if (typeof start === "string" && typeof end === "string" && start > end) return fail();
    return {
      ...row,
      id: key,
      building_id: nullableId(row, "building_id"),
      unit_id: nullableId(row, "unit_id"),
      source_id: nullableId(row, "source_id"),
      source_type: text(row.source_type),
      amount_xof: amount(row.amount_xof),
      paid_amount_xof: amount(row.paid_amount_xof),
      service_period_source:
        row.service_period_source === null ? null : text(row.service_period_source),
      service_period_confirmed_by: nullableId(row, "service_period_confirmed_by"),
    };
  });
}

function indexed(rows: Row[]): Map<string, Row> {
  if (!Array.isArray(rows)) return fail();
  const result = new Map<string, Row>();
  for (const value of rows) {
    const row = record(value);
    const key = id(row.id);
    if (result.has(key)) return fail();
    result.set(key, { ...row, id: key });
  }
  return result;
}

/** Quoted CSV plus formula/control-character protection; numeric signs stay numeric. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return fail();
    return `"${value}"`;
  }
  if (typeof value !== "string") return fail();
  const control = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value);
  let safe = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ");
  if (control || /^[\s\uFEFF]*[=+@-]/.test(safe)) safe = "'" + safe;
  return `"${safe.replaceAll('"', '""')}"`;
}

function csv(headers: string[], rows: unknown[][]): string {
  return "\uFEFF" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function receivablesCsv(
  bundle: CimacExportBundle,
  query: CimacExportQuery,
  buildings: Map<string, Row>,
  units: Map<string, Row>,
): string {
  if (bundle.ledger.length || bundle.payments.length || !Array.isArray(bundle.receivables))
    return fail();
  const receivables = decodeCimacReceivables({
    kind: "receivables",
    total: bundle.receivables.length,
    rows: bundle.receivables,
  });
  const zh = query.locale === "zh",
    at = (a: string, b: string) => (zh ? a : b);
  const policyNotice = cimacShopPropertyFeeNotice(query.locale);
  const headers = zh
    ? [
        "读取时间",
        "范围口径（当前应收非历史余额；日期筛选到期日，不是服务账期；空结果不代表免缴或未缴）",
        "应收 ID",
        "项目 ID",
        "来源类型",
        "来源 ID（未据此核验合同）",
        "原应收铺位 ID",
        "归属楼栋 ID（应收登记优先）",
        "楼栋",
        "铺号",
        "到期日",
        "原登记应收金额 XOF",
        "原登记已核销金额 XOF",
        "状态",
        "管理范围",
        "明确账期开始",
        "明确账期结束",
        "账期确认状态",
        "关联说明",
      ]
    : [
        "Lecture à",
        "Périmètre (créances actuelles, pas un solde historique ; filtre sur échéance, pas période de service ; un résultat vide ne prouve ni exonération ni impayé)",
        "ID de la créance",
        "ID du projet",
        "Type de source",
        "ID de source (contrat non vérifié par cet export)",
        "ID du local dans la créance",
        "ID du bâtiment retenu (créance prioritaire)",
        "Bâtiment",
        "Numéro du local",
        "Échéance",
        "Montant dû enregistré XOF",
        "Montant imputé enregistré XOF",
        "Statut",
        "Périmètre de gestion",
        "Début de période explicite",
        "Fin de période explicite",
        "État de confirmation de période",
        "Remarque du lien",
      ];
  // Keep the dated reference visible even when an export contains no rows.
  // It is explanatory metadata, never used to alter dates, amounts or status.
  headers[1] += ` ${policyNotice}`;
  const rows = receivables.map((row) => {
    if (
      (query.dateFrom && String(row.due_date) < query.dateFrom) ||
      (query.dateTo && String(row.due_date) > query.dateTo)
    )
      return fail();
    if (row.building_id === null && row.unit_id === null) return fail();
    const unit = row.unit_id === null ? undefined : units.get(String(row.unit_id));
    if (row.unit_id !== null && !unit) return fail();
    const buildingId = row.building_id ?? unit?.building_id,
      building = buildings.get(String(buildingId));
    if (!building) return fail();
    const allMissing = [
      row.service_period_start,
      row.service_period_end,
      row.service_period_source,
      row.service_period_confirmed_by,
    ].every((value) => value === null);
    const complete =
      row.service_period_start !== null &&
      row.service_period_end !== null &&
      row.service_period_source !== null &&
      row.service_period_confirmed_by !== null;
    const periodState = allMissing
      ? at(
          "未登记明确账期，待核对，不按到期日推导",
          "Période explicite non enregistrée, à vérifier ; aucune déduction depuis l’échéance",
        )
      : complete
        ? at("明确账期及确认信息已登记", "Période explicite et confirmation enregistrées")
        : at(
            "账期依据或确认信息不完整，待核对",
            "Période, justificatif ou confirmation incomplets ; à vérifier",
          );
    return [
      bundle.readAt,
      at(
        "当前物业费应收登记；非历史余额；按到期日筛选；已核销不等于本期实收，不推算年费",
        "Créances actuelles de charges ; pas un solde historique ; filtre sur échéance ; imputations distinctes des encaissements, sans calcul de charges annuelles",
      ) + ` ${policyNotice}`,
      row.id,
      CIMAC_PROJECT_ID,
      row.source_type,
      row.source_id,
      row.unit_id,
      building.id,
      optionalText(building.display_name) || optionalText(building.code),
      unit?.unit_no ?? null,
      row.due_date,
      row.amount_xof,
      row.paid_amount_xof,
      row.status,
      row.management_status,
      row.service_period_start,
      row.service_period_end,
      periodState,
      unit && unit.building_id !== buildingId
        ? at(
            "铺位楼栋与应收不同，以应收登记楼栋为准",
            "Bâtiment du local différent ; bâtiment de la créance prioritaire",
          )
        : "",
    ];
  });
  return csv(headers, rows);
}

/** Exact source + registered direction/category evidence; no receipt-text heuristics. */
function specialPayment(payment: Row, linked: Row[]): void {
  if (
    !own(payment, "payment_method") ||
    (payment.payment_method !== null &&
      (typeof payment.payment_method !== "string" ||
        !["cash", "check", "bank_transfer", "offset", "other"].includes(payment.payment_method)))
  )
    return fail();
  const matches = (row: Row, direction: string, category: string) =>
    row.direction === direction && row.category === category;
  if (
    payment.source_type === "lease_deposit" &&
    !linked.every((row) => matches(row, "liability_in", "lease_deposit"))
  )
    return fail();
  if (
    payment.source_type === "lease_deposit_refund" &&
    !linked.every((row) => matches(row, "liability_out", "lease_deposit"))
  )
    return fail();
  if (
    payment.source_type === "property_fee" &&
    !linked.every((row) => matches(row, "income", "property_fee"))
  )
    return fail();
  if (payment.source_type === "lease_deposit_deduction") {
    const out = (row: Row) => matches(row, "liability_out", "lease_deposit");
    const income = (row: Row) => matches(row, "income", "other_income");
    if (
      payment.payment_method !== "offset" ||
      !linked.some(out) ||
      !linked.some(income) ||
      !linked.every((row) => out(row) || income(row))
    )
      return fail();
  }
}

function customerPropertyFeeProof(
  bundle: CimacExportBundle,
  payments: Map<string, Row>,
  references: Map<string, Row[]>,
  units: Map<string, Row>,
  buildings: Map<string, Row>,
): Map<
  string,
  { amountXof: string; receivableIds: string[]; hasFee: boolean; ambiguous: boolean }
> {
  const targets = [...payments].filter(
    ([, payment]) => payment.source_type === "cimac_customer_collection",
  );
  const proof = new Map<
    string,
    { amountXof: string; receivableIds: string[]; hasFee: boolean; ambiguous: boolean }
  >();
  if (!targets.length) return proof;
  if (
    !Array.isArray(bundle.allocations) ||
    !Array.isArray(bundle.collectionReceivables) ||
    !Array.isArray(bundle.collectionLedger) ||
    !Array.isArray(bundle.verifiedCollectionPaymentIds)
  )
    return fail();
  const receivables = indexed(bundle.collectionReceivables);
  const targetIds = new Set(targets.map(([key]) => key));
  const verified = new Set(bundle.verifiedCollectionPaymentIds.map(id));
  if (verified.size !== targetIds.size || [...targetIds].some((key) => !verified.has(key)))
    return fail();
  const fullLedger = decodeCimacLedger({
    kind: "ledger",
    total: bundle.collectionLedger.length,
    rows: bundle.collectionLedger,
  });
  if (fullLedger.some((row) => !targetIds.has(String(row.payment_id)))) return fail();
  const usedReceivables = new Set<string>();
  const usedAllocationIds = new Set<string>();
  for (const allocation of bundle.allocations) {
    if (!targetIds.has(id(allocation.payment_id))) return fail();
  }
  for (const [key, payment] of targets) {
    const customerId = id(payment.customer_id);
    if (
      payment.unit_id !== null ||
      payment.source_id !== customerId ||
      payment.currency !== "XOF" ||
      payment.native_settlement === true ||
      amount(payment.exchange_rate_to_xof) !== 1
    )
      return fail();
    const linked = fullLedger.filter((row) => row.payment_id === key);
    const allocations = bundle.allocations.filter((row) => row.payment_id === key);
    if (!allocations.length || allocations.length > 100) return fail();
    const allocationTargets = new Map<string, string[]>(),
      ledgerCounts = new Map<string, number>();
    let total = BigInt(0),
      fee = BigInt(0);
    const feeIds: string[] = [];
    for (const allocation of allocations) {
      const receivableId = id(allocation.receivable_id),
        allocationId = `${key}:${receivableId}`;
      if (usedAllocationIds.has(allocationId)) return fail();
      usedAllocationIds.add(allocationId);
      usedReceivables.add(receivableId);
      const row = receivables.get(receivableId);
      if (
        !row ||
        row.customer_id !== customerId ||
        row.source_type !== "lease_contract" ||
        !["lease_rent", "property_fee"].includes(String(row.category)) ||
        row.currency !== "XOF"
      )
        return fail();
      id(row.source_id);
      const unitId = id(row.unit_id),
        buildingId = id(row.building_id);
      if (
        !units.has(unitId) ||
        units.get(unitId)!.building_id !== buildingId ||
        buildings.get(buildingId)?.project_id !== CIMAC_PROJECT_ID
      )
        return fail();
      const piece = nativeMinor(allocation.amount_xof);
      if (piece <= BigInt(0) || piece % BigInt(100) !== BigInt(0)) return fail();
      total += piece;
      const group = `${unitId}:${buildingId}:${row.category}:${piece}`;
      allocationTargets.set(group, [...(allocationTargets.get(group) ?? []), receivableId]);
    }
    for (const row of linked) {
      if (
        row.direction !== "income" ||
        row.entry_date !== payment.payment_date ||
        row.currency !== "XOF" ||
        row.amount_native !== null ||
        !["lease_rent", "property_fee"].includes(String(row.category))
      )
        return fail();
      const group = `${id(row.unit_id)}:${id(row.building_id)}:${row.category}:${nativeMinor(row.amount_xof)}`;
      ledgerCounts.set(group, (ledgerCounts.get(group) ?? 0) + 1);
    }
    if (
      linked.length !== allocations.length ||
      total !== nativeMinor(payment.amount) ||
      allocationTargets.size !== ledgerCounts.size ||
      [...allocationTargets].some(([group, values]) => ledgerCounts.get(group) !== values.length)
    )
      return fail();
    const fullById = new Map(linked.map((row) => [row.id, row]));
    const selectedGroups = new Map<string, number>();
    for (const row of references.get(key)!) {
      const original = fullById.get(row.id);
      if (
        !original ||
        ["unit_id", "building_id", "category", "entry_date", "direction", "currency"].some(
          (field) => original[field] !== row[field],
        ) ||
        nativeMinor(original.amount_xof) !== nativeMinor(row.amount_xof)
      )
        return fail();
      if (row.category !== "property_fee") continue;
      const piece = nativeMinor(row.amount_xof),
        group = `${row.unit_id}:${row.building_id}:${row.category}:${piece}`;
      fee += piece;
      selectedGroups.set(group, (selectedGroups.get(group) ?? 0) + 1);
    }
    let ambiguous = false;
    for (const [group, count] of selectedGroups) {
      const ids = allocationTargets.get(group)!;
      if (count === ids.length) feeIds.push(...ids);
      else if (count < ids.length) ambiguous = true;
      else return fail();
    }
    proof.set(key, {
      amountXof: String(fee / BigInt(100)),
      receivableIds: feeIds,
      hasFee: fee > BigInt(0),
      ambiguous,
    });
  }
  if (usedReceivables.size !== receivables.size) return fail();
  return proof;
}

export function cimacExportCsv(bundle: CimacExportBundle, query: CimacExportQuery): string {
  const checkedQuery = parseCimacExportQuery(
    new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined)),
  );
  if (
    typeof bundle.readAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(bundle.readAt) ||
    !Number.isFinite(new Date(bundle.readAt).getTime())
  )
    return fail();
  const buildings = indexed(bundle.buildings);
  for (const building of buildings.values()) {
    if (id(building.project_id) !== CIMAC_PROJECT_ID) return fail();
  }
  const units = indexed(bundle.units);
  for (const unit of units.values()) {
    const buildingId = id(unit.building_id);
    if (!buildings.has(buildingId)) return fail();
    unit.building_id = buildingId;
    unit.unit_no = text(unit.unit_no);
  }
  if (checkedQuery.view === "property-fee-receivables")
    return receivablesCsv(bundle, checkedQuery, buildings, units);
  const ledger = decodeCimacLedger({
    kind: "ledger",
    total: bundle.ledger.length,
    rows: bundle.ledger,
  });
  const payments = indexed(bundle.payments);
  const references = new Map<string, Row[]>();
  for (const row of ledger) {
    if (checkedQuery.dateFrom && String(row.entry_date) < checkedQuery.dateFrom) return fail();
    if (checkedQuery.dateTo && String(row.entry_date) > checkedQuery.dateTo) return fail();
    if (row.building_id !== null && !buildings.has(String(row.building_id))) return fail();
    if (row.unit_id !== null && !units.has(String(row.unit_id))) return fail();
    // A completely unscoped ledger row could not have come from the CIMAC RPC.
    if (row.building_id === null && row.unit_id === null) return fail();
    if (row.payment_id !== null) {
      const key = String(row.payment_id);
      if (!payments.has(key)) return fail();
      const list = references.get(key) ?? [];
      list.push(row);
      references.set(key, list);
    }
  }
  for (const [key, payment] of payments) {
    if (!references.has(key)) return fail();
    const unitId = nullableId(payment, "unit_id");
    if (unitId !== null && !units.has(unitId)) return fail();
    payment.unit_id = unitId;
    payment.source_id = nullableId(payment, "source_id");
    payment.source_type = text(payment.source_type);
    payment.amount = amount(payment.amount);
    payment.currency = text(payment.currency);
    if (own(payment, "native_settlement") && typeof payment.native_settlement !== "boolean")
      return fail();
    if (payment.native_settlement === true) {
      if (
        !["CNY", "USD"].includes(String(payment.currency)) ||
        payment.exchange_rate_to_xof !== null ||
        nativeMinor(payment.amount) <= BigInt(0) ||
        !["lease_rent", "lease_deposit", "lease_deposit_refund"].includes(
          String(payment.source_type),
        )
      )
        return fail();
      const linked = references.get(key)!;
      if (
        linked.some(
          (row) => !nativeLedger(row) || row.currency !== payment.currency || row.amount_xof !== 0,
        ) ||
        linked.reduce((sum, row) => sum + nativeMinor(row.amount_native), BigInt(0)) !==
          nativeMinor(payment.amount)
      )
        return fail();
    } else {
      payment.exchange_rate_to_xof = amount(payment.exchange_rate_to_xof);
      if (references.get(key)!.some(nativeLedger)) return fail();
    }
    if (!isDate(payment.payment_date)) return fail();
    if (payment.reversal_of_payment_id !== undefined && payment.reversal_of_payment_id !== null)
      payment.reversal_of_payment_id = id(payment.reversal_of_payment_id);
    for (const row of references.get(key)!) {
      if (row.unit_id !== null && unitId !== null && row.unit_id !== unitId) return fail();
    }
  }

  const zh = checkedQuery.locale === "zh";
  const at = (a: string, b: string) => (zh ? a : b);
  const special = checkedQuery.view !== "ledger" && checkedQuery.view !== "payments";
  const policyNotice =
    checkedQuery.view === "property-fee-payments"
      ? cimacShopPropertyFeeNotice(checkedQuery.locale)
      : "";
  if (special) for (const [key, payment] of payments) specialPayment(payment, references.get(key)!);
  const propertyProof =
    checkedQuery.view === "property-fee-payments"
      ? customerPropertyFeeProof(bundle, payments, references, units, buildings)
      : new Map<
          string,
          { amountXof: string; receivableIds: string[]; hasFee: boolean; ambiguous: boolean }
        >();
  const location = (row: Row) => {
    const payment = row.payment_id === null ? undefined : payments.get(String(row.payment_id));
    const effectiveUnit = row.unit_id ?? payment?.unit_id ?? null;
    const unit = effectiveUnit === null ? undefined : units.get(String(effectiveUnit));
    const effectiveBuilding = row.building_id ?? unit?.building_id;
    const building = buildings.get(String(effectiveBuilding));
    if (!building) return fail();
    const mismatch = !!(unit && unit.building_id !== effectiveBuilding);
    return {
      buildingId: building.id,
      buildingName: optionalText(building.display_name) || optionalText(building.code),
      unitId: effectiveUnit,
      unitNo: unit?.unit_no ?? null,
      unitSource: row.unit_id !== null ? "ledger.unit_id" : unit ? "payment.unit_id" : "",
      note: mismatch
        ? at(
            "铺位楼栋与分录不同，以分录登记楼栋为准",
            "Bâtiment du local différent ; bâtiment de l’écriture prioritaire",
          )
        : "",
    };
  };
  const unique = (values: unknown[]) =>
    [...new Set(values.filter((value) => value !== null && value !== ""))].join(" / ");
  let headers: string[];
  let rows: unknown[][];
  if (checkedQuery.view === "ledger") {
    headers = zh
      ? [
          "读取时间",
          "导出范围",
          "分录 ID",
          "登记日期",
          "项目 ID",
          "归属楼栋 ID（分录优先）",
          "楼栋",
          "原分录铺位 ID",
          "展示铺位 ID",
          "铺号",
          "铺位关联来源",
          "方向",
          "业务分类",
          "分录登记金额 XOF",
          "分录登记金额 CNY",
          "关联收款 ID",
          "内部凭证号",
          "外部收据号",
          "来源类型",
          "来源 ID",
          "关联分录数",
          "冲销原收款 ID",
          "关联说明",
          "分录币种（仅已登记）",
          "未折算原币金额",
          "折算状态",
        ]
      : [
          "Lecture à",
          "Périmètre",
          "ID de l’écriture",
          "Date d’écriture",
          "ID du projet",
          "ID du bâtiment retenu (écriture prioritaire)",
          "Bâtiment",
          "ID du local dans l’écriture",
          "ID du local affiché",
          "Numéro du local",
          "Source du lien du local",
          "Sens",
          "Catégorie",
          "Montant enregistré XOF",
          "Montant enregistré CNY",
          "ID du paiement lié",
          "Référence interne",
          "Reçu externe",
          "Type de source",
          "ID de la source",
          "Nombre d’écritures liées",
          "ID du paiement annulé",
          "Remarque du lien",
          "Devise de l’écriture enregistrée",
          "Montant original non converti",
          "Statut de conversion",
        ];
    rows = ledger.map((row) => {
      const loc = location(row);
      const payment = row.payment_id === null ? undefined : payments.get(String(row.payment_id));
      return [
        bundle.readAt,
        at("CIMAC已授权分录", "Écritures CIMAC autorisées"),
        row.id,
        row.entry_date,
        CIMAC_PROJECT_ID,
        loc.buildingId,
        loc.buildingName,
        row.unit_id,
        loc.unitId,
        loc.unitNo,
        loc.unitSource,
        row.direction,
        row.category,
        nativeLedger(row) ? null : row.amount_xof,
        row.currency === "CNY" && nativeLedger(row) ? row.amount_native : row.amount_cny,
        row.payment_id,
        optionalText(payment?.receipt_no),
        optionalText(payment?.external_receipt_no),
        payment?.source_type ?? null,
        payment?.source_id ?? null,
        row.payment_id === null ? 0 : references.get(String(row.payment_id))!.length,
        payment?.reversal_of_payment_id ?? null,
        loc.note ||
          (!payment
            ? at("未关联收款记录，不代表漏账", "Aucun paiement lié ; ne signifie pas une omission")
            : ""),
        row.currency ?? null,
        nativeLedger(row) ? row.amount_native : null,
        nativeLedger(row)
          ? at(
              "原币登记，未折算；不计入XOF合计",
              "Devise originale non convertie ; exclue des totaux XOF",
            )
          : "",
      ];
    });
  } else {
    headers = zh
      ? [
          "读取时间",
          "导出范围（非全库全部收款）",
          "项目 ID",
          "收款 ID",
          "收款日期",
          "收款原铺位 ID",
          "关联铺位 ID",
          "铺号",
          "关联楼栋 ID",
          "楼栋",
          "来源类型",
          "来源 ID",
          "内部凭证号",
          "外部收据号",
          "原币金额",
          "原币币种",
          "登记汇率至 XOF",
          "关联分录方向",
          "关联分录 ID",
          "关联分录数",
          "冲销原收款 ID",
          "关联说明",
        ]
      : [
          "Lecture à",
          "Périmètre (pas tous les paiements de la base)",
          "ID du projet",
          "ID du paiement",
          "Date du paiement",
          "ID du local du paiement",
          "ID des locaux liés",
          "Numéros des locaux",
          "ID des bâtiments liés",
          "Bâtiments",
          "Type de source",
          "ID de la source",
          "Référence interne",
          "Reçu externe",
          "Montant en devise originale",
          "Devise originale",
          "Taux enregistré vers XOF",
          "Sens des écritures liées",
          "ID des écritures liées",
          "Nombre d’écritures liées",
          "ID du paiement annulé",
          "Remarque du lien",
        ];
    if (special) {
      const scope =
        checkedQuery.view === "deposits"
          ? at(
              "范围：押金收退扣，非余额或可退额；未关联或未核实分录另见分录明细",
              "Périmètre : dépôts reçus, remboursés et retenus, pas un solde ni un montant remboursable ; écritures sans lien ou non vérifiées à consulter séparément",
            )
          : checkedQuery.view === "refunds"
            ? at(
                "范围：仅押金退款，扣除非退款；未关联或未核实分录另见分录明细",
                "Périmètre : remboursements de dépôt uniquement, retenues exclues ; écritures sans lien ou non vérifiées à consulter séparément",
              )
            : at(
                "范围：仅关联物业费凭证；未关联或未核实分录另见分录明细",
                "Périmètre : paiements liés de charges uniquement ; écritures sans lien ou non vérifiées à consulter séparément",
              );
      headers[1] = scope + (policyNotice ? ` ${policyNotice}` : "");
      headers.push(
        at(
          "专项业务说明（非余额，来源ID未核验合同）",
          "Nature de l’opération (pas un solde, contrat source non vérifié)",
        ),
        at("登记付款方式", "Mode de paiement enregistré"),
      );
    }
    if (checkedQuery.view === "property-fee-payments") {
      headers.push(
        at(
          "客户总账整笔实收原币金额（仅参考，不作为物业费合计）",
          "Encaissement total du compte client (référence, pas un total de charges)",
        ),
        at("物业费关联分录金额 XOF", "Montant des écritures de charges XOF"),
        at(
          "其中已验证核销金额 XOF（历史未知留空）",
          "Dont imputation vérifiée XOF (historique inconnu : vide)",
        ),
        at("已验证物业费应收 ID", "ID des créances de charges vérifiées"),
      );
    }
    headers.push(at("折算状态", "Statut de conversion"));
    rows = [...references]
      .filter(([key]) => {
        const type = payments.get(key)!.source_type;
        return (
          !special ||
          (checkedQuery.view === "deposits" &&
            ["lease_deposit", "lease_deposit_refund", "lease_deposit_deduction"].includes(
              String(type),
            )) ||
          (checkedQuery.view === "refunds" && type === "lease_deposit_refund") ||
          (checkedQuery.view === "property-fee-payments" &&
            (type === "property_fee" ||
              (type === "cimac_customer_collection" && propertyProof.get(key)?.hasFee)))
        );
      })
      .map(([key, linked]) => {
        const payment = payments.get(key)!;
        if (
          checkedQuery.view === "property-fee-payments" &&
          payment.source_type === "cimac_customer_collection"
        )
          linked = linked.filter((row) => row.category === "property_fee");
        const locations = linked.map(location);
        const values = [
          bundle.readAt,
          at(
            "仅CIMAC授权分录关联凭证；非全库全部收款",
            "Seulement les paiements liés aux écritures CIMAC autorisées ; pas tous les paiements de la base",
          ) + (policyNotice ? ` ${policyNotice}` : ""),
          CIMAC_PROJECT_ID,
          payment.id,
          payment.payment_date,
          payment.unit_id,
          unique(locations.map((loc) => loc.unitId)),
          unique(locations.map((loc) => loc.unitNo)),
          unique(locations.map((loc) => loc.buildingId)),
          unique(locations.map((loc) => loc.buildingName)),
          payment.source_type,
          payment.source_id,
          optionalText(payment.receipt_no),
          optionalText(payment.external_receipt_no),
          checkedQuery.view === "property-fee-payments" &&
          payment.source_type === "cimac_customer_collection"
            ? null
            : payment.amount,
          payment.currency,
          payment.exchange_rate_to_xof,
          unique(linked.map((row) => row.direction)),
          unique(linked.map((row) => row.id)),
          linked.length,
          payment.reversal_of_payment_id ?? null,
          unique([
            ...locations.map((loc) => loc.note),
            propertyProof.get(key)?.ambiguous
              ? at(
                  "当前范围只含同组部分分录，具体应收无法唯一对应；不猜账期或应收编号",
                  "Périmètre partiel d’un groupe identique : créance précise non attribuable sans ambiguïté ; aucune période ni référence déduite",
                )
              : "",
            linked.length > 1
              ? at(
                  "同一凭证关联多条分录；原币仅列一次，不自动分摊",
                  "Plusieurs écritures pour ce paiement ; devise originale indiquée une fois, sans ventilation automatique",
                )
              : "",
          ]),
        ];
        if (special) {
          const operation =
            payment.reversal_of_payment_id !== null && payment.reversal_of_payment_id !== undefined
              ? at(
                  "冲销关联记录，非新收款或新退款；仅保留原记录引用，不推导原收据",
                  "Écriture liée à une annulation, pas un nouvel encaissement ou remboursement ; référence conservée sans déduction du reçu d’origine",
                )
              : payment.source_type === "lease_deposit_deduction"
                ? at(
                    "押金扣除／抵扣，非现金退款",
                    "Retenue / compensation du dépôt, pas un remboursement en espèces",
                  )
                : payment.source_type === "lease_deposit_refund"
                  ? at(
                      "登记押金退款，不推导对应哪张原押金收据",
                      "Remboursement de dépôt enregistré, sans déduire le reçu d’origine",
                    )
                  : payment.source_type === "lease_deposit"
                    ? at(
                        "登记押金收入，不代表当前余额或可退额",
                        "Dépôt reçu enregistré, pas un solde actuel ni un montant remboursable",
                      )
                    : payment.source_type === "cimac_customer_collection"
                      ? at(
                          "客户总账混合实收，物业费仅按明确核销分配列示；整笔支付金额为参考，不重复计入物业费",
                          "Encaissement multi-contrats : charges selon les affectations explicites uniquement ; montant total du paiement fourni en référence, sans double comptage",
                        )
                      : at(
                          "登记物业费收款，不推导服务账期或已核销金额",
                          "Paiement de charges enregistré, sans déduction de période ni montant imputé",
                        );
          const methods: Record<string, string> = zh
            ? {
                cash: "现金",
                check: "支票",
                bank_transfer: "银行转账",
                offset: "非现金／抵扣",
                other: "其他",
              }
            : {
                cash: "Espèces",
                check: "Chèque",
                bank_transfer: "Virement",
                offset: "Non monétaire / compensation",
                other: "Autre",
              };
          values.push(
            operation,
            payment.payment_method === null
              ? at("未登记", "Non enregistré")
              : methods[String(payment.payment_method)],
          );
        }
        if (checkedQuery.view === "property-fee-payments") {
          values.push(
            payment.source_type === "cimac_customer_collection" ? payment.amount : null,
            linked.reduce((sum, row) => sum + amount(row.amount_xof), 0),
            propertyProof.get(key)?.amountXof ?? null,
            propertyProof.get(key)?.receivableIds.join(" / ") ?? null,
          );
        }
        values.push(
          payment.native_settlement === true
            ? at(
                "原币登记，未折算；不计入XOF合计",
                "Devise originale non convertie ; exclue des totaux XOF",
              )
            : "",
        );
        return values;
      });
  }
  return csv(headers, rows);
}
