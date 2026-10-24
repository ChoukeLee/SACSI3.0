import type {
  CimacCollectionAdjustment,
  CimacCollectionPosition,
  CimacRefundInput,
  CimacReversalInput,
} from "@/features/finance/cimac-billing-types";
import type { CimacRequestInput } from "@/features/finance/cimac-billing-service";

export const adjustmentId = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const id = adjustmentId;
export const adjustmentStamp = "2026-01-02T12:00:00.123456+00:00";
export function refundInput(): CimacRequestInput<CimacRefundInput> {
  return {
    requestId: id(1),
    originalPaymentId: id(2),
    customerId: id(3),
    currency: "XOF",
    amount: "20",
    reason: "客户实际已退款",
    expectedPositionToken: "0123456789abcdef0123456789abcdef",
    paymentDate: "2026-01-02",
    paymentMethod: "bank_transfer",
    allocations: [
      {
        receivableId: id(4),
        amount: "20",
        expectedRemaining: "80",
        expectedPaid: "80.5",
        expectedUpdatedAt: adjustmentStamp,
      },
    ],
  };
}
export function reversalInput(): CimacRequestInput<CimacReversalInput> {
  const { paymentDate: _paymentDate, paymentMethod: _paymentMethod, ...common } = refundInput();
  return {
    ...common,
    amount: "100",
    reason: "整单录错，仅纠正账务",
    allocations: [
      {
        receivableId: id(4),
        amount: "80",
        expectedRemaining: "80",
        expectedPaid: "80.5",
        expectedUpdatedAt: adjustmentStamp,
      },
      {
        receivableId: id(5),
        amount: "20",
        expectedRemaining: "20",
        expectedPaid: "20",
        expectedUpdatedAt: adjustmentStamp,
      },
    ],
  };
}
export function adjustmentHistory(
  kind: "refund" | "reversal" = "refund",
): CimacCollectionAdjustment {
  return {
    id: id(6),
    requestId: id(1),
    paymentId: id(7),
    originalPaymentId: id(2),
    kind,
    paymentDate: kind === "refund" ? "2026-01-02" : "2026-01-01",
    effectiveDate: kind === "refund" ? "2026-01-02" : "2026-01-01",
    amount: kind === "refund" ? "20" : "100",
    currency: "XOF",
    paymentMethod: kind === "refund" ? "bank_transfer" : "offset",
    reason: "明确登记的纠错依据",
    recordedBy: id(8),
    auditId: id(9),
    receiptNo: "TEST-ADJUSTMENT-1",
    createdAt: adjustmentStamp,
    allocations:
      kind === "refund"
        ? [{ receivableId: id(4), amount: "20" }]
        : [
            { receivableId: id(4), amount: "80" },
            { receivableId: id(5), amount: "20" },
          ],
  };
}
export function adjustmentProof(kind: "refund" | "reversal" = "refund") {
  const a = adjustmentHistory(kind);
  return {
    success: true,
    status: "completed",
    kind,
    requestId: a.requestId,
    actorId: a.recordedBy,
    customerId: id(3),
    entityId: a.paymentId,
    paymentId: a.paymentId,
    auditId: a.auditId,
    idempotent: false,
    originalPaymentId: a.originalPaymentId,
    amount: a.amount,
    currency: "XOF",
    receiptNo: a.receiptNo,
    remainingBefore: "100",
    remainingAfter: kind === "refund" ? "80" : "0",
    paymentDate: a.paymentDate,
    effectiveDate: a.effectiveDate,
    paymentMethod: a.paymentMethod,
    allocations: a.allocations.map((l) => ({ ...l, paymentId: a.paymentId, currency: "XOF" })),
  };
}
export function adjustmentPosition(kind?: "refund" | "reversal"): CimacCollectionPosition {
  const refund = kind === "refund",
    reverse = kind === "reversal";
  return {
    originalPaymentId: id(2),
    customerId: id(3),
    currency: "XOF",
    originalPaymentDate: "2026-01-01",
    originalPaymentMethod: "cash",
    originalReceiptNo: "TEST-ORIGINAL",
    originalAmount: "100",
    refundedAmount: refund ? "20" : "0",
    reversedAmount: reverse ? "100" : "0",
    remainingAmount: reverse ? "0" : refund ? "80" : "100",
    positionToken: "0123456789abcdef0123456789abcdef",
    canRefund: !reverse,
    canReverse: !kind,
    allocations: [
      {
        receivableId: id(4),
        contractId: id(10),
        unitId: id(12),
        title: "租金",
        originalAmount: "80",
        refundedAmount: refund ? "20" : "0",
        reversedAmount: reverse ? "80" : "0",
        remainingAmount: reverse ? "0" : refund ? "60" : "80",
        paidAmount: reverse ? "0" : refund ? "60.5" : "80.5",
        updatedAt: adjustmentStamp,
      },
      {
        receivableId: id(5),
        contractId: id(11),
        unitId: id(13),
        title: "物业费",
        originalAmount: "20",
        refundedAmount: "0",
        reversedAmount: reverse ? "20" : "0",
        remainingAmount: reverse ? "0" : "20",
        paidAmount: reverse ? "0" : "20",
        updatedAt: adjustmentStamp,
      },
    ],
    adjustments: kind ? [adjustmentHistory(kind)] : [],
  };
}
