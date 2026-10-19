import { describe, expect, it } from "vitest";
import {
  CIMAC_PROJECT_ID,
  cimacExportCsv,
  decodeCimacReceivables,
  parseCimacExportQuery,
  type CimacExportBundle,
  type CimacExportQuery,
} from "../src/features/finance/cimac-export-model";

type Row = Record<string, unknown>;
const uid = (n: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, "0")}`;
const buildingId = uid(1),
  unitId = uid(2);
const query = (view: CimacExportQuery["view"], locale: "zh" | "fr" = "zh"): CimacExportQuery => ({
  view,
  locale,
});
const base = (): CimacExportBundle => ({
  readAt: "2026-10-19T12:00:00.000Z",
  ledger: [],
  payments: [],
  units: [{ id: unitId, building_id: buildingId, unit_no: "601" }],
  buildings: [{ id: buildingId, project_id: CIMAC_PROJECT_ID, display_name: "第六栋" }],
});
const receivable = (): Row => ({
  id: uid(3),
  building_id: buildingId,
  unit_id: unitId,
  source_type: "lease_contract",
  source_id: uid(4),
  category: "property_fee",
  due_date: "2026-10-19",
  amount_xof: 100000,
  paid_amount_xof: 30000,
  status: "partial",
  management_status: "managed",
  service_period_start: null,
  service_period_end: null,
  service_period_source: null,
  service_period_confirmed_by: null,
  title: "PRIVATE_TITLE",
  notes: "PRIVATE_NOTES",
  phone: "PRIVATE_PHONE",
});
const rpc = (rows: unknown[] = [receivable()]) => ({
  kind: "receivables",
  total: rows.length,
  rows,
});
function withReceivable(row = receivable()) {
  return { ...base(), receivables: [row] };
}
function addPayment(
  data: CimacExportBundle,
  type: string,
  index: number,
  method: string | null = "cash",
) {
  const key = uid(100 + index);
  const payment: Row = {
    id: key,
    unit_id: unitId,
    source_type: type,
    source_id: uid(4),
    payment_date: "2026-10-19",
    amount: 1000 + index,
    currency: index % 2 ? "CNY" : "XOF",
    exchange_rate_to_xof: index % 2 ? 60 : 1,
    receipt_no: `SOURCE-${index}`,
    external_receipt_no: `EXT-${index}`,
    reversal_of_payment_id: null,
    payment_method: method,
    notes: "PRIVATE_NOTES",
    phone: "PRIVATE_PHONE",
  };
  data.payments.push(payment);
  const line = (direction: string, category: string, suffix = 0) => ({
    id: uid(200 + index * 2 + suffix),
    building_id: buildingId,
    unit_id: unitId,
    payment_id: key,
    entry_date: "2026-10-19",
    direction,
    category,
    amount_xof: 1000 + index,
    amount_cny: null,
  });
  data.ledger.push(
    type === "lease_deposit"
      ? line("liability_in", "lease_deposit")
      : type === "lease_deposit_refund" || type === "lease_deposit_deduction"
        ? line("liability_out", "lease_deposit")
        : type === "property_fee"
          ? line("income", "property_fee")
          : line("liability_in", "lease_deposit"),
  );
  if (type === "lease_deposit_deduction") data.ledger.push(line("income", "other_income", 1));
  return payment;
}
const cashBundle = () => {
  const data = base();
  addPayment(data, "lease_deposit", 1);
  addPayment(data, "lease_deposit_refund", 2);
  addPayment(data, "lease_deposit_deduction", 3, "offset");
  addPayment(data, "property_fee", 4);
  return data;
};

describe("CIMAC special report queries", () => {
  it.each(["deposits", "refunds", "property-fee-payments", "property-fee-receivables"])(
    "accepts %s with the same strict dates and locale",
    (view) => {
      expect(
        parseCimacExportQuery(
          new URLSearchParams({ view, locale: "fr", dateFrom: "2026-10-01", dateTo: "2026-10-19" }),
        ),
      ).toEqual({ view, locale: "fr", dateFrom: "2026-10-01", dateTo: "2026-10-19" });
      expect(() =>
        parseCimacExportQuery(new URLSearchParams({ view, dateFrom: "2026-02-30" })),
      ).toThrow();
    },
  );
});

describe("complete structured property-fee receivables", () => {
  it("accepts explicit zeros, nullable links and nullable period facts without inventing values", () => {
    const row = {
      ...receivable(),
      amount_xof: "0.00",
      paid_amount_xof: 0,
      unit_id: null,
      source_id: null,
    };
    expect(decodeCimacReceivables(rpc([row]))[0]).toMatchObject({
      amount_xof: 0,
      paid_amount_xof: 0,
      unit_id: null,
      service_period_start: null,
    });
    expect(decodeCimacReceivables(rpc([]))).toEqual([]);
  });
  it.each([
    null,
    {},
    { ...rpc(), kind: "ledger" },
    { ...rpc(), total: 2 },
    { ...rpc(), total: 100001 },
    { ...rpc(), total: -1 },
    { ...rpc(), total: 1.5 },
    rpc([receivable(), receivable()]),
  ])("rejects incomplete or ambiguous full results", (data) => {
    expect(() => decodeCimacReceivables(data)).toThrow();
  });
  it.each([
    "id",
    "building_id",
    "unit_id",
    "source_type",
    "source_id",
    "category",
    "due_date",
    "amount_xof",
    "paid_amount_xof",
    "status",
    "management_status",
    "service_period_start",
    "service_period_end",
    "service_period_source",
    "service_period_confirmed_by",
  ])("requires the explicit %s fact, even if nullable", (key) => {
    const row = receivable();
    delete row[key];
    expect(() => decodeCimacReceivables(rpc([row]))).toThrow();
  });
  it.each([
    { category: "lease_rent" },
    { category: "property_fee_old" },
    { due_date: "2026-02-30" },
    { unit_id: "601" },
    { source_id: "not-id" },
    { amount_xof: null },
    { amount_xof: -1 },
    { paid_amount_xof: "" },
    { paid_amount_xof: NaN },
    { status: "unknown" },
    { status: ["paid"] },
    { management_status: "unknown" },
    { service_period_start: "2027-02-29" },
    { service_period_end: "2027-13-01" },
    { service_period_confirmed_by: "someone" },
    { service_period_source: "" },
    { service_period_start: "2027-04-02", service_period_end: "2027-04-01" },
  ])("rejects malformed facts %o", (patch) => {
    expect(() => decodeCimacReceivables(rpc([{ ...receivable(), ...patch }]))).toThrow();
  });
  it.each([
    { service_period_start: "2027-01-01" },
    { service_period_end: "2027-12-31" },
    { service_period_source: "PRIVATE_SOURCE_ONLY" },
    { service_period_confirmed_by: uid(88) },
    { service_period_start: "2027-01-01", service_period_end: "2027-12-31" },
  ])("keeps legal partial historical facts explicit and pending %o", (patch) => {
    const row = { ...receivable(), ...patch };
    expect(decodeCimacReceivables(rpc([row]))[0]).toMatchObject(patch);
    const result = cimacExportCsv(withReceivable(row), query("property-fee-receivables"));
    expect(result).toContain("待核对");
    if (!patch.service_period_start) expect(result).not.toContain("2027-01-01");
    if (!patch.service_period_end) expect(result).not.toContain("2027-12-31");
    expect(result).not.toContain("PRIVATE_SOURCE_ONLY");
    expect(result).not.toContain(uid(88));
  });
  it.each(["zh", "fr"] as const)(
    "exports current receivables and only explicit service dates in %s",
    (locale) => {
      const row = {
        ...receivable(),
        service_period_start: "2027-01-01",
        service_period_end: "2027-12-31",
        service_period_source: "PRIVATE_SOURCE_TEXT",
        service_period_confirmed_by: uid(88),
      };
      const data = withReceivable(row),
        snapshot = structuredClone(data);
      const result = cimacExportCsv(data, {
        ...query("property-fee-receivables", locale),
        dateFrom: "2026-10-01",
        dateTo: "2026-10-19",
      });
      expect(result).toContain(
        locale === "zh" ? "当前应收非历史余额" : "créances actuelles, pas un solde historique",
      );
      expect(result).toContain(
        locale === "zh"
          ? "明确账期及确认信息已登记"
          : "Période explicite et confirmation enregistrées",
      );
      expect(result).toContain("2027-01-01");
      expect(result).toContain('"100000","30000"');
      expect(result).not.toContain('"70000"');
      expect(result).not.toContain("PRIVATE_");
      expect(result).not.toContain(uid(88));
      expect(data).toEqual(snapshot);
    },
  );
  it("does not fabricate a data row or period when the authorized result is empty", () => {
    const data = { ...base(), receivables: [] };
    const result = cimacExportCsv(data, query("property-fee-receivables"));
    expect(result.split("\r\n")).toHaveLength(1);
    expect(result).toContain("不是服务账期");
    expect(result).toContain("空结果不代表免缴或未缴");
  });
  it.each([
    "ledger",
    "payments",
    "missing-receivables",
    "unscoped",
    "foreign-building",
    "foreign-unit",
    "missing-unit",
    "due-filter",
  ])("fails closed for %s", (kind) => {
    const data: CimacExportBundle = withReceivable();
    let q = query("property-fee-receivables");
    if (kind === "ledger") data.ledger = cashBundle().ledger;
    if (kind === "payments") data.payments = cashBundle().payments;
    if (kind === "missing-receivables") delete data.receivables;
    if (kind === "unscoped") {
      data.receivables![0].building_id = null;
      data.receivables![0].unit_id = null;
    }
    if (kind === "foreign-building") data.buildings[0].project_id = uid(90);
    if (kind === "foreign-unit") {
      data.buildings.push({ id: uid(91), project_id: uid(90) });
      data.units[0].building_id = uid(91);
    }
    if (kind === "missing-unit") data.units = [];
    if (kind === "due-filter") q = { ...q, dateFrom: "2027-01-01" };
    expect(() => cimacExportCsv(data, q)).toThrow();
  });
  it("keeps cancelled, historical, excluded and paid book states rather than reclassifying arrears", () => {
    const data = withReceivable({
      ...receivable(),
      status: "cancelled",
      management_status: "excluded",
      amount_xof: 0,
      paid_amount_xof: 100,
    });
    const result = cimacExportCsv(data, query("property-fee-receivables"));
    expect(result).toContain('"0","100","cancelled","excluded"');
    expect(result).not.toContain("欠费");
  });
});

describe("CIMAC evidenced cash special reports", () => {
  it.each(["zh", "fr"] as const)(
    "separates received/refunded/deducted deposits from property fees in %s",
    (locale) => {
      const data = cashBundle();
      const deposits = cimacExportCsv(data, query("deposits", locale));
      expect(deposits.split("\r\n")).toHaveLength(4);
      expect(deposits).toContain('"SOURCE-1"');
      expect(deposits).toContain('"SOURCE-2"');
      expect(deposits).toContain('"SOURCE-3"');
      expect(deposits).not.toContain('"SOURCE-4"');
      expect(deposits).toContain(
        locale === "zh" ? "非余额或可退额" : "pas un solde ni un montant remboursable",
      );
      expect(deposits).toContain(locale === "zh" ? "非现金／抵扣" : "Non monétaire / compensation");
      expect(deposits.match(/"1003"/g)).toHaveLength(1);
      const refunds = cimacExportCsv(data, query("refunds", locale));
      expect(refunds.split("\r\n")).toHaveLength(2);
      expect(refunds).toContain('"SOURCE-2"');
      expect(refunds).not.toContain('"SOURCE-3"');
      const property = cimacExportCsv(data, query("property-fee-payments", locale));
      expect(property.split("\r\n")).toHaveLength(2);
      expect(property).toContain('"SOURCE-4"');
      expect(property).not.toContain('"SOURCE-1"');
      expect(property).not.toContain("PRIVATE_");
      expect(property).not.toContain("年费");
    },
  );
  it("keeps one original payment for repeated same-class ledger lines", () => {
    const data = base();
    addPayment(data, "lease_deposit", 1);
    data.ledger.push({ ...data.ledger[0], id: uid(999), amount_xof: 0 });
    const result = cimacExportCsv(data, query("deposits"));
    expect(result.split("\r\n")).toHaveLength(2);
    expect(result.match(/"1001"/g)).toHaveLength(1);
    expect(result).toContain("不自动分摊");
  });
  it("does not convert unknown-source related ledger or ledger-only rows into cash receipts", () => {
    const data = base();
    addPayment(data, "manual", 1);
    data.ledger.push({ ...data.ledger[0], id: uid(999), payment_id: null, amount_cny: 50000 });
    const result = cimacExportCsv(data, query("deposits"));
    expect(result.split("\r\n")).toHaveLength(1);
    expect(result).toContain("未关联或未核实分录另见分录明细");
    expect(result).not.toContain('"50000"');
    expect(cimacExportCsv(data, query("ledger"))).toContain('"50000"');
  });
  it.each([
    "deposit-direction",
    "deposit-category",
    "refund-direction",
    "property-direction",
    "deduction-method",
    "deduction-missing-leg",
    "deduction-extra-leg",
    "mixed-line",
  ])("rejects contradictory %s evidence instead of silently reporting it", (kind) => {
    const data = cashBundle();
    if (kind === "deposit-direction") data.ledger[0].direction = "income";
    if (kind === "deposit-category") data.ledger[0].category = "property_fee";
    if (kind === "refund-direction") data.ledger[1].direction = "expense";
    if (kind === "property-direction") data.ledger[4].direction = "liability_in";
    if (kind === "deduction-method") data.payments[2].payment_method = "cash";
    if (kind === "deduction-missing-leg") data.ledger.splice(3, 1);
    if (kind === "deduction-extra-leg")
      data.ledger.push({
        ...data.ledger[2],
        id: uid(999),
        direction: "expense",
        category: "other_expense",
      });
    if (kind === "mixed-line")
      data.ledger.push({
        ...data.ledger[0],
        id: uid(999),
        direction: "income",
        category: "other_income",
      });
    expect(() => cimacExportCsv(data, query("deposits"))).toThrow();
  });
  it("marks reversal references as neither a new collection nor a new refund, without guessing an original receipt", () => {
    const data = base();
    const payment = addPayment(data, "lease_deposit_refund", 1);
    payment.reversal_of_payment_id = uid(999);
    const result = cimacExportCsv(data, query("refunds"));
    expect(result).toContain("冲销关联记录，非新收款或新退款");
    expect(result).toContain(uid(999));
    expect(result).toContain('"1001"');
    expect(result).not.toContain('"-1001"');
  });
  it("shows an explicit null method as unknown, while original modes remain backward compatible", () => {
    const data = base();
    const payment = addPayment(data, "lease_deposit", 1, null);
    expect(cimacExportCsv(data, query("deposits"))).toContain('"未登记"');
    delete payment.payment_method;
    expect(cimacExportCsv(data, query("payments"))).toContain('"SOURCE-1"');
    expect(() => cimacExportCsv(data, query("deposits"))).toThrow();
  });
  it.each(["", "crypto", undefined, 0])(
    "rejects invalid method %s for special reports",
    (value) => {
      const data = base();
      const payment = addPayment(data, "lease_deposit", 1);
      payment.payment_method = value;
      expect(() => cimacExportCsv(data, query("deposits"))).toThrow();
    },
  );
  it("does not coerce an array into a valid payment method", () => {
    const data = base();
    const payment = addPayment(data, "lease_deposit", 1);
    payment.payment_method = ["cash"];
    expect(() => cimacExportCsv(data, query("deposits"))).toThrow();
  });
  it("does not expand old support to negative daily payments", () => {
    const data = base();
    const payment = addPayment(data, "daily_booking", 1);
    payment.amount = -100;
    expect(() => cimacExportCsv(data, query("deposits"))).toThrow();
  });
});
