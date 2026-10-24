import { describe, expect, it } from "vitest";
import {
  decodeCimacWriteReceipt,
  decodeCimacWriteResult,
  parseCimacCollectionInput,
  parseCimacFeeTermInput,
  parseCimacMeterReadingInput,
} from "@/features/finance/cimac-billing-service";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stamp = "2026-01-01T12:00:00.123456+00:00";
const collection = (extra: Record<string, unknown> = {}) => ({
  requestId: id(1),
  customerId: id(2),
  paymentDate: "2026-01-01",
  currency: "XOF",
  amount: "640000",
  paymentMethod: "bank_transfer",
  allocations: [
    {
      receivableId: id(3),
      amount: "600000",
      expectedOutstanding: "600000",
      expectedUpdatedAt: stamp,
    },
    {
      receivableId: id(4),
      amount: "40000",
      expectedOutstanding: "40000",
      expectedUpdatedAt: stamp,
    },
  ],
  ...extra,
});
const fee = (extra: Record<string, unknown> = {}) => ({
  requestId: id(1),
  customerId: id(2),
  contractId: id(10),
  unitId: id(11),
  category: "property_fee",
  currency: "XOF",
  monthlyRate: "900",
  pricingBasis: "per_sqm",
  chargeableArea: "173",
  annualStartsOn: "2027-04-01",
  annualEndsOn: "2028-03-31",
  proration: "daily_pending_convention",
  source: "合同与已确认标准，起算日待核",
  ...extra,
});
const meter = (extra: Record<string, unknown> = {}) => ({
  requestId: id(1),
  customerId: id(2),
  contractId: id(10),
  unitId: id(11),
  meterKind: "water",
  meterNo: "W-1",
  serviceMonth: "2026-01-01",
  readOn: "2026-01-31",
  previousReading: "10.125",
  currentReading: "12.325",
  ...extra,
});
const proof = (extra: Record<string, unknown> = {}) => ({
  success: true,
  status: "completed",
  kind: "collection",
  requestId: id(1),
  actorId: id(8),
  customerId: id(2),
  entityId: id(5),
  auditId: id(9),
  idempotent: false,
  paymentId: id(5),
  receiptNo: "TEST-CIMAC-01",
  amount: "640000",
  currency: "XOF",
  allocations: [
    { paymentId: id(5), receivableId: id(3), amount: "600000", currency: "XOF" },
    { paymentId: id(5), receivableId: id(4), amount: "40000", currency: "XOF" },
  ],
  ...extra,
});
const termRecord = (extra: Record<string, unknown> = {}) => ({
  id: id(5),
  customerId: id(2),
  contractId: id(10),
  unitId: id(11),
  category: "property_fee",
  status: "pending_review",
  monthlyRate: "900",
  pricingBasis: "per_sqm",
  chargeableArea: "173",
  currency: "XOF",
  startsOn: null,
  endsOn: null,
  annualStartsOn: "2027-04-01",
  annualEndsOn: "2028-03-31",
  proration: "daily_pending_convention",
  source: "合同与已确认标准，起算日待核",
  notes: null,
  updatedAt: stamp,
  createdAt: stamp,
  recordedBy: id(8),
  ...extra,
});
const meterRecord = (extra: Record<string, unknown> = {}) => ({
  id: id(5),
  customerId: id(2),
  contractId: id(10),
  unitId: id(11),
  meterKind: "water",
  meterNo: "W-1",
  serviceMonth: "2026-01-01",
  readOn: "2026-01-31",
  previousReading: "10.125",
  currentReading: "12.325",
  usage: "2.2",
  evidence: null,
  notes: null,
  status: "recorded_pending_rate",
  updatedAt: stamp,
  createdAt: stamp,
  recordedBy: id(8),
  ...extra,
});
const recordProof = (kind: "fee_terms" | "meter_reading", record: unknown) => {
  const {
    paymentId: _paymentId,
    receiptNo: _receiptNo,
    amount: _amount,
    currency: _currency,
    allocations: _allocations,
    ...base
  } = proof();
  return { ...base, kind, record };
};

describe("actual collection parsing", () => {
  it("uses exact decimal strings and preserves explicit allocations without guessing collector or coverage", () => {
    expect(parseCimacCollectionInput(collection())).toEqual(collection());
    const result = parseCimacCollectionInput(
      collection({
        amount: "0640000.00",
        actualCollector: " 黄姐 ",
        collectorBasis: " 收据明确记载 ",
        externalReceiptNo: " R-1 ",
        notes: " 已实收 ",
      }),
    );
    expect(result).toMatchObject({
      amount: "640000",
      actualCollector: "黄姐",
      collectorBasis: "收据明确记载",
      externalReceiptNo: "R-1",
      notes: "已实收",
    });
    expect(result).not.toHaveProperty("exchangeRate");
    expect(result).not.toHaveProperty("paidThroughDate");
  });

  it.each([
    { requestId: "bad" },
    { customerId: "bad" },
    { paymentDate: "2026-02-30" },
    { paymentDate: "0000-01-01" },
    { paymentDate: "2099-01-01" },
    { amount: 640000 },
    { amount: "0" },
    { amount: "-1" },
    { amount: "NaN" },
    { amount: "Infinity" },
    { amount: "6.4e5" },
    { amount: " 640000 " },
    { amount: "640000.01" },
    { amount: "640000.0001" },
    { amount: "1000000000000" },
    { amount: "640001" },
    { currency: "USD" },
    { currency: "CNY" },
    { currency: ["XOF"] },
    { paymentMethod: "offset" },
    { paymentMethod: ["cash"] },
    { allocations: [] },
    { allocations: new Array(101).fill(collection().allocations[0]) },
    { allocations: [{ ...collection().allocations[0], amount: "640000" }] },
    {
      allocations: [
        {
          ...collection().allocations[0],
          amount: "640000",
          expectedOutstanding: "640000",
          expectedUpdatedAt: undefined,
        },
      ],
    },
    {
      allocations: [
        {
          ...collection().allocations[0],
          amount: "640000",
          expectedOutstanding: "640000",
          expectedUpdatedAt: "2026-02-30T00:00:00Z",
        },
      ],
    },
    {
      allocations: [
        {
          ...collection().allocations[0],
          amount: "640000",
          expectedOutstanding: "640000",
          expectedUpdatedAt: "2026-01-01T24:00:00Z",
        },
      ],
    },
    {
      allocations: [
        {
          ...collection().allocations[0],
          amount: "640000",
          expectedOutstanding: "640000",
          category: "lease_deposit",
        },
      ],
    },
    { actualCollector: "黄姐" },
    { collectorBasis: "收据" },
    { actualCollector: "x".repeat(101), collectorBasis: "收据" },
    { actualCollector: "黄姐", collectorBasis: "x".repeat(1001) },
    { externalReceiptNo: "x".repeat(201) },
    { notes: "x".repeat(2001) },
    { notes: "bad\0text" },
    { recordedBy: id(6) },
    { exchangeRate: "650" },
    { coverage: { throughDate: "2027-01-01" } },
    { createReceivable: true },
  ])("refuses malformed or unsupported input %#", (extra) => {
    expect(() => parseCimacCollectionInput(collection(extra))).toThrow("invalidCimacBilling");
  });

  it("rejects duplicate targets and requires exact allocation sum, not floating tolerances", () => {
    expect(() =>
      parseCimacCollectionInput(
        collection({
          allocations: [
            { ...collection().allocations[0], amount: "320000" },
            { ...collection().allocations[0], amount: "320000" },
          ],
        }),
      ),
    ).toThrow();
    const large = collection({
      amount: "999999999999",
      allocations: [
        {
          receivableId: id(3),
          amount: "999999999998",
          expectedOutstanding: "999999999998",
          expectedUpdatedAt: stamp,
        },
        { receivableId: id(4), amount: "1", expectedOutstanding: "1", expectedUpdatedAt: stamp },
      ],
    });
    expect(parseCimacCollectionInput(large).amount).toBe("999999999999");
    expect(() => parseCimacCollectionInput({ ...large, amount: "999999999998" })).toThrow();
  });

  it("preserves historical fractional XOF balance evidence while collecting only integer XOF", () => {
    const input = parseCimacCollectionInput(
      collection({
        allocations: [
          {
            receivableId: id(3),
            amount: "640000",
            expectedOutstanding: "640000.50",
            expectedUpdatedAt: stamp,
          },
        ],
      }),
    );
    expect(input.allocations[0]).toMatchObject({
      amount: "640000",
      expectedOutstanding: "640000.5",
    });
  });

  it("refuses non-object or non-plain transport inputs", () => {
    for (const value of [null, undefined, [], "input", 1, new Date(), new Map()])
      expect(() => parseCimacCollectionInput(value)).toThrow();
  });
});

describe("pending fee evidence", () => {
  it("preserves unresolved dates and conventions without inventing an obligation", () => {
    expect(parseCimacFeeTermInput(fee())).toEqual(fee());
    const result = parseCimacFeeTermInput(
      fee({
        monthlyRate: null,
        chargeableArea: null,
        startsOn: null,
        endsOn: null,
        notes: " ",
        source: "  待核合同  ",
      }),
    );
    expect(result.source).toBe("待核合同");
    for (const key of [
      "monthlyRate",
      "chargeableArea",
      "startsOn",
      "endsOn",
      "notes",
      "amount",
      "status",
    ])
      expect(result).not.toHaveProperty(key);
  });

  it.each(["USD", "CNY"])("retains %s as native currency and never calculates FX", (currency) => {
    expect(parseCimacFeeTermInput(fee({ currency, monthlyRate: "60.25" }))).toMatchObject({
      currency,
      monthlyRate: "60.25",
    });
  });

  it("requires both optimistic revision fields to update existing evidence", () => {
    expect(parseCimacFeeTermInput(fee({ id: id(5), expectedUpdatedAt: stamp }))).toMatchObject({
      id: id(5),
      expectedUpdatedAt: stamp,
    });
    expect(() => parseCimacFeeTermInput(fee({ id: id(5) }))).toThrow();
    expect(() => parseCimacFeeTermInput(fee({ expectedUpdatedAt: stamp }))).toThrow();
  });

  it.each([
    { category: "tax" },
    { currency: "EUR" },
    { status: "confirmed" },
    { pricingBasis: "free" },
    { proration: "actual_days" },
    { startsOn: "2026-02-30" },
    { startsOn: "2028-01-01", endsOn: "2027-01-01" },
    { annualStartsOn: "2028-04-01", annualEndsOn: "2028-03-31" },
    { monthlyRate: "0" },
    { monthlyRate: "-900" },
    { monthlyRate: "900.001" },
    { monthlyRate: 900 },
    { chargeableArea: "0" },
    { chargeableArea: "173.0001" },
    { source: "" },
    { source: "x".repeat(1001) },
    { source: "bad\0source" },
    { createReceivables: true },
    { unitId: "bad" },
    { requestId: "bad" },
  ])("refuses unreviewed mutations and invalid fee evidence %#", (extra) => {
    expect(() => parseCimacFeeTermInput(fee(extra))).toThrow("invalidCimacBilling");
  });
});

describe("meter readings without rates", () => {
  it("accepts zero/current-only readings and does not fabricate prior consumption or price", () => {
    expect(parseCimacMeterReadingInput(meter())).toEqual(meter());
    const result = parseCimacMeterReadingInput(
      meter({ previousReading: null, currentReading: "0.000", evidence: "  表照  " }),
    );
    expect(result.currentReading).toBe("0");
    expect(result.evidence).toBe("表照");
    for (const key of ["previousReading", "usage", "rate", "amount", "status"])
      expect(result).not.toHaveProperty(key);
  });

  it.each([
    { meterKind: "gas" },
    { meterNo: "" },
    { meterNo: "x".repeat(101) },
    { serviceMonth: "2026-01" },
    { serviceMonth: "2026-01-02" },
    { serviceMonth: "2026-13-01" },
    { serviceMonth: "0000-01-01" },
    { readOn: "2025-12-31" },
    { readOn: "2099-01-01" },
    { readOn: "2026-02-30" },
    { currentReading: "10.124" },
    { currentReading: "12.3251" },
    { currentReading: 12.325 },
    { currentReading: "-1" },
    { currentReading: "1e3" },
    { previousReading: "NaN" },
    { previousReading: "1000000000000" },
    { amount: "1000" },
    { unitPrice: "50" },
    { usage: "2.2" },
    { status: "billed" },
    { id: id(5) },
    { expectedUpdatedAt: stamp },
  ])("requires real bounded readings and never accepts a bill %#", (extra) => {
    expect(() => parseCimacMeterReadingInput(meter(extra))).toThrow("invalidCimacBilling");
  });
});

describe("independently verified receipts", () => {
  it("validates persisted collection facts against the original customer, actor and allocation", () => {
    expect(decodeCimacWriteReceipt(proof(), id(1))).toEqual(proof());
    expect(
      decodeCimacWriteResult(
        proof({ idempotent: true }),
        parseCimacCollectionInput(collection()),
        "collection",
        id(8),
      ),
    ).toEqual(proof({ idempotent: true }));
  });

  it.each([
    { success: false },
    { status: "pending" },
    { requestId: id(20) },
    { actorId: "bad" },
    { customerId: "bad" },
    { entityId: id(21) },
    { auditId: undefined },
    { idempotent: "true" },
    { kind: "another_operation" },
    { currency: "USD" },
    { amount: "640000.01" },
    { amount: 640000 },
    { receiptNo: "" },
    { allocations: [] },
    { allocations: [proof().allocations[0]] },
    { allocations: [{ ...proof().allocations[0], paymentId: id(22), amount: "640000" }] },
    { allocations: [{ ...proof().allocations[0], currency: "CNY", amount: "640000" }] },
    {
      allocations: [
        { ...proof().allocations[0], amount: "320000" },
        { ...proof().allocations[0], amount: "320000" },
      ],
    },
  ])("does not turn malformed success %# into proof", (extra) => {
    expect(() => decodeCimacWriteReceipt(proof(extra), id(1))).toThrow("invalidCimacBilling");
  });

  it.each([
    { customerId: id(20) },
    { actorId: id(20) },
    { amount: "640001", allocations: [{ ...proof().allocations[0], amount: "640001" }] },
    { allocations: [{ ...proof().allocations[0], receivableId: id(20), amount: "640000" }] },
  ])("refuses a valid but mismatched operation %#", (extra) => {
    expect(() =>
      decodeCimacWriteResult(
        proof(extra),
        parseCimacCollectionInput(collection()),
        "collection",
        id(8),
      ),
    ).toThrow();
  });

  it("requires fee records to remain pending and match the submitted contract/rules", () => {
    const result = recordProof("fee_terms", termRecord());
    expect(
      decodeCimacWriteResult(result, parseCimacFeeTermInput(fee()), "fee_terms", id(8)),
    ).toEqual(result);
    for (const extra of [
      { status: "confirmed" },
      { recordedBy: id(20) },
      { customerId: id(20) },
      { id: id(20) },
    ])
      expect(() =>
        decodeCimacWriteReceipt(recordProof("fee_terms", termRecord(extra)), id(1)),
      ).toThrow();
    expect(() =>
      decodeCimacWriteResult(
        recordProof("fee_terms", termRecord({ contractId: id(20) })),
        parseCimacFeeTermInput(fee()),
        "fee_terms",
        id(8),
      ),
    ).toThrow();
  });

  it("never accepts invented optional fee dates or meter baselines that were left unresolved", () => {
    expect(() =>
      decodeCimacWriteResult(
        recordProof("fee_terms", termRecord({ startsOn: "2027-04-01" })),
        parseCimacFeeTermInput(fee()),
        "fee_terms",
        id(8),
      ),
    ).toThrow();
    expect(() =>
      decodeCimacWriteResult(
        recordProof("meter_reading", meterRecord()),
        parseCimacMeterReadingInput(meter({ previousReading: null })),
        "meter_reading",
        id(8),
      ),
    ).toThrow();
    expect(() =>
      decodeCimacWriteReceipt(recordProof("fee_terms", termRecord({ startsOn: undefined })), id(1)),
    ).toThrow();
    expect(() =>
      decodeCimacWriteReceipt(
        recordProof("meter_reading", meterRecord({ notes: undefined })),
        id(1),
      ),
    ).toThrow();
  });

  it("verifies exact consumed usage and never accepts a charged/billed meter result", () => {
    const result = recordProof("meter_reading", meterRecord());
    expect(
      decodeCimacWriteResult(result, parseCimacMeterReadingInput(meter()), "meter_reading", id(8)),
    ).toEqual(result);
    for (const extra of [
      { usage: "2.201" },
      { usage: null },
      { status: "billed" },
      { currentReading: "10" },
    ])
      expect(() =>
        decodeCimacWriteReceipt(recordProof("meter_reading", meterRecord(extra)), id(1)),
      ).toThrow();
    const currentOnly = recordProof(
      "meter_reading",
      meterRecord({ previousReading: null, usage: null }),
    );
    expect(decodeCimacWriteReceipt(currentOnly, id(1)).record).toMatchObject({
      previousReading: null,
      usage: null,
    });
    expect(() =>
      decodeCimacWriteReceipt(
        recordProof("meter_reading", meterRecord({ previousReading: null })),
        id(1),
      ),
    ).toThrow();
  });
});
