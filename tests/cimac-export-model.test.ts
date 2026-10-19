import { describe, expect, it } from "vitest";
import {
  CIMAC_PROJECT_ID,
  cimacExportCsv,
  decodeCimacLedger,
  parseCimacExportQuery,
  type CimacExportBundle,
} from "../src/features/finance/cimac-export-model";

const uid = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const building = uid(1),
  unit = uid(2),
  payment = uid(3),
  ledger = uid(4);
const row = () => ({
  id: ledger,
  building_id: building,
  unit_id: unit,
  payment_id: payment,
  entry_date: "2026-10-19",
  direction: "liability_out",
  category: "lease_deposit",
  amount_xof: 60000,
  amount_cny: null,
  description: "PRIVATE_DESCRIPTION",
  customer_phone: "PRIVATE_PHONE",
});
const rpc = (rows: unknown[] = [row()]) => ({ kind: "ledger", total: rows.length, rows });
function bundle(): CimacExportBundle {
  return {
    readAt: "2026-10-19T12:00:00.000Z",
    ledger: [row()],
    payments: [
      {
        id: payment,
        unit_id: unit,
        source_type: "lease_deposit_refund",
        source_id: uid(5),
        amount: 1000,
        currency: "CNY",
        exchange_rate_to_xof: 60,
        payment_date: "2026-10-19",
        receipt_no: "DEPREF-123",
        external_receipt_no: "EXT-123",
        reversal_of_payment_id: uid(6),
        notes: "PRIVATE_NOTES",
        phone: "PRIVATE_PHONE",
      },
    ],
    units: [{ id: unit, building_id: building, unit_no: "601", code: "CIMAC-B06-601" }],
    buildings: [
      { id: building, project_id: CIMAC_PROJECT_ID, display_name: "第六栋", code: "CIMAC-B06" },
    ],
  };
}
const query = (view: "ledger" | "payments" = "ledger", locale: "zh" | "fr" = "zh") => ({
  view,
  locale,
});

describe("CIMAC export strict query", () => {
  it("defaults only omitted view and locale", () => {
    expect(parseCimacExportQuery(new URLSearchParams())).toEqual(query());
    expect(
      parseCimacExportQuery(
        new URLSearchParams("view=payments&locale=fr&dateFrom=2024-02-29&dateTo=2026-10-19"),
      ),
    ).toEqual({ ...query("payments", "fr"), dateFrom: "2024-02-29", dateTo: "2026-10-19" });
  });
  it.each([
    "projectId=other",
    "ignored=1",
    "view=ledger&view=payments",
    "locale=zh&locale=zh",
    "view=",
    "view=all",
    "locale=",
    "locale=en",
    "dateFrom=",
    "dateFrom=2026-02-29",
    "dateTo=2026-13-01",
    "dateFrom=2026-1-01",
    "dateFrom=2026-10-20&dateTo=2026-10-19",
  ])("rejects %s", (search) => {
    expect(() => parseCimacExportQuery(new URLSearchParams(search))).toThrow();
  });
});

describe("CIMAC complete ledger decoder", () => {
  it("accepts complete empty, zero and explicit nullable values without guessing", () => {
    expect(decodeCimacLedger(rpc([]))).toEqual([]);
    const value = { ...row(), amount_xof: 0, amount_cny: "0.00", payment_id: null };
    expect(decodeCimacLedger(rpc([value]))[0]).toMatchObject({
      amount_xof: 0,
      amount_cny: 0,
      payment_id: null,
    });
  });
  it.each([
    null,
    {},
    { ...rpc(), kind: "payments" },
    { ...rpc(), total: 2 },
    { ...rpc(), total: -1 },
    { ...rpc(), total: 100001 },
    { ...rpc(), total: 1.5 },
    { ...rpc(), rows: null },
  ])("rejects an incomplete or invalid envelope", (data) => {
    expect(() => decodeCimacLedger(data)).toThrow();
  });
  it("rejects duplicate IDs case-insensitively", () => {
    expect(() => decodeCimacLedger(rpc([row(), { ...row(), id: ledger.toUpperCase() }]))).toThrow();
  });
  it.each([
    "id",
    "building_id",
    "unit_id",
    "payment_id",
    "entry_date",
    "direction",
    "category",
    "amount_xof",
    "amount_cny",
  ])("requires %s", (key) => {
    const value: Record<string, unknown> = row();
    delete value[key];
    expect(() => decodeCimacLedger(rpc([value]))).toThrow();
  });
  it.each([null, undefined, "", " ", "oops", NaN, Infinity, -1, "-1"])(
    "does not convert invalid XOF %s into zero",
    (amount_xof) => {
      expect(() => decodeCimacLedger(rpc([{ ...row(), amount_xof }]))).toThrow();
    },
  );
  it.each([
    { unit_id: "601" },
    { direction: "refund" },
    { entry_date: "2026-02-30" },
    { category: "" },
    { amount_cny: NaN },
    { amount_cny: -1 },
  ])("rejects invalid ledger fields %o", (patch) => {
    expect(() => decodeCimacLedger(rpc([{ ...row(), ...patch }]))).toThrow();
  });
});

describe("CIMAC export scoped CSV", () => {
  it("exports bilingual ledger columns, raw positive refund amounts and only safe whitelisted fields", () => {
    const data = bundle();
    for (const locale of ["zh", "fr"] as const) {
      const csv = cimacExportCsv(data, query("ledger", locale));
      expect(csv.startsWith("\uFEFF")).toBe(true);
      expect(csv).toContain(locale === "zh" ? "分录登记金额 CNY" : "Montant enregistré CNY");
      expect(csv).toContain('"60000",""');
      expect(csv).toContain(ledger);
      expect(csv).toContain(unit);
      expect(csv).toContain("DEPREF-123");
      expect(csv).toContain("liability_out");
      expect(csv).toContain(uid(6));
      expect(csv).not.toContain("PRIVATE_");
      expect(csv).not.toContain('"1000"');
    }
    expect(data).toEqual(bundle());
  });
  it("shows each linked payment once, with reference count rather than repeated original currency or totals", () => {
    const data = bundle();
    data.ledger.push({ ...row(), id: uid(7), amount_xof: 0 });
    const csv = cimacExportCsv(data, query("payments"));
    expect(csv.split("\r\n")).toHaveLength(2);
    expect(csv.match(/"1000"/g)).toHaveLength(1);
    expect(csv).toContain("非全库全部收款");
    expect(csv).toContain("不自动分摊");
    expect(csv).toContain('"2"');
    expect(csv).toContain(ledger + " / " + uid(7));
    expect(csv).not.toContain('"60000"');
    const fr = cimacExportCsv(data, query("payments", "fr"));
    expect(fr).toContain("pas tous les paiements de la base");
    expect(fr).toContain("sans ventilation automatique");
  });
  it("keeps ledger-only CNY as recorded and never infers original currency or a rate", () => {
    const data = bundle();
    data.ledger[0] = { ...row(), payment_id: null, amount_cny: 50000 };
    data.payments = [];
    const csv = cimacExportCsv(data, query());
    expect(csv).toContain('"60000","50000"');
    expect(csv).toContain("不代表漏账");
    expect(csv).not.toContain('"CNY"');
    expect(csv).not.toContain('"60"');
    expect(cimacExportCsv(data, query("payments")).split("\r\n")).toHaveLength(1);
  });
  it("can fill a missing ledger unit only from its verified linked payment", () => {
    const data = bundle();
    data.ledger[0].unit_id = null;
    const csv = cimacExportCsv(data, query());
    expect(csv).toContain(`"","${unit}","601","payment.unit_id"`);
  });
  it("does not infer a unit for a building-only entry without a payment", () => {
    const data = bundle();
    data.ledger[0].unit_id = null;
    data.ledger[0].payment_id = null;
    data.payments = [];
    data.units = [];
    expect(cimacExportCsv(data, query())).toContain("未关联收款记录");
  });
  it("honors an explicit ledger building within CIMAC and flags a different unit building", () => {
    const data = bundle();
    data.buildings.push({ id: uid(8), project_id: CIMAC_PROJECT_ID, display_name: "第八栋" });
    data.ledger[0].building_id = uid(8);
    expect(cimacExportCsv(data, query())).toContain("以分录登记楼栋为准");
    data.ledger[0].building_id = null;
    expect(cimacExportCsv(data, query())).toContain("第六栋");
  });
  it.each([
    "foreign-building",
    "foreign-unit-building",
    "missing-building",
    "missing-unit",
    "missing-payment",
    "unrelated-payment",
    "duplicate-unit",
    "duplicate-building",
    "duplicate-payment",
    "unit-conflict",
    "unscoped",
    "malformed-read-at",
    "outside-dates",
  ])("fails closed for %s", (kind) => {
    const data = bundle();
    let q = query();
    if (kind === "foreign-building") data.buildings[0].project_id = uid(9);
    if (kind === "foreign-unit-building") {
      data.buildings.push({ id: uid(8), project_id: uid(9) });
      data.units[0].building_id = uid(8);
    }
    if (kind === "missing-building") data.buildings = [];
    if (kind === "missing-unit") data.units = [];
    if (kind === "missing-payment") data.payments = [];
    if (kind === "unrelated-payment") data.payments.push({ ...data.payments[0], id: uid(9) });
    if (kind === "duplicate-unit") data.units.push({ ...data.units[0] });
    if (kind === "duplicate-building") data.buildings.push({ ...data.buildings[0] });
    if (kind === "duplicate-payment") data.payments.push({ ...data.payments[0] });
    if (kind === "unit-conflict") {
      data.units.push({ id: uid(9), building_id: building, unit_no: "602" });
      data.payments[0].unit_id = uid(9);
    }
    if (kind === "unscoped") {
      data.ledger[0].unit_id = null;
      data.ledger[0].building_id = null;
    }
    if (kind === "malformed-read-at") data.readAt = "not-a-date";
    if (kind === "outside-dates") q = { ...q, dateFrom: "2026-10-20" } as typeof q;
    expect(() => cimacExportCsv(data, q)).toThrow();
  });
  it.each([null, "", -1, NaN, Infinity])(
    "does not guess an invalid linked original amount %s",
    (value) => {
      const data = bundle();
      data.payments[0].amount = value;
      expect(() => cimacExportCsv(data, query("payments"))).toThrow();
    },
  );
  it.each([
    '=HYPERLINK("url")',
    "+cmd",
    "-cmd",
    "@SUM(A1)",
    " \t=SUM(A1)",
    "\u0000+cmd",
    "safe\nnew,row",
    "\uFEFF=cmd",
  ])("neutralizes CSV injection and controls %s", (value) => {
    const data = bundle();
    data.payments[0].external_receipt_no = value;
    const csv = cimacExportCsv(data, query("payments"));
    expect(csv).toContain("\"'");
    expect(csv).not.toMatch(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/);
    expect(csv.split("\r\n")).toHaveLength(2);
  });
});
