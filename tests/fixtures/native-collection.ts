import type { NativeCollectionRequest } from "@/features/business-actions/operator-native-collection";

export const nativeIds = {
  request: "11111111-1111-4111-8111-111111111111",
  contract: "22222222-2222-4222-8222-222222222222",
  receivable: "33333333-3333-4333-8333-333333333333",
  payment: "44444444-4444-4444-8444-444444444444",
  actor: "55555555-5555-4555-8555-555555555555",
  audit: "66666666-6666-4666-8666-666666666666",
};
export function nativeRequest(): NativeCollectionRequest {
  return {
    protocolVersion: "1.0",
    connectorVersion: "0.7.0",
    requestId: nativeIds.request,
    originalInstruction: "明确指令：登记合成长租原币租金收款，保留美元，不折算西法。",
    inputSource: "natural_language",
    contractId: nativeIds.contract,
    currency: "USD",
    amount: "100.25",
    paymentDate: "2026-10-22",
    paymentMethod: "bank_transfer",
    allocations: [{ receivableId: nativeIds.receivable, amount: "100.25" }],
  };
}
export function nativeResult() {
  return {
    status: "completed",
    verified: true,
    requestId: nativeIds.request,
    contractId: nativeIds.contract,
    currency: "USD",
    amount: "100.25",
    paymentIds: [nativeIds.payment],
    allocations: [
      { receivableId: nativeIds.receivable, amount: "100.25", paymentId: nativeIds.payment },
    ],
    paidThroughBefore: "2026-05-31",
    paidThroughAfter: "2026-05-31",
    verification: {
      version: 1,
      actorId: nativeIds.actor,
      checks: {
        payments: true,
        ledger: true,
        allocations: true,
        receivables: true,
        audit: true,
        xofUnchanged: true,
      },
      payments: [
        {
          id: nativeIds.payment,
          amount: "100.25",
          currency: "USD",
          nativeSettlement: true,
          exchangeRateToXof: null,
          recordedBy: nativeIds.actor,
        },
      ],
      ledger: [
        { paymentId: nativeIds.payment, amount: "100.25", currency: "USD", amountXof: "0.00" },
      ],
      allocations: [
        { receivableId: nativeIds.receivable, amount: "100.25", paymentId: nativeIds.payment },
      ],
      receivables: [
        {
          id: nativeIds.receivable,
          currency: "USD",
          amount: "200.25",
          paidBefore: "0.00",
          paidAfter: "100.25",
          amountXof: "0.00",
          paidAmountXof: "0.00",
        },
      ],
      audit: {
        id: nativeIds.audit,
        actorId: nativeIds.actor,
        requestId: nativeIds.request,
        channel: "external_codex",
        authorization: "explicit_instruction",
      },
    },
  };
}
