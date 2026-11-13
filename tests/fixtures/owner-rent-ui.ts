import type {
  OwnerRentAccount,
  OwnerRentBackfillInput,
} from "../../src/features/asset-operations/owner-rent-account-model";
import type {
  OperatingAssetDirectoryAsset,
  OperatingAssetDirectoryEntry,
} from "../../src/features/asset-operations/operating-asset-directory-model";
import { ownerActorId, ownerAssetId, ownerContext, ownerSettlement } from "./owner-settlement";

export const historyRequestId = "55555555-5555-4555-8555-555555555555";
const historyIds = [6, 7, 8, 9].map(
  (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
);
export function ownerRentUiSettlement() {
  return {
    ...ownerSettlement(),
    shareBps: 5000,
    monthlyRentNative: 3_500_000,
    monthCount: 3,
    periodStart: "2024-06-01",
    periodEnd: "2024-08-31",
    throughDate: "2024-08-31",
    wholeEquivalent: 10_000_000,
    wholeOpeningCredit: 500_000,
    wholeRent: 10_500_000,
  };
}
export function ownerRentUiInput(): OwnerRentBackfillInput {
  const context = ownerContext();
  return {
    assetId: ownerAssetId,
    expectedUpdatedAt: context.expectedUpdatedAt,
    expectedEvidenceHash: context.expectedEvidenceHash,
    expectedSettlementRequestId: ownerRentUiSettlement().requestId,
    rateSourceRef: "synthetic-rent.xlsx!F12",
    reason: "测试核对及更正说明：原表旧结余作为历史原文保留，已确认结算后的月份另行计算。",
    history: ["2019-10-01", "2020-03-01", "2022-01-01", "2024-02-01"].map((cashDate, index) => ({
      cashDate,
      amountNative: [3_500_000, 3_500_000, 7_000_000, 3_500_000][index],
      currency: "XOF",
      paymentMethod: null,
      sourceRef: `synthetic-history:${index + 1}`,
      sourceText: `  原表测试收款 ${index + 1}；历史结余 100  `,
    })),
  };
}
export function ownerRentUiAccount(): OwnerRentAccount {
  const input = ownerRentUiInput();
  return {
    version: 1,
    requestId: historyRequestId,
    ownerName: ownerRentUiSettlement().ownerName,
    shareBps: 5000,
    currency: "XOF",
    wholeMonthlyRentNative: 3_500_000,
    rateSourceRef: input.rateSourceRef,
    chargingRule: "full_calendar_month",
    history: input.history.map((row, index) => ({ ...row, entryId: historyIds[index] })),
    settlementEntryIds: [ownerRentUiSettlement().entryId],
    reason: input.reason,
    recordedBy: ownerActorId,
    recordedAt: "2026-11-13T10:00:00Z",
  };
}
export function ownerRentUiResult() {
  const ownerRentAccount = ownerRentUiAccount();
  return {
    success: true,
    data: {
      assetId: ownerAssetId,
      ownerRentAccount,
      entryIds: ownerRentAccount.history.map((row) => row.entryId),
    },
    idempotent: false,
  };
}
export function ownerRentUiEntries(): OperatingAssetDirectoryEntry[] {
  const settlement = ownerRentUiSettlement();
  const rows = [
    ...ownerRentUiAccount().history,
    {
      entryId: settlement.entryId,
      amountNative: settlement.receiptAmountNative,
      cashDate: settlement.cashDate,
      sourceRef: settlement.sourceRef,
    },
  ];
  return rows.map((row) => ({
    id: row.entryId,
    assetId: ownerAssetId,
    amountNative: row.amountNative,
    currency: "XOF",
    kind: "income",
    category: "rent",
    cashDate: row.cashDate,
    periodStart: null,
    periodEnd: null,
    recognitionMethod: "unallocated",
    verification: "verified",
    status: "verified",
    bookedAmountXof: row.amountNative,
    sourceRef: row.sourceRef,
    description: "测试业主实际收款",
  }));
}
export function ownerRentUiAsset(): OperatingAssetDirectoryAsset {
  return {
    id: ownerAssetId,
    projectId: "test-project",
    unitId: null,
    code: "TEST-FACTORY",
    name: "测试整体厂房",
    group: "factory",
    verification: "verified",
    sourceRefs: ["synthetic-asset-source"],
    monthlyRentNative: 3_500_000,
    rentCurrency: "XOF",
    costCoverageThrough: null,
    updatedAt: ownerContext().expectedUpdatedAt,
    category: "factory",
    displayName: "测试整体厂房",
    displayGroup: "测试厂区",
    referenceRent: { amountNative: 3_500_000, currency: "XOF", period: "month" },
    leaseEvidence: {
      assetSourceRef: "synthetic-asset-source",
      leaseListed: true,
      blockReceiptCutoff: true,
      ownerSettlement: ownerRentUiSettlement(),
      ownerRentAccount: ownerRentUiAccount(),
    },
  };
}
