import { describe, expect, it } from "vitest";
import {
  parseCimacMaintenance,
  type CimacMaintenanceOperation,
} from "@/features/business-actions/cimac-maintenance";
import { verifyCimacMaintenanceResult } from "@/features/business-actions/cimac-maintenance-verification";

export const cimacIds = {
  actor: "11111111-1111-4111-8111-111111111111",
  request: "22222222-2222-4222-8222-222222222222",
  contract: "33333333-3333-4333-8333-333333333333",
  unit: "44444444-4444-4444-8444-444444444444",
  payment: "55555555-5555-4555-8555-555555555555",
  ledger: "66666666-6666-4666-8666-666666666666",
  audit: "77777777-7777-4777-8777-777777777777",
  refund: "88888888-8888-4888-8888-888888888888",
  refundLedger: "99999999-9999-4999-8999-999999999999",
};
const annotation = "User confirmed original-currency history; do not create rent receivables.";
export function cimacRequest(
  operations: CimacMaintenanceOperation[] = [
    {
      type: "note_receipt",
      contractIds: [cimacIds.contract],
      customerName: "葛效国",
      annotation,
      receipt: {
        contractId: cimacIds.contract,
        amount: "2000.00",
        currency: "CNY",
        paymentDate: "2026-09-19",
        paymentMethod: "bank_transfer",
        noteMarker: "2026-09-19已收部分押金人民币2000元",
      },
    },
  ],
) {
  return {
    protocolVersion: "1.0" as const,
    connectorVersion: "0.8.0" as const,
    requestId: cimacIds.request,
    originalInstruction: "按已确认资料纠正，保留历史付款。",
    inputSource: "natural_language" as const,
    operations,
  };
}
export function cimacResult() {
  return {
    status: "completed",
    verified: true,
    requestId: cimacIds.request,
    request: cimacRequest(),
    actorId: cimacIds.actor,
    operationCount: 1,
    paymentIds: [cimacIds.payment],
    auditId: cimacIds.audit,
    operationResults: [
      {
        type: "note_receipt",
        contractIds: [cimacIds.contract],
        unitIds: [cimacIds.unit],
        paymentIds: [cimacIds.payment],
      },
    ],
    payments: [
      {
        id: cimacIds.payment,
        sourceId: cimacIds.contract,
        paymentType: "lease_deposit",
        currency: "CNY",
        amount: "2000.00",
        paymentDate: "2026-09-19",
        paymentMethod: "bank_transfer",
        recordedBy: cimacIds.actor,
        nativeSettlement: true,
        exchangeRateToXof: null,
        ledgerId: cimacIds.ledger,
        ledgerCurrency: "CNY",
        ledgerAmountXof: "0.00",
        ledgerAmountNative: "2000.00",
        ledgerDirection: "liability_in",
      },
    ],
    reconciliation: {
      paymentCount: 1,
      ledgerCount: 1,
      receivablesCreated: 0,
      originalPaymentsPreserved: true,
      contractsMatch: true,
      unitsMatch: true,
      paymentsMatch: true,
      ledgerMatch: true,
      auditMatch: true,
    },
  };
}

describe("strict CIMAC maintenance parser", () => {
  it("normalizes exact original CNY strings and UUIDs without calculating FX", () => {
    const value = cimacRequest();
    const op = value.operations[0];
    if (op.type !== "note_receipt") throw new Error("fixture");
    op.receipt.amount = "2000";
    value.originalInstruction = "  original instruction  ";
    const parsed = parseCimacMaintenance(value, "2026-10-24");
    expect(parsed.originalInstruction).toBe("original instruction");
    expect(parsed.operations[0]).toMatchObject({ receipt: { amount: "2000.00", currency: "CNY" } });
    expect(JSON.stringify(parsed)).not.toMatch(/exchangeRate|amountXof/);
  });
  it("allows only seven explicit operation shapes", () => {
    const common = { customerName: "张馨月", annotation };
    const refund = {
      amount: "75000.00",
      currency: "CNY" as const,
      paymentDate: "2026-10-20",
      paymentMethod: "bank_transfer" as const,
      originalPaymentIds: [cimacIds.payment],
    };
    const operations: CimacMaintenanceOperation[] = [
      {
        ...common,
        type: "terms",
        contractIds: [cimacIds.contract],
        monthlyRentXof: "1800000",
        depositXof: "5400000",
        freeMonths: 12,
        rentFreeStart: "2027-04-01",
        rentFreeEnd: "2028-03-31",
        propertyRateXofPerSqm: "900",
      },
      {
        ...common,
        type: "close",
        contractIds: [cimacIds.contract],
        correctedCustomerName: "栗军华",
        refund,
      },
      {
        ...common,
        type: "replace",
        contractIds: [cimacIds.contract],
        refund,
        newCustomerName: "刘琤",
        monthlyRentXof: "980000",
        depositXof: "2940000",
        receipt: {
          amount: "2940000",
          currency: "XOF",
          paymentDate: "2026-10-19",
          paymentMethod: "cash",
        },
      },
      {
        ...common,
        type: "reserve",
        unitNos: ["302", "304"],
        groupMonthlyRentXof: "2920000",
        groupDepositXof: "8760000",
      },
      { ...common, type: "area", unitNo: "1704", areaSqm: "57.75", propertyRateXofPerSqm: "900" },
      {
        ...common,
        type: "create_reservation",
        buildingCode: "CIMAC-B17",
        unitNo: "1703",
        areaSqm: "57.75",
        monthlyRentXof: "650000",
        depositXof: "1950000",
        propertyRateXofPerSqm: "900",
      },
      cimacRequest().operations[0],
    ];
    for (const op of operations)
      expect(parseCimacMaintenance(cimacRequest([op]), "2026-10-24").operations).toHaveLength(1);
  });
  it.each([
    (v: Record<string, unknown>) => ({ ...v, table: "payments" }),
    (v: Record<string, unknown>) => ({ ...v, connectorVersion: "0.7.0" }),
    (v: Record<string, unknown>) => ({ ...v, requestId: "not-a-uuid" }),
    (v: Record<string, unknown>) => ({ ...v, originalInstruction: " " }),
    (v: Record<string, unknown>) => ({ ...v, originalInstruction: "a".repeat(4001) }),
    (v: Record<string, unknown>) => ({ ...v, operations: [] }),
    (v: Record<string, unknown>) => ({
      ...v,
      operations: Array.from({ length: 31 }, () => cimacRequest().operations[0]),
    }),
    (v: Record<string, unknown>) => ({
      ...v,
      operations: [{ type: "sql", sql: "delete from payments" }],
    }),
  ])("rejects unbounded or unsupported top-level data", (change) => {
    expect(() => parseCimacMaintenance(change(cimacRequest()), "2026-10-24")).toThrow(
      "invalidCimacMaintenance",
    );
  });
  it.each([2000, "2e3", "02", "-2000", "0", "2000.001", "1,000", "NaN"])(
    "rejects invalid money %s",
    (amount) => {
      const request = cimacRequest();
      const op = request.operations[0];
      if (op.type !== "note_receipt") throw new Error("fixture");
      expect(() =>
        parseCimacMaintenance(
          { ...request, operations: [{ ...op, receipt: { ...op.receipt, amount } }] },
          "2026-10-24",
        ),
      ).toThrow();
    },
  );
  it.each([
    { paymentDate: "2026-02-30" },
    { paymentDate: "2026-10-25" },
    { paymentMethod: "other" },
    { paymentMethod: "cash" },
    { paymentDate: "1999-12-31" },
    { noteMarker: "a".repeat(1001) },
    { currency: "USD" },
    { exchangeRateToXof: "80" },
    { contractId: cimacIds.unit },
  ])("rejects incomplete or speculative receipt data %j", (changes) => {
    const request = cimacRequest();
    const op = request.operations[0];
    if (op.type !== "note_receipt") throw new Error("fixture");
    expect(() =>
      parseCimacMaintenance(
        { ...request, operations: [{ ...op, receipt: { ...op.receipt, ...changes } }] },
        "2026-10-24",
      ),
    ).toThrow();
  });
  it("rejects duplicate targets, XOF decimals and inconsistent deposits", () => {
    const value = {
      ...cimacRequest().operations[0],
      contractIds: [cimacIds.contract, cimacIds.contract],
    };
    expect(() => parseCimacMaintenance(cimacRequest([value]), "2026-10-24")).toThrow();
    const op = {
      type: "reserve",
      customerName: "箭牌卫浴",
      annotation,
      unitNos: ["302", "304"],
      groupMonthlyRentXof: "2920000",
      groupDepositXof: "8760000",
    };
    for (const changes of [
      { groupMonthlyRentXof: "2920000.00" },
      { groupDepositXof: "8760001" },
      { unitNos: ["302", "302"] },
    ]) {
      expect(() =>
        parseCimacMaintenance(
          { ...cimacRequest(), operations: [{ ...op, ...changes }] },
          "2026-10-24",
        ),
      ).toThrow();
    }
  });
  it("requires linked original payments or an exact historical note receipt for a refund", () => {
    const note = cimacRequest().operations[0];
    if (note.type !== "note_receipt") throw new Error("fixture");
    const op: CimacMaintenanceOperation = {
      type: "close",
      customerName: "栗军华",
      contractIds: [cimacIds.contract],
      annotation,
      refund: {
        amount: "2000.00",
        currency: "CNY",
        paymentDate: "2026-10-05",
        paymentMethod: "bank_transfer",
        originalPaymentIds: [],
      },
      noteReceipt: note.receipt,
    };
    expect(() => parseCimacMaintenance(cimacRequest([op]), "2026-10-24")).not.toThrow();
    const invalid = { ...op, noteReceipt: { ...note.receipt, amount: "2001.00" } };
    expect(() => parseCimacMaintenance(cimacRequest([invalid]), "2026-10-24")).toThrow();
    expect(() =>
      parseCimacMaintenance(cimacRequest([{ ...op, noteReceipt: undefined }]), "2026-10-24"),
    ).toThrow();
  });
  it("bounds the maintenance family to confirmed rates, dates, numeric shops and unique targets", () => {
    const terms = {
      type: "terms",
      contractIds: [cimacIds.contract],
      customerName: "张馨月",
      annotation,
      monthlyRentXof: "1800000",
      depositXof: "5400000",
      freeMonths: 12,
      rentFreeStart: "2027-04-01",
      rentFreeEnd: "2028-03-31",
      propertyRateXofPerSqm: "900",
    };
    for (const changes of [
      { freeMonths: 0 },
      { rentFreeStart: "2026-04-01" },
      { rentFreeEnd: "2027-03-31" },
      { propertyRateXofPerSqm: "901" },
    ]) {
      expect(() =>
        parseCimacMaintenance(
          { ...cimacRequest(), operations: [{ ...terms, ...changes }] },
          "2026-10-24",
        ),
      ).toThrow();
    }
    const area = {
      type: "area",
      unitNo: "1704",
      customerName: "周楠楠",
      annotation,
      areaSqm: "57.75",
      propertyRateXofPerSqm: "900",
    };
    for (const changes of [
      { unitNo: "仓库" },
      { unitNo: "17" },
      { unitNo: "17040" },
      { areaSqm: "100000000" },
      { propertyRateXofPerSqm: "800" },
    ]) {
      expect(() =>
        parseCimacMaintenance(
          { ...cimacRequest(), operations: [{ ...area, ...changes }] },
          "2026-10-24",
        ),
      ).toThrow();
    }
    expect(() =>
      parseCimacMaintenance({ ...cimacRequest(), operations: [terms, terms] }, "2026-10-24"),
    ).toThrow();
    expect(() =>
      parseCimacMaintenance({ ...cimacRequest(), operations: [area, area] }, "2026-10-24"),
    ).toThrow();
  });
});

describe("CIMAC result evidence", () => {
  it("verifies native original-currency receipt without inventing XOF", () => {
    expect(verifyCimacMaintenanceResult(cimacResult(), cimacRequest(), cimacIds.actor)).toBe(true);
  });
  it.each([
    { actorId: cimacIds.unit },
    { requestId: cimacIds.unit },
    { operationCount: 0 },
    { auditId: null },
    { payments: [] },
    { operationResults: [] },
    { verified: false },
    { paymentIds: [] },
  ])("rejects missing or mismatched evidence %j", (change) => {
    expect(
      verifyCimacMaintenanceResult({ ...cimacResult(), ...change }, cimacRequest(), cimacIds.actor),
    ).toBe(false);
  });
  it.each([
    "receivablesCreated",
    "originalPaymentsPreserved",
    "contractsMatch",
    "unitsMatch",
    "paymentsMatch",
    "ledgerMatch",
    "auditMatch",
    "paymentCount",
    "ledgerCount",
  ])("checks independent reconciliation %s", (key) => {
    const value = cimacResult();
    Object.assign(value.reconciliation, {
      [key]:
        key === "receivablesCreated"
          ? 1
          : typeof value.reconciliation[key as keyof typeof value.reconciliation] === "number"
            ? 2
            : false,
    });
    expect(verifyCimacMaintenanceResult(value, cimacRequest(), cimacIds.actor)).toBe(false);
  });
  it.each([
    { amount: "2000" },
    { ledgerAmountXof: "160000.00" },
    { exchangeRateToXof: "80" },
    { nativeSettlement: false },
    { recordedBy: cimacIds.unit },
    { sourceId: cimacIds.unit },
    { ledgerDirection: "liability_out" },
    { ledgerAmountNative: "2001.00" },
  ])("rejects altered currency or ledger evidence %j", (changes) => {
    const value = cimacResult();
    Object.assign(value.payments[0], changes);
    expect(verifyCimacMaintenanceResult(value, cimacRequest(), cimacIds.actor)).toBe(false);
  });
  function refundedResult() {
    const input = cimacRequest([
      {
        type: "close",
        contractIds: [cimacIds.contract],
        customerName: "胡建初",
        annotation,
        refund: {
          amount: "75000.00",
          currency: "CNY",
          paymentDate: "2026-10-20",
          paymentMethod: "bank_transfer",
          originalPaymentIds: [cimacIds.payment],
        },
      },
    ]);
    const value = {
      ...cimacResult(),
      request: input,
      paymentIds: [cimacIds.refund],
      operationResults: [
        {
          type: "close",
          contractIds: [cimacIds.contract],
          unitIds: [cimacIds.unit],
          paymentIds: [cimacIds.refund],
        },
      ],
      payments: [
        {
          ...cimacResult().payments[0],
          id: cimacIds.refund,
          ledgerId: cimacIds.refundLedger,
          paymentType: "lease_deposit_refund",
          amount: "75000.00",
          paymentDate: "2026-10-20",
          nativeSettlement: false,
          exchangeRateToXof: "79.200000" as string | null,
          ledgerCurrency: "XOF",
          ledgerAmountXof: "5940000.00",
          ledgerAmountNative: null as string | null,
          ledgerDirection: "liability_out",
          originalPayments: [
            {
              id: cimacIds.payment,
              amount: "75000.00",
              currency: "CNY",
              nativeSettlement: false,
              exchangeRateToXof: "79.2" as string | null,
            },
          ],
        },
      ],
    };
    return { input, value };
  }
  it("keeps original converted CNY refund rate and XOF liability without current FX", () => {
    const { input, value } = refundedResult();
    expect(verifyCimacMaintenanceResult(value, input, cimacIds.actor)).toBe(true);
  });
  it.each([
    "rate",
    "original-id",
    "original-amount",
    "ledger-currency",
    "ledger-amount",
    "source",
    "request",
  ])("rejects changed historical refund %s", (change) => {
    const { input, value } = refundedResult();
    const payment = value.payments[0];
    if (change === "rate") payment.exchangeRateToXof = "80";
    if (change === "original-id") payment.originalPayments[0].id = cimacIds.unit;
    if (change === "original-amount") payment.originalPayments[0].amount = "74999.00";
    if (change === "ledger-currency") payment.ledgerCurrency = "CNY";
    if (change === "ledger-amount") payment.ledgerAmountXof = "5940000.01";
    if (change === "source") payment.sourceId = cimacIds.unit;
    if (change === "request")
      value.request = { ...input, originalInstruction: "different instruction" };
    expect(verifyCimacMaintenanceResult(value, input, cimacIds.actor)).toBe(false);
  });
  it("also preserves an already-native CNY deposit when refunded", () => {
    const { input, value } = refundedResult();
    const payment = value.payments[0];
    payment.nativeSettlement = true;
    payment.exchangeRateToXof = null;
    payment.ledgerAmountXof = "0.00";
    payment.ledgerAmountNative = "75000.00";
    payment.ledgerCurrency = "CNY";
    payment.originalPayments[0].nativeSettlement = true;
    payment.originalPayments[0].exchangeRateToXof = null;
    expect(verifyCimacMaintenanceResult(value, input, cimacIds.actor)).toBe(true);
  });
});
