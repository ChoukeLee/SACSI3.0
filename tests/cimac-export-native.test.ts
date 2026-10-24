import { describe, expect, it } from "vitest";
import {
  CIMAC_PROJECT_ID,
  cimacExportCsv,
  decodeCimacLedger,
  type CimacExportBundle,
  type CimacExportQuery,
} from "@/features/finance/cimac-export-model";

const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const allViews: CimacExportQuery["view"][] = [
  "ledger",
  "payments",
  "deposits",
  "refunds",
  "property-fee-payments",
  "property-fee-receivables",
];
const cells = (csv: string) =>
  csv
    .replace(/^\uFEFF/, "")
    .split("\r\n")
    .map((line) =>
      [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map((match) => match[1].replaceAll('""', '"')),
    );
function fixture(): CimacExportBundle {
  const payment = (
    n: number,
    source: string,
    amount: number,
    currency: string,
    native: boolean,
  ) => ({
    id: id(n),
    unit_id: id(2),
    source_type: source,
    source_id: id(40),
    payment_date: "2026-10-05",
    amount,
    currency,
    exchange_rate_to_xof: native ? null : 1,
    native_settlement: native,
    payment_method: native ? "bank_transfer" : "cash",
    receipt_no: `NATIVE-EXPORT-${n}`,
    external_receipt_no: null,
    reversal_of_payment_id: null,
  });
  const entry = (
    n: number,
    paymentId: number,
    direction: string,
    category: string,
    amount: number,
    currency: string,
  ) => ({
    id: id(n),
    payment_id: id(paymentId),
    unit_id: id(2),
    building_id: id(1),
    entry_date: "2026-10-05",
    direction,
    category,
    amount_xof: currency === "XOF" ? amount : 0,
    amount_cny: null,
    currency,
    amount_native: currency === "XOF" ? null : amount,
  });
  return {
    readAt: "2026-10-24T12:00:00Z",
    buildings: [{ id: id(1), project_id: CIMAC_PROJECT_ID, display_name: "合成建材城" }],
    units: [{ id: id(2), unit_no: "316", building_id: id(1) }],
    payments: [
      payment(10, "lease_deposit", 2000, "CNY", true),
      payment(11, "lease_deposit_refund", 50000, "CNY", true),
      payment(12, "property_fee", 100000, "XOF", false),
    ],
    ledger: [
      entry(20, 10, "liability_in", "lease_deposit", 2000, "CNY"),
      entry(21, 11, "liability_out", "lease_deposit", 50000, "CNY"),
      entry(22, 12, "income", "property_fee", 100000, "XOF"),
    ],
  };
}

describe("CIMAC unvalued native deposit export", () => {
  it.each(allViews)("keeps native data valid for %s without leaking into property fees", (view) => {
    const bundle = fixture();
    if (view === "property-fee-receivables") {
      bundle.payments = [];
      bundle.ledger = [];
      bundle.receivables = [
        {
          id: id(30),
          unit_id: id(2),
          building_id: id(1),
          source_type: "property_fee",
          source_id: id(40),
          category: "property_fee",
          title: "合成物业费",
          due_date: "2027-04-01",
          amount_xof: 691200,
          paid_amount_xof: 0,
          status: "pending",
          management_status: "managed",
          service_period_start: "2027-04-01",
          service_period_end: "2028-03-31",
          service_period_source: null,
          service_period_confirmed_by: null,
        },
      ];
    }
    for (const locale of ["zh", "fr"] as const) {
      const csv = cimacExportCsv(bundle, { view, locale });
      const parsed = cells(csv);
      expect(parsed.every((row) => row.length === parsed[0].length)).toBe(true);
      if (view === "property-fee-payments") {
        expect(csv).toContain("NATIVE-EXPORT-12");
        expect(csv).not.toContain("NATIVE-EXPORT-10");
        expect(csv).not.toContain("NATIVE-EXPORT-11");
        expect(csv).not.toContain('"2000"');
        expect(csv).not.toContain('"50000"');
      } else if (view === "property-fee-receivables") {
        expect(csv).toContain("691200");
        expect(csv).not.toContain("NATIVE-EXPORT");
      } else {
        expect(csv).toContain(locale === "zh" ? "未折算" : "non convertie");
        expect(csv).toContain('"CNY"');
      }
      if (view === "refunds") expect(csv).not.toContain("NATIVE-EXPORT-10");
    }
  });
  it("displays native CNY independently, with blank XOF and no invented exchange rate", () => {
    const bundle = fixture();
    const ledger = cells(cimacExportCsv(bundle, { view: "ledger", locale: "zh" }));
    const native = ledger.find((row) => row.includes(id(20)))!;
    expect(native[ledger[0].indexOf("分录登记金额 XOF")]).toBe("");
    expect(native[ledger[0].indexOf("分录登记金额 CNY")]).toBe("2000");
    expect(native[ledger[0].indexOf("分录币种（仅已登记）")]).toBe("CNY");
    expect(native[ledger[0].indexOf("未折算原币金额")]).toBe("2000");
    const payments = cells(cimacExportCsv(bundle, { view: "payments", locale: "zh" }));
    const receipt = payments.find((row) => row.includes("NATIVE-EXPORT-10"))!;
    expect(receipt[payments[0].indexOf("原币金额")]).toBe("2000");
    expect(receipt[payments[0].indexOf("登记汇率至 XOF")]).toBe("");
    expect(receipt.filter((cell) => cell === "2000")).toHaveLength(1);
    expect(
      payments.find((row) => row.includes("NATIVE-EXPORT-12"))![payments[0].indexOf("原币金额")],
    ).toBe("100000");
  });
  it("lists one original receipt for multiple reconciled native ledger lines", () => {
    const bundle = fixture();
    bundle.payments = [bundle.payments[0]];
    bundle.ledger = [
      { ...bundle.ledger[0], amount_native: "1000.05" },
      { ...bundle.ledger[0], id: id(23), amount_native: "1000.05" },
    ];
    bundle.payments[0].amount = "2000.10";
    const parsed = cells(cimacExportCsv(bundle, { view: "deposits", locale: "zh" }));
    expect(parsed).toHaveLength(2);
    expect(parsed[1][parsed[0].indexOf("原币金额")]).toBe("2000.1");
    expect(parsed[1][parsed[0].indexOf("关联分录数")]).toBe("2");
    expect(parsed[1][parsed[0].indexOf("登记汇率至 XOF")]).toBe("");
  });
  it.each([
    "missing-flag",
    "false-flag",
    "invented-fx",
    "nonzero-xof",
    "wrong-currency",
    "wrong-native-total",
    "missing-native-amount",
    "malformed-native-flag",
  ])("fails closed on %s", (kind) => {
    const bundle = fixture();
    if (kind === "missing-flag") delete bundle.payments[0].native_settlement;
    if (kind === "false-flag") bundle.payments[0].native_settlement = false;
    if (kind === "invented-fx") bundle.payments[0].exchange_rate_to_xof = 80;
    if (kind === "nonzero-xof") bundle.ledger[0].amount_xof = 160000;
    if (kind === "wrong-currency") bundle.ledger[0].currency = "USD";
    if (kind === "wrong-native-total") bundle.ledger[0].amount_native = 1999;
    if (kind === "missing-native-amount") delete bundle.ledger[0].amount_native;
    if (kind === "malformed-native-flag") bundle.payments[0].native_settlement = "true";
    expect(() => cimacExportCsv(bundle, { view: "payments", locale: "zh" })).toThrow(
      "Invalid or incomplete CIMAC export data",
    );
  });
  it("preserves raw legacy CNY and does not infer native fields", () => {
    const row = fixture().ledger[0];
    delete row.currency;
    delete row.amount_native;
    row.amount_xof = 7950000;
    row.amount_cny = 100000;
    const decoded = decodeCimacLedger({ kind: "ledger", total: 1, rows: [row] });
    expect(decoded[0]).toMatchObject({ amount_xof: 7950000, amount_cny: 100000 });
    expect(decoded[0]).not.toHaveProperty("currency");
    expect(decoded[0]).not.toHaveProperty("amount_native");
  });
});
