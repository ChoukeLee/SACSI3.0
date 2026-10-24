import { describe, expect, it } from "vitest";
import {
  decodeCimacCollectionAdjustment,
  decodeCimacCollectionPosition,
  decodeCimacWriteReceipt,
  decodeCimacWriteResult,
  parseCimacRefundInput,
  parseCimacReversalInput,
} from "@/features/finance/cimac-billing-service";
import {
  adjustmentHistory,
  adjustmentId as id,
  adjustmentPosition,
  adjustmentProof,
  refundInput,
  reversalInput,
} from "./fixtures/cimac-adjustments";

describe("explicit actual-refund and noncash full reversal input boundaries", () => {
  it("preserves original identity, exact snapshots and positive allocation amounts", () => {
    expect(parseCimacRefundInput(refundInput())).toEqual(refundInput());
    expect(parseCimacReversalInput(reversalInput())).toEqual(reversalInput());
    const normalized = parseCimacRefundInput({
      ...refundInput(),
      amount: "020.00",
      reason: " 已退款 ",
      externalReceiptNo: " R-1 ",
      notes: " 依据 ",
    });
    expect(normalized).toMatchObject({
      amount: "20",
      reason: "已退款",
      externalReceiptNo: "R-1",
      notes: "依据",
    });
    expect(normalized.allocations[0].expectedPaid).toBe("80.5");
  });
  it.each([
    { requestId: "bad" },
    { originalPaymentId: "bad" },
    { customerId: "bad" },
    { currency: "USD" },
    { currency: "CNY" },
    { amount: 20 },
    { amount: "0" },
    { amount: "-20" },
    { amount: "20.01" },
    { amount: "1e2" },
    { amount: "1000000000000" },
    { amount: "21" },
    { reason: "" },
    { reason: "x".repeat(1001) },
    { reason: "x\0y" },
    { expectedPositionToken: "bad" },
    { expectedPositionToken: "a".repeat(33) },
    { paymentDate: "2026-02-30" },
    { paymentDate: "2099-01-01" },
    { paymentMethod: "offset" },
    { paymentMethod: null },
    { externalReceiptNo: "x".repeat(201) },
    { notes: "x".repeat(2001) },
    { allocations: [] },
    { allocations: Array.from({ length: 101 }, () => refundInput().allocations[0]) },
    { actorId: id(8) },
    { exchangeRate: 1 },
    { waiveDebt: true },
    { createPayment: true },
  ])("rejects unsupported, ambiguous or invented actual refund content %#", (patch) => {
    expect(() => parseCimacRefundInput({ ...refundInput(), ...patch })).toThrow();
  });
  it.each([
    { receivableId: "bad" },
    { amount: "81" },
    { amount: "80.5" },
    { amount: "0" },
    { expectedRemaining: "19" },
    { expectedRemaining: "0" },
    { expectedPaid: "19.99" },
    { expectedPaid: null },
    { expectedUpdatedAt: undefined },
    { expectedUpdatedAt: "not-a-date" },
    { autoAllocate: true },
  ])("checks every explicit allocation and optimistic snapshot %#", (patch) => {
    expect(() =>
      parseCimacRefundInput({
        ...refundInput(),
        allocations: [{ ...refundInput().allocations[0], ...patch }],
      }),
    ).toThrow();
  });
  it("rejects duplicate bill allocation instead of silently merging or doubling it", () => {
    const a = refundInput().allocations[0];
    expect(() =>
      parseCimacRefundInput({ ...refundInput(), amount: "40", allocations: [a, a] }),
    ).toThrow();
  });
  it.each([
    { paymentDate: "2026-01-01" },
    { paymentMethod: "cash" },
    { externalReceiptNo: "x" },
    { amount: "80" },
    { allocations: [{ ...reversalInput().allocations[0], amount: "79" }] },
  ])("full reversal never accepts a client cash date/method or partial allocation %#", (patch) => {
    expect(() => parseCimacReversalInput({ ...reversalInput(), ...patch })).toThrow();
  });
});

describe("verified refund position and immutable correction chain", () => {
  it.each([undefined, "refund", "reversal"] as const)(
    "reconciles original facts, explicit pieces, history and current paid balance %s",
    (kind) => {
      const p = adjustmentPosition(kind);
      expect(decodeCimacCollectionPosition(p, id(2))).toEqual(p);
    },
  );
  it.each([
    { originalPaymentId: id(99) },
    { customerId: "bad" },
    { currency: "USD" },
    { originalAmount: "101" },
    { refundedAmount: "1" },
    { reversedAmount: "1" },
    { remainingAmount: "99" },
    { positionToken: "short" },
    { originalPaymentDate: "2099-01-01" },
    { originalPaymentMethod: "offset" },
    { allocations: [] },
    { canRefund: "true" },
    { canReverse: 1 },
  ])("does not infer a safe position from inconsistent metadata %#", (patch) => {
    expect(() =>
      decodeCimacCollectionPosition({ ...adjustmentPosition(), ...patch }, id(2)),
    ).toThrow();
  });
  it.each([
    { remainingAmount: "79" },
    { refundedAmount: "1" },
    { reversedAmount: "1" },
    { originalAmount: "81" },
    { paidAmount: "79.99" },
    { receivableId: "bad" },
    { contractId: "bad" },
    { unitId: "bad" },
    { updatedAt: "bad" },
  ])("enforces per-target conservation and paid balance %#", (patch) => {
    const p = adjustmentPosition();
    Object.assign(p.allocations[0], patch);
    expect(() => decodeCimacCollectionPosition(p, id(2))).toThrow();
  });
  it("requires every history amount to agree with the per-target position, not only the header total", () => {
    const p = adjustmentPosition("refund");
    p.adjustments[0].allocations[0].receivableId = id(5);
    expect(() => decodeCimacCollectionPosition(p, id(2))).toThrow();
  });
  it("never permits reversal after a partial actual refund or refund after reversal", () => {
    expect(() =>
      decodeCimacCollectionPosition({ ...adjustmentPosition("refund"), canReverse: true }, id(2)),
    ).toThrow();
    expect(() =>
      decodeCimacCollectionPosition({ ...adjustmentPosition("reversal"), canRefund: true }, id(2)),
    ).toThrow();
  });
  it("rejects a hidden or duplicated historical correction", () => {
    const p = adjustmentPosition("refund");
    expect(() => decodeCimacCollectionPosition({ ...p, adjustments: [] }, id(2))).toThrow();
    expect(() =>
      decodeCimacCollectionPosition(
        { ...p, adjustments: [...p.adjustments, ...p.adjustments] },
        id(2),
      ),
    ).toThrow();
  });
  it.each([
    { originalPaymentId: id(99) },
    { paymentDate: "2025-12-31", effectiveDate: "2025-12-31" },
    { paymentDate: "2099-01-01", effectiveDate: "2099-01-01" },
    { amount: "21" },
    { recordedBy: "bad" },
    { auditId: "bad" },
    { requestId: "bad" },
    { paymentMethod: "offset" },
    { currency: "CNY" },
    { paymentId: id(2) },
  ])("requires linked history identity, actual date, audit and currency %#", (patch) => {
    const p = adjustmentPosition("refund");
    Object.assign(p.adjustments[0], patch);
    expect(() => decodeCimacCollectionPosition(p, id(2))).toThrow();
  });
  it("requires actual refund and noncash reversal histories to keep different payment methods", () => {
    expect(decodeCimacCollectionAdjustment(adjustmentHistory("refund")).paymentMethod).toBe(
      "bank_transfer",
    );
    expect(decodeCimacCollectionAdjustment(adjustmentHistory("reversal")).paymentMethod).toBe(
      "offset",
    );
    expect(() =>
      decodeCimacCollectionAdjustment({
        ...adjustmentHistory("reversal"),
        paymentMethod: "bank_transfer",
      }),
    ).toThrow();
  });
});

describe("independently recovered adjustment receipt proof", () => {
  it.each(["refund", "reversal"] as const)(
    "requires exact actor/customer/original/child/audit and allocation proof for %s",
    (kind) => {
      const input =
        kind === "refund"
          ? parseCimacRefundInput(refundInput())
          : parseCimacReversalInput(reversalInput());
      expect(decodeCimacWriteReceipt(adjustmentProof(kind), id(1))).toEqual(adjustmentProof(kind));
      expect(decodeCimacWriteResult(adjustmentProof(kind), input, kind, id(8))).toEqual(
        adjustmentProof(kind),
      );
    },
  );
  it.each([
    { requestId: id(99) },
    { actorId: id(99) },
    { customerId: id(99) },
    { originalPaymentId: id(99) },
    { auditId: "bad" },
    { entityId: id(99) },
    { amount: "21" },
    { currency: "USD" },
    { remainingBefore: "19" },
    { remainingAfter: "79" },
    { effectiveDate: "2026-01-03" },
    { paymentDate: "2099-01-01", effectiveDate: "2099-01-01" },
    { paymentMethod: "cash" },
    { kind: "reversal" },
    { originalPaymentId: id(7) },
  ])("malformed/mismatched success stays unknown, not a declared rejection %#", (patch) => {
    expect(() =>
      decodeCimacWriteResult(
        { ...adjustmentProof(), ...patch },
        parseCimacRefundInput(refundInput()),
        "refund",
        id(8),
      ),
    ).toThrow();
  });
  it("validates every child allocation ID and exact amount on direct and recovered receipts", () => {
    const p = adjustmentProof();
    p.allocations[0].paymentId = id(99);
    expect(() => decodeCimacWriteReceipt(p, id(1))).toThrow();
    p.allocations[0].paymentId = id(7);
    p.allocations[0].receivableId = id(99);
    expect(() =>
      decodeCimacWriteResult(p, parseCimacRefundInput(refundInput()), "refund", id(8)),
    ).toThrow();
  });
  it("does not accept a reversal success that did not clear the entire original position", () => {
    expect(() =>
      decodeCimacWriteReceipt(
        { ...adjustmentProof("reversal"), remainingBefore: "120", remainingAfter: "20" },
        id(1),
      ),
    ).toThrow();
    expect(() =>
      decodeCimacWriteReceipt(
        { ...adjustmentProof("reversal"), effectiveDate: "2026-01-02" },
        id(1),
      ),
    ).toThrow();
  });
});
