import { describe, expect, it } from "vitest";
import { parseCimacFinance } from "@/features/business-actions/cimac-finance";
import { verifyCimacFinanceResult } from "@/features/business-actions/cimac-finance-verification";
import {
  financeActorId,
  financeCompleted,
  financeRequest,
  financeId,
} from "./fixtures/cimac-finance";

const parse = (value: unknown) => parseCimacFinance(value, "2026-11-02");
describe("CIMAC finance request boundary", () => {
  it("accepts the explicit bounded operations without changing money or receipt facts", () => {
    expect(parse(financeRequest())).toEqual(financeRequest());
  });
  it.each([
    null,
    [],
    {},
    { ...financeRequest(), inputSource: "natural_language" },
    { ...financeRequest(), connectorVersion: "0.8.0" },
    { ...financeRequest(), table: "payments" },
    { ...financeRequest(), operations: [] },
  ])("rejects malformed envelope %#", (input) => {
    expect(() => parse(input)).toThrow("invalidCimacFinance");
  });
  it.each([
    null,
    [],
    { type: "sql", query: "update payments" },
    { ...financeRequest().operations[0], parts: [null] },
    { ...financeRequest().operations[0], receipt: null },
  ])("rejects malformed nested operation %#", (operation) => {
    expect(() => parse({ ...financeRequest(), operations: [operation] })).toThrow(
      "invalidCimacFinance",
    );
  });
  it.each(["0", "1.2", "01", "1e4", 500000, -1, null, "1000000000000"])(
    "requires positive integral XOF: %s",
    (amount) => {
      const input = financeRequest();
      if (input.operations[0].type === "collect")
        input.operations[0].parts[0].amountXof = amount as string;
      expect(() => parse(input)).toThrow("invalidCimacFinance");
    },
  );
  it("normalizes CNY decimals without FX and rejects same-source classification", () => {
    const input = financeRequest();
    if (input.operations[3].type !== "reclassify") throw new Error("fixture");
    input.operations[3].amountCny = "31875";
    expect(parse(input).operations[3]).toMatchObject({ amountCny: "31875.00" });
    input.operations[3].targetSourceType = "lease_rent";
    expect(() => parse(input)).toThrow();
  });
  it("normalizes an omitted property concession to explicit zero and requires a full annual period", () => {
    const input = financeRequest();
    const op = input.operations[2];
    if (op.type !== "collect") throw new Error("fixture");
    delete op.parts[0].discountXof;
    expect(parse(input).operations[2]).toMatchObject({ parts: [{ discountXof: "0" }] });
    Object.assign(op.parts[0], { discountXof: null });
    expect(() => parse(input)).toThrow();
    delete op.parts[0].discountXof;
    op.servicePeriod = { start: "2027-04-01", end: "2028-04-01" };
    expect(() => parse(input)).toThrow();
    op.servicePeriod = { start: "2028-02-29", end: "2029-02-27" };
    expect(() => parse(input)).not.toThrow();
  });
  it.each(["bank_transfer", "offset", "other"])(
    "rejects unsupported receipt method %s",
    (paymentMethod) => {
      const input = financeRequest();
      if (input.operations[0].type === "collect")
        input.operations[0].receipt.paymentMethod = paymentMethod as "cash";
      expect(() => parse(input)).toThrow();
    },
  );
  it("rejects invalid or future receipt dates and missing property periods", () => {
    const input = financeRequest();
    if (input.operations[0].type !== "collect") throw new Error("fixture");
    input.operations[0].receipt.paymentDate = "2026-02-30";
    expect(() => parse(input)).toThrow();
    input.operations[0].receipt.paymentDate = "2026-11-03";
    expect(() => parse(input)).toThrow();
    if (input.operations[2].type === "collect") delete input.operations[2].servicePeriod;
    input.operations[0].receipt.paymentDate = "2026-10-26";
    expect(() => parse(input)).toThrow();
  });
  it("rejects guessed splits, altered three-month prices, deposit discounts and unknown keys", () => {
    const mutations = [
      (r: ReturnType<typeof financeRequest>) => {
        if (r.operations[0].type === "collect") r.operations[0].parts[0].amountXof = "1";
      },
      (r: ReturnType<typeof financeRequest>) => {
        if (r.operations[1].type === "new_deposit") r.operations[1].units[0].depositXof = "1";
      },
      (r: ReturnType<typeof financeRequest>) => {
        if (r.operations[0].type === "collect") r.operations[0].parts[0].discountXof = "0";
      },
      (r: ReturnType<typeof financeRequest>) => {
        Object.assign(r.operations[0], { fields: { status: "paid" } });
      },
    ];
    for (const mutate of mutations) {
      const input = financeRequest();
      mutate(input);
      expect(() => parse(input)).toThrow();
    }
  });
  it("rejects duplicate operations, protected 231, holder/customer mismatch and empty identity actions", () => {
    const input = financeRequest();
    input.operations.push(input.operations[0]);
    expect(() => parse(input)).toThrow();
    input.operations.pop();
    const identity = input.operations[4];
    if (identity.type !== "identity") throw new Error("fixture");
    identity.units[0].unitNo = "231";
    expect(() => parse(input)).toThrow();
    identity.units[0].unitNo = "385";
    identity.holderName = "另一个人";
    expect(() => parse(input)).toThrow();
    delete identity.holderName;
    delete identity.managementNames;
    expect(() => parse(input)).toThrow();
  });
  it("rejects duplicate same-name new customers across different operations", () => {
    const input = financeRequest(),
      first = input.operations[1];
    if (first.type !== "new_deposit") throw new Error("fixture");
    first.customerName = "Synthetic Merchant";
    input.operations.push({
      ...first,
      customerName: "synthetic merchant",
      units: [{ ...first.units[0], unitNo: "384" }],
    });
    expect(() => parse(input)).toThrow("invalidCimacFinance");
  });
  it("caps operations, total parts and source text", () => {
    const input = financeRequest();
    input.operations = Array.from({ length: 31 }, (_, i) => ({
      type: "reclassify",
      paymentId: financeId(500 + i),
      expectedSourceType: "lease_rent",
      targetSourceType: "lease_deposit",
      amountCny: "1.00",
      annotation: "已确认",
    }));
    expect(() => parse(input)).toThrow();
    input.operations = Array.from({ length: 4 }, (_, i) => ({
      type: "collect",
      customerId: financeId(1000 + i),
      customerName: "商户",
      category: "lease_deposit",
      receipt: {
        amountXof: "30",
        paymentDate: "2026-10-26",
        paymentMethod: "cash",
        sourceText: "现金原表",
      },
      parts: Array.from({ length: 30 }, (_, j) => ({
        contractId: financeId(1100 + i * 30 + j),
        amountXof: "1",
      })),
      annotation: "确认",
    }));
    expect(() => parse(input)).toThrow();
    const source = financeRequest();
    if (source.operations[0].type === "collect")
      source.operations[0].receipt.sourceText = "a".repeat(2001);
    expect(() => parse(source)).toThrow();
  });
});

describe("CIMAC finance independent row proof", () => {
  it("verifies all operations, partial deposits, gross-discount property, and both classification directions", () => {
    const result = financeCompleted();
    expect(verifyCimacFinanceResult(result, financeRequest(), financeActorId)).toBe(true);
    expect(result.paymentIds).toHaveLength(3); // Reclassifications do not invent receipts.
  });
  it("preserves unknown historical methods and signed-but-unstarted existing contracts", () => {
    const result = financeCompleted();
    for (const reclass of result.verification.reclassifications) {
      Object.assign(reclass.paymentBefore, { payment_method: null });
      Object.assign(reclass.paymentAfter, { payment_method: null });
    }
    Object.assign(result.verification.depositPayments[3], { payment_method: null });
    Object.assign(result.verification.contracts[0], {
      signing_state: "signed",
      signed_date: "2026-05-01",
      paid_through_date: "2026-05-31",
    });
    result.verification.units[0].reservation_holder_name = "历史标签未变";
    expect(verifyCimacFinanceResult(result, financeRequest(), financeActorId)).toBe(true);
  });
  const mutations: Array<[string, (r: ReturnType<typeof financeCompleted>) => void]> = [
    [
      "bare check flags",
      (r) => {
        r.verification.payments = [];
      },
    ],
    [
      "wrong actor",
      (r) => {
        r.actorId = financeId(999);
      },
    ],
    [
      "wrong customer identity",
      (r) => {
        r.verification.customers[1].name = "其他测试人";
      },
    ],
    [
      "changed request",
      (r) => {
        r.request.originalInstruction = "different";
      },
    ],
    [
      "extra payment",
      (r) => {
        r.verification.payments.push({ ...r.verification.payments[0], id: financeId(999) });
      },
    ],
    [
      "cash amount",
      (r) => {
        r.verification.payments[0].amount++;
      },
    ],
    [
      "receipt number",
      (r) => {
        r.verification.payments[0].receipt_no = "纸质123";
      },
    ],
    [
      "invented collector",
      (r) => {
        Object.assign(r.verification.payments[0], { actual_collector: "操作人" });
      },
    ],
    [
      "missing historical flag funds",
      (r) => {
        r.verification.depositPayments.splice(2, 1);
        r.verification.depositLedger.splice(2, 1);
      },
    ],
    [
      "fake full partial deposit",
      (r) => {
        r.verification.contracts[1].deposit_received = true;
      },
    ],
    [
      "signed new lease",
      (r) => {
        Object.assign(r.verification.contracts[1], { start_date: "2026-10-26" });
      },
    ],
    [
      "new signing date",
      (r) => {
        Object.assign(r.verification.contracts[1], { signed_date: "2026-10-26" });
      },
    ],
    [
      "future paid through",
      (r) => {
        Object.assign(r.verification.contracts[1], { paid_through_date: "2028-06-30" });
      },
    ],
    [
      "rent instead of deposit",
      (r) => {
        r.verification.payments[1].source_type = "lease_rent";
      },
    ],
    [
      "wrong ledger category",
      (r) => {
        r.verification.ledger[0].category = "lease_rent";
      },
    ],
    [
      "gross billed instead of net",
      (r) => {
        r.verification.receivables[0].amount_xof = 691200;
      },
    ],
    [
      "wrong service period",
      (r) => {
        r.verification.receivables[0].service_period_end = "2028-04-30";
      },
    ],
    [
      "wrong allocation",
      (r) => {
        r.verification.allocations[0].amount_xof--;
      },
    ],
    [
      "reclass changed receipt",
      (r) => {
        r.verification.reclassifications[0].paymentAfter.receipt_no = "NEW";
      },
    ],
    [
      "reclass changed FX",
      (r) => {
        r.verification.reclassifications[0].paymentAfter.exchange_rate_to_xof = 81;
      },
    ],
    [
      "reclass changed notes",
      (r) => {
        r.verification.reclassifications[0].paymentAfter.notes = "new";
      },
    ],
    [
      "reclass changed ledger cash",
      (r) => {
        r.verification.reclassifications[0].ledgerAfter.amount_xof++;
      },
    ],
    [
      "reclass before cash omitted",
      (r) => {
        delete (
          r.verification.reclassifications[0].paymentBefore as Partial<
            (typeof r.verification.reclassifications)[0]["paymentBefore"]
          >
        ).receipt_no;
      },
    ],
    [
      "wrong holder",
      (r) => {
        r.verification.units[4].reservation_holder_name = "旧标签";
      },
    ],
    [
      "missing manager",
      (r) => {
        r.verification.units[4].notes = financeRequest().operations[4].annotation;
      },
    ],
    [
      "warehouse",
      (r) => {
        r.verification.units[0].asset_subtype = "warehouse";
      },
    ],
    [
      "excluded 231",
      (r) => {
        r.verification.units[0].unit_no = "231";
      },
    ],
    [
      "wrong audit",
      (r) => {
        r.verification.audit.requestId = financeId(999);
      },
    ],
  ];
  it.each(mutations)("rejects %s", (_, mutate) => {
    const result = financeCompleted();
    mutate(result);
    expect(verifyCimacFinanceResult(result, financeRequest(), financeActorId)).toBe(false);
  });
  it.each([null, [], {}, { verified: true }])("never accepts incomplete success %#", (result) => {
    expect(verifyCimacFinanceResult(result, financeRequest(), financeActorId)).toBe(false);
  });
});
