import type {
  OwnerSettlement,
  OwnerSettlementContext,
  OwnerSettlementInput,
} from "../../src/features/asset-operations/owner-settlement-model";

export const ownerAssetId = "11111111-1111-4111-8111-111111111111";
export const ownerRequestId = "22222222-2222-4222-8222-222222222222";
export const ownerActorId = "33333333-3333-4333-8333-333333333333";
export const ownerEntryId = "44444444-4444-4444-8444-444444444444";
export function ownerInput(): OwnerSettlementInput {
  return {
    assetId: ownerAssetId,
    expectedUpdatedAt: "2026-11-01T00:00:00+00:00",
    expectedEvidenceHash: "a".repeat(32),
    ownerName: "测试业主甲",
    shareBps: 2500,
    amountNative: 5_000_000,
    currency: "XOF",
    cashDate: "2026-11-12",
    paymentMethod: "cash",
    periodStart: "2026-01-01",
    periodEnd: "2026-07-31",
    openingWholeCredit: 1_000_000,
    closingWholeCredit: 0,
    sourceRef: "synthetic-receipt:owner-share-001",
    reason: "测试整厂股比分账及旧结余核销",
  };
}
export function ownerSettlement(): OwnerSettlement {
  const input = ownerInput();
  return {
    requestId: ownerRequestId,
    entryId: ownerEntryId,
    ownerName: input.ownerName,
    shareBps: input.shareBps,
    receiptAmountNative: input.amountNative,
    currency: "XOF",
    cashDate: input.cashDate,
    paymentMethod: input.paymentMethod,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    throughDate: input.periodEnd,
    monthlyRentNative: 3_000_000,
    monthCount: 7,
    wholeEquivalent: 20_000_000,
    wholeOpeningCredit: input.openingWholeCredit,
    wholeRent: 21_000_000,
    wholeClosingCredit: input.closingWholeCredit,
    sourceRef: input.sourceRef,
    reason: input.reason,
    recordedBy: ownerActorId,
    recordedAt: "2026-11-13T08:00:00+00:00",
  };
}
export function ownerContext(): OwnerSettlementContext {
  const input = ownerInput();
  return {
    assetId: ownerAssetId,
    assetName: "测试整体厂房",
    expectedUpdatedAt: input.expectedUpdatedAt,
    expectedEvidenceHash: input.expectedEvidenceHash,
    monthlyRentNative: 3_000_000,
    currency: "XOF",
    previousSettlement: null,
  };
}
export function ownerResult() {
  return {
    success: true,
    data: { assetId: ownerAssetId, entryId: ownerEntryId, ownerSettlement: ownerSettlement() },
    idempotent: false,
  };
}
