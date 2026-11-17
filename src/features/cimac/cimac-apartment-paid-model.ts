import {
  apartmentObject,
  apartmentTimestamp,
  apartmentUuid,
} from "./cimac-apartment-reservation-model";

export type ApartmentPaymentMethod = "cash" | "bank_transfer" | "check" | "other";
export interface ApartmentPaidRoomInput {
  unitId: string;
  expectedUnitUpdatedAt: string;
  expectedHoldId: null;
  expectedHoldUpdatedAt: null;
  monthlyRentXof: number;
  depositMonths: 2;
  rentPrepayMonths: 3;
  depositAmountXof: number;
  rentAmountXof: number;
}
export interface ApartmentPaidRequest {
  requestId: string;
  originalInstruction: string;
  customerName: string;
  agreementStartDate: string;
  agreementEndDate: string;
  paidPeriodStart: string;
  paidPeriodEnd: string;
  paymentDate: string;
  paymentMethod: ApartmentPaymentMethod;
  currency: "XOF";
  sourceRef: string;
  externalReceiptNo?: string;
  reason: string;
  totalAmountXof: number;
  rooms: ApartmentPaidRoomInput[];
}
export interface ApartmentPaidReservation {
  receiptId: string;
  reservationId: string;
  customerName: string;
  agreementStartDate: string;
  agreementEndDate: string;
  paidPeriodStart: string;
  paidPeriodEnd: string;
  paymentDate: string;
  paymentMethod: ApartmentPaymentMethod;
  monthlyRentXof: number;
  depositAmountXof: number;
  rentAmountXof: number;
  totalAmountXof: number;
  sourceRef: string;
  externalReceiptNo: string | null;
}
export class ApartmentPaidError extends Error {
  constructor(
    message = "apartment_paid_unverified",
    public status = 503,
  ) {
    super(message);
  }
}
export const paidFail = (): never => {
  throw new ApartmentPaidError();
};
export const paidMoney = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 999999999999;
export function paidDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function paidQuarterEnd(start: string) {
  if (!paidDate(start) || !start.endsWith("-01")) return "";
  const date = new Date(`${start}T00:00:00Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 3, 0))
    .toISOString()
    .slice(0, 10);
}
export function paidText(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= max &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  );
}
export function paidMethod(value: unknown): value is ApartmentPaymentMethod {
  return typeof value === "string" && ["cash", "bank_transfer", "check", "other"].includes(value);
}
function keys(row: Record<string, unknown>, allowed: string[], optional: string[] = []) {
  return (
    Object.keys(row).every((k) => allowed.includes(k) || optional.includes(k)) &&
    allowed.every((k) => Object.hasOwn(row, k))
  );
}
export function parseApartmentPaidRequest(raw: unknown): ApartmentPaidRequest {
  const invalid = (): never => {
    throw new ApartmentPaidError("apartment_paid_input", 400);
  };
  if (
    !apartmentObject(raw) ||
    !keys(
      raw,
      [
        "requestId",
        "originalInstruction",
        "customerName",
        "agreementStartDate",
        "agreementEndDate",
        "paidPeriodStart",
        "paidPeriodEnd",
        "paymentDate",
        "paymentMethod",
        "currency",
        "sourceRef",
        "reason",
        "totalAmountXof",
        "rooms",
      ],
      ["externalReceiptNo"],
    ) ||
    !apartmentUuid(raw.requestId) ||
    !paidText(raw.originalInstruction, 4000) ||
    !paidText(raw.customerName, 200) ||
    /[\r\n\t]/.test(raw.customerName) ||
    !paidText(raw.sourceRef, 500) ||
    !paidText(raw.reason, 2000) ||
    (Object.hasOwn(raw, "externalReceiptNo") && !paidText(raw.externalReceiptNo, 100)) ||
    !paidDate(raw.agreementStartDate) ||
    !paidDate(raw.agreementEndDate) ||
    !paidDate(raw.paidPeriodStart) ||
    !paidDate(raw.paidPeriodEnd) ||
    !paidDate(raw.paymentDate) ||
    !paidMethod(raw.paymentMethod) ||
    raw.currency !== "XOF" ||
    !paidMoney(raw.totalAmountXof) ||
    raw.totalAmountXof <= 0 ||
    !Array.isArray(raw.rooms) ||
    raw.rooms.length < 1 ||
    raw.rooms.length > 64
  )
    return invalid();
  if (
    raw.agreementStartDate !== raw.paidPeriodStart ||
    raw.paidPeriodEnd !== paidQuarterEnd(raw.paidPeriodStart) ||
    raw.agreementEndDate < raw.paidPeriodEnd ||
    raw.paymentDate > raw.agreementStartDate ||
    new Date(`${raw.agreementEndDate}T00:00:00Z`).getUTCDate() !==
      new Date(
        Date.UTC(
          Number(raw.agreementEndDate.slice(0, 4)),
          Number(raw.agreementEndDate.slice(5, 7)),
          0,
        ),
      ).getUTCDate()
  )
    return invalid();
  const seen = new Set<string>();
  const rooms = raw.rooms.map((r): ApartmentPaidRoomInput => {
    if (
      !apartmentObject(r) ||
      !keys(r, [
        "unitId",
        "expectedUnitUpdatedAt",
        "expectedHoldId",
        "expectedHoldUpdatedAt",
        "monthlyRentXof",
        "depositMonths",
        "rentPrepayMonths",
        "depositAmountXof",
        "rentAmountXof",
      ]) ||
      !apartmentUuid(r.unitId) ||
      seen.has(r.unitId.toLowerCase()) ||
      !apartmentTimestamp(r.expectedUnitUpdatedAt) ||
      r.expectedHoldId !== null ||
      r.expectedHoldUpdatedAt !== null ||
      ![350000, 600000].includes(r.monthlyRentXof as number) ||
      r.depositMonths !== 2 ||
      r.rentPrepayMonths !== 3 ||
      r.depositAmountXof !== Number(r.monthlyRentXof) * 2 ||
      r.rentAmountXof !== Number(r.monthlyRentXof) * 3
    )
      return invalid();
    seen.add(r.unitId.toLowerCase());
    return {
      unitId: r.unitId.toLowerCase(),
      expectedUnitUpdatedAt: r.expectedUnitUpdatedAt,
      expectedHoldId: null,
      expectedHoldUpdatedAt: null,
      monthlyRentXof: r.monthlyRentXof as number,
      depositMonths: 2,
      rentPrepayMonths: 3,
      depositAmountXof: r.depositAmountXof as number,
      rentAmountXof: r.rentAmountXof as number,
    };
  });
  if (
    rooms.reduce((sum, r) => sum + r.depositAmountXof + r.rentAmountXof, 0) !== raw.totalAmountXof
  )
    return invalid();
  return {
    ...raw,
    requestId: raw.requestId.toLowerCase(),
    rooms,
  } as unknown as ApartmentPaidRequest;
}

/** Object-key order does not affect a request's identity; array order remains significant. */
export function paidEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => paidEqual(v, b[i]));
  if (!apartmentObject(a) || !apartmentObject(b)) return false;
  const ak = Object.keys(a).sort(),
    bk = Object.keys(b).sort();
  return paidEqual(ak, bk) && ak.every((k) => paidEqual(a[k], b[k]));
}

type Row = Record<string, unknown>;
// PostgreSQL UUID identifiers include deterministic MD5 identifiers, not only RFC version 1–5 IDs.
export const paidRowUuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function rows(raw: unknown, max = 128): Row[] {
  if (!Array.isArray(raw) || raw.length > max || raw.some((r) => !apartmentObject(r)))
    return paidFail();
  return raw as Row[];
}
function identity(value: unknown): string {
  if (!paidRowUuid(value)) return paidFail();
  return value;
}
function uniqueIds(values: unknown, expected: number): string[] {
  if (
    !Array.isArray(values) ||
    values.length !== expected ||
    values.some((v) => !paidRowUuid(v)) ||
    new Set(values).size !== values.length
  )
    return paidFail();
  return values as string[];
}
function indexed(values: Row[], field = "id") {
  const map = new Map<string, Row>();
  for (const row of values) {
    const id = identity(row[field]);
    if (map.has(id)) return paidFail();
    map.set(id, row);
  }
  return map;
}
/** Read models bind both receipt and every split to the exact B17 catalog; unreadable is never empty. */
export function readApartmentPaidRows(
  raw: unknown,
  projectId: string,
  buildingId: string,
  unitNos: Map<string, string>,
): Map<string, ApartmentPaidReservation> {
  if (!apartmentObject(raw) || raw.buildingId !== buildingId) return paidFail();
  const receipts = indexed(rows(raw.receipts, 64)),
    children = rows(raw.reservations, 64),
    result = new Map<string, ApartmentPaidReservation>();
  const sums = new Map<string, number>();
  for (const [id, r] of receipts) {
    if (
      r.project_id !== projectId ||
      r.building_id !== buildingId ||
      !apartmentUuid(r.request_id) ||
      !paidRowUuid(r.customer_id) ||
      !apartmentUuid(r.recorded_by) ||
      !paidText(r.customer_name, 200) ||
      !paidDate(r.payment_date) ||
      !paidMethod(r.payment_method) ||
      r.currency !== "XOF" ||
      !paidMoney(r.total_amount_xof) ||
      r.total_amount_xof <= 0 ||
      !paidText(r.source_ref, 500) ||
      !(r.external_receipt_no === null || paidText(r.external_receipt_no, 100)) ||
      !paidText(r.reason, 2000) ||
      !apartmentTimestamp(r.recorded_at)
    )
      return paidFail();
    sums.set(id, 0);
  }
  const childIds = new Set<string>();
  for (const r of children) {
    const unitId = identity(r.unit_id),
      receiptId = identity(r.receipt_id),
      parent = receipts.get(receiptId);
    if (!parent || !paidDate(parent.payment_date)) return paidFail();
    if (
      !parent ||
      !unitNos.has(unitId) ||
      result.has(unitId) ||
      childIds.has(identity(r.id)) ||
      r.building_id !== buildingId ||
      r.customer_id !== parent.customer_id ||
      r.recorded_by !== parent.recorded_by ||
      !apartmentTimestamp(r.recorded_at) ||
      r.status !== "paid_reserved" ||
      !paidDate(r.agreement_start_date) ||
      !paidDate(r.agreement_end_date) ||
      !paidDate(r.paid_period_start) ||
      !paidDate(r.paid_period_end) ||
      r.agreement_start_date !== r.paid_period_start ||
      r.paid_period_end !== paidQuarterEnd(r.paid_period_start) ||
      r.agreement_end_date < r.paid_period_end ||
      parent.payment_date > r.agreement_start_date ||
      ![350000, 600000].includes(r.monthly_rent_xof as number) ||
      r.deposit_months !== 2 ||
      r.rent_prepay_months !== 3 ||
      r.deposit_amount_xof !== Number(r.monthly_rent_xof) * 2 ||
      r.rent_amount_xof !== Number(r.monthly_rent_xof) * 3 ||
      !paidRowUuid(r.deposit_payment_id) ||
      !paidRowUuid(r.rent_payment_id) ||
      r.deposit_payment_id === r.rent_payment_id
    )
      return paidFail();
    childIds.add(r.id as string);
    const total = Number(r.deposit_amount_xof) + Number(r.rent_amount_xof);
    sums.set(receiptId, sums.get(receiptId)! + total);
    result.set(unitId, {
      receiptId,
      reservationId: r.id as string,
      customerName: parent.customer_name as string,
      agreementStartDate: r.agreement_start_date,
      agreementEndDate: r.agreement_end_date,
      paidPeriodStart: r.paid_period_start,
      paidPeriodEnd: r.paid_period_end,
      paymentDate: parent.payment_date as string,
      paymentMethod: parent.payment_method as ApartmentPaymentMethod,
      monthlyRentXof: r.monthly_rent_xof as number,
      depositAmountXof: r.deposit_amount_xof as number,
      rentAmountXof: r.rent_amount_xof as number,
      totalAmountXof: total,
      sourceRef: parent.source_ref as string,
      externalReceiptNo: parent.external_receipt_no as string | null,
    });
  }
  for (const [id, r] of receipts) if (sums.get(id) !== r.total_amount_xof) return paidFail();
  return result;
}
function numericEqual(value: unknown, n: number) {
  return (
    (typeof value === "number" || typeof value === "string") &&
    /^\d+(?:\.\d+)?$/.test(String(value)) &&
    Number(value) === n
  );
}
/** Reconcile raw financial rows, catalog scope and request echo; never trust a returned verified flag. */
export function verifyApartmentPaidResult(
  raw: unknown,
  input: ApartmentPaidRequest,
  actorId: string,
  projectId: string,
  buildingId: string,
  unitNos: Map<string, string>,
) {
  if (
    !apartmentObject(raw) ||
    raw.success !== true ||
    typeof raw.idempotent !== "boolean" ||
    !apartmentObject(raw.data)
  )
    return paidFail();
  const d = raw.data;
  if (
    d.requestId !== input.requestId ||
    d.actorId !== actorId ||
    d.projectId !== projectId ||
    d.buildingId !== buildingId ||
    !paidRowUuid(d.customerId) ||
    !paidRowUuid(d.receiptId) ||
    !paidEqual(d.request, input) ||
    !apartmentObject(d.verification)
  )
    return paidFail();
  const v = d.verification,
    n = input.rooms.length,
    reservationIds = uniqueIds(d.reservationIds, n),
    paymentIds = uniqueIds(d.paymentIds, n * 2),
    ledgerIds = uniqueIds(d.ledgerIds, n * 2);
  if (
    !apartmentObject(v.receipt) ||
    v.receipt.id !== d.receiptId ||
    v.receipt.request_id !== input.requestId ||
    v.receipt.customer_id !== d.customerId ||
    v.receipt.recorded_by !== actorId ||
    v.receipt.customer_name !== input.customerName ||
    v.receipt.payment_date !== input.paymentDate ||
    v.receipt.payment_method !== input.paymentMethod ||
    v.receipt.total_amount_xof !== input.totalAmountXof ||
    v.receipt.source_ref !== input.sourceRef ||
    v.receipt.external_receipt_no !== (input.externalReceiptNo ?? null) ||
    v.receipt.reason !== input.reason ||
    !apartmentObject(v.customer) ||
    v.customer.id !== d.customerId ||
    v.customer.name !== input.customerName
  )
    return paidFail();
  const reservations = rows(v.reservations, 64),
    paid = readApartmentPaidRows(
      { buildingId, receipts: [v.receipt], reservations },
      projectId,
      buildingId,
      unitNos,
    );
  const payments = indexed(rows(v.payments)),
    ledger = indexed(rows(v.ledger)),
    units = indexed(rows(v.units, 64)),
    profiles = indexed(rows(v.profiles, 64), "unit_id");
  if (
    paid.size !== n ||
    payments.size !== n * 2 ||
    ledger.size !== n * 2 ||
    units.size !== n ||
    profiles.size !== n
  )
    return paidFail();
  for (let index = 0; index < n; index++) {
    const expected = input.rooms[index],
      r = reservations.find((r) => r.unit_id === expected.unitId),
      unit = units.get(expected.unitId),
      profile = profiles.get(expected.unitId),
      p = paid.get(expected.unitId);
    if (
      !r ||
      !unit ||
      !profile ||
      !p ||
      r.id !== reservationIds[index] ||
      r.customer_id !== d.customerId ||
      r.agreement_start_date !== input.agreementStartDate ||
      r.agreement_end_date !== input.agreementEndDate ||
      r.paid_period_start !== input.paidPeriodStart ||
      r.paid_period_end !== input.paidPeriodEnd ||
      r.monthly_rent_xof !== expected.monthlyRentXof ||
      unit.building_id !== buildingId ||
      unit.code !== `CIMAC-B17-${unitNos.get(expected.unitId)}` ||
      unit.kind !== "apartment" ||
      unit.asset_subtype !== "apartment" ||
      unit.updated_at !== expected.expectedUnitUpdatedAt ||
      unit.construction_status !== "operational" ||
      profile.building_id !== buildingId ||
      Number(profile.monthly_rent_xof) !== expected.monthlyRentXof
    )
      return paidFail();
    for (const [kind, offset] of [
      ["deposit", 0],
      ["rent", 1],
    ] as const) {
      const payment = payments.get(paymentIds[index * 2 + offset]),
        entry = ledger.get(ledgerIds[index * 2 + offset]),
        value = kind === "deposit" ? expected.depositAmountXof : expected.rentAmountXof;
      const reference = new RegExp(
        `^WB-CIMAC-B17-L-${unitNos.get(expected.unitId)}-${input.paymentDate.replaceAll("-", "")}-${kind === "deposit" ? "DEP" : "RENT"}-\\d{2,}$`,
      );
      if (
        !payment ||
        !entry ||
        r[`${kind}_payment_id`] !== payment.id ||
        payment.customer_id !== d.customerId ||
        payment.unit_id !== expected.unitId ||
        payment.source_id !== r.id ||
        payment.source_type !== `cimac_apartment_${kind}` ||
        payment.request_kind !== "cimac_apartment_paid" ||
        !paidRowUuid(payment.request_id) ||
        (index === 0 && kind === "deposit" && payment.request_id !== input.requestId) ||
        payment.payment_date !== input.paymentDate ||
        payment.payment_method !== input.paymentMethod ||
        payment.currency !== "XOF" ||
        !numericEqual(payment.amount, value) ||
        payment.native_settlement !== false ||
        !numericEqual(payment.exchange_rate_to_xof, 1) ||
        payment.external_receipt_no !== (input.externalReceiptNo ?? null) ||
        payment.recorded_by !== actorId ||
        typeof payment.receipt_no !== "string" ||
        !reference.test(payment.receipt_no) ||
        entry.payment_id !== payment.id ||
        entry.building_id !== buildingId ||
        entry.unit_id !== expected.unitId ||
        entry.entry_date !== input.paymentDate ||
        entry.direction !== (kind === "deposit" ? "liability_in" : "income") ||
        entry.category !== (kind === "deposit" ? "lease_deposit" : "lease_rent") ||
        entry.currency !== "XOF" ||
        entry.amount_native !== null ||
        entry.amount_cny !== null ||
        !numericEqual(entry.amount_xof, value)
      )
        return paidFail();
    }
  }
  const targetIds = new Set(input.rooms.map((r) => r.unitId));
  for (const r of rows(v.unpaidReservations, 10000))
    if (!targetIds.has(String(r.unit_id)) || r.status === "reserved") return paidFail();
  for (const key of ["leases", "dailyBookings", "sales"]) {
    for (const r of rows(v[key], 10000)) {
      if (
        !targetIds.has(String(r.unit_id)) ||
        (key === "leases" && ["draft", "active"].includes(String(r.status))) ||
        (key === "dailyBookings" && ["confirmed", "checked_in"].includes(String(r.status))) ||
        key === "sales"
      )
        return paidFail();
    }
  }
  for (const r of rows(v.businessFlags, 10000))
    if (!targetIds.has(String(r.unit_id)) || typeof r.is_enabled !== "boolean") return paidFail();
  return {
    success: true as const,
    requestId: input.requestId,
    idempotent: raw.idempotent,
    receiptId: d.receiptId as string,
    totalAmountXof: input.totalAmountXof,
    roomCount: n,
  };
}
