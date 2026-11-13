import { describe, expect, it } from "vitest";
import {
  ownerActorId,
  ownerAssetId,
  ownerContext,
  ownerInput,
  ownerRequestId,
  ownerResult,
  ownerSettlement,
} from "../../../tests/fixtures/owner-settlement";
import {
  ownerSettlementMonthCount,
  ownerSettlementPreview,
  parseOwnerSettlementInput,
  readOwnerSettlement,
  readOwnerSettlementContext,
  verifyOwnerSettlementResult,
} from "./owner-settlement-model";
import {
  getOperatingAssetFollowUp,
  summarizeOperatingAssetCash,
  type OperatingAssetDirectoryAsset,
  type OperatingAssetDirectoryEntry,
} from "./operating-asset-directory-model";

const today = "2026-11-13";
describe("owner share settlement boundaries", () => {
  it("separates actual cash, share equivalent and prior whole-property credit using exact integers", () => {
    const input = parseOwnerSettlementInput(ownerInput(), today);
    expect(ownerSettlementPreview(input, 3_000_000)).toEqual({
      monthCount: 7,
      wholeEquivalent: 20_000_000,
      wholeRent: 21_000_000,
      balanced: true,
    });
    expect(ownerSettlementPreview({ ...input, closingWholeCredit: 1 }, 3_000_000).balanced).toBe(
      false,
    );
    expect(readOwnerSettlement(ownerSettlement())).toEqual(ownerSettlement());
    expect(readOwnerSettlementContext(ownerContext(), ownerAssetId)).toEqual(ownerContext());
  });

  it.each([
    null,
    [],
    { ...ownerInput(), arbitrarySql: "select 1" },
    { ...ownerInput(), amountNative: "5000000" },
    { ...ownerInput(), amountNative: 1.5 },
    { ...ownerInput(), amountNative: 1_000_000_000_000 },
    { ...ownerInput(), shareBps: 0 },
    { ...ownerInput(), shareBps: 10001 },
    { ...ownerInput(), shareBps: 2500.5 },
    { ...ownerInput(), currency: "USD" },
    { ...ownerInput(), cashDate: "2026-11-14" },
    { ...ownerInput(), cashDate: "2026-02-30" },
    { ...ownerInput(), openingWholeCredit: -1 },
    { ...ownerInput(), expectedEvidenceHash: null },
    { ...ownerInput(), ownerName: " " },
    { ...ownerInput(), sourceRef: "x".repeat(501) },
    { ...ownerInput(), reason: "x".repeat(2001) },
  ])("rejects malformed or ambiguous input %# before any write", (input) => {
    expect(() => parseOwnerSettlementInput(input, today)).toThrow("invalidOwnerSettlement");
  });

  it("accepts leap months and rejects partial, reversed or excessive periods and fractional XOF equivalents", () => {
    expect(ownerSettlementMonthCount("2028-02-01", "2028-02-29")).toBe(1);
    for (const [start, end] of [
      ["2026-01-02", "2026-01-31"],
      ["2026-01-01", "2026-01-30"],
      ["2026-02-01", "2026-01-31"],
      ["2026-01-01", "2036-01-31"],
    ])
      expect(() => ownerSettlementMonthCount(start, end)).toThrow("invalidOwnerSettlementPeriod");
    expect(() =>
      parseOwnerSettlementInput({ ...ownerInput(), amountNative: 1, shareBps: 3000 }, today),
    ).toThrow("ownerSettlementEquationMismatch");
    expect(() => ownerSettlementPreview(ownerInput(), 999_999_999_999)).toThrow();
  });

  it("requires exact returned request, actor, facts and an independently reconciled equation", () => {
    expect(
      verifyOwnerSettlementResult(ownerResult(), ownerInput(), ownerRequestId, ownerActorId)
        .settlement.receiptAmountNative,
    ).toBe(5_000_000);
    for (const patch of [
      { requestId: ownerAssetId },
      { recordedBy: ownerAssetId },
      { receiptAmountNative: 20_000_000 },
      { wholeEquivalent: 5_000_000 },
      { wholeRent: 1 },
      { throughDate: "2026-08-01" },
      { sourceRef: "different" },
    ]) {
      const result = ownerResult();
      Object.assign(result.data.ownerSettlement, patch);
      expect(() =>
        verifyOwnerSettlementResult(result, ownerInput(), ownerRequestId, ownerActorId),
      ).toThrow();
    }
    expect(() =>
      readOwnerSettlementContext({ ...ownerContext(), previousSettlement: {} }, ownerAssetId),
    ).toThrow();
  });

  it("counts only actual owner rent cash while tenant coverage and unresolved outstanding remain unchanged", () => {
    const asset: OperatingAssetDirectoryAsset = {
      id: ownerAssetId,
      projectId: "test-project",
      unitId: null,
      code: "TEST-FACTORY",
      name: "测试厂房",
      group: "factory",
      verification: "verified",
      sourceRefs: ["synthetic-source"],
      monthlyRentNative: 3_000_000,
      rentCurrency: "XOF",
      costCoverageThrough: null,
      updatedAt: ownerContext().expectedUpdatedAt,
      category: "factory",
      displayName: "测试厂房",
      displayGroup: "测试",
      referenceRent: null,
      leaseEvidence: {
        assetSourceRef: "synthetic-source",
        leaseListed: true,
        outstanding: { amountNative: 9_000_000, currency: "XOF", sourceRef: "unresolved-source" },
        ownerSettlement: ownerSettlement(),
      },
    };
    const entry: OperatingAssetDirectoryEntry = {
      id: ownerSettlement().entryId,
      assetId: ownerAssetId,
      kind: "income",
      category: "rent",
      amountNative: 5_000_000,
      currency: "XOF",
      cashDate: "2026-11-12",
      periodStart: null,
      periodEnd: null,
      recognitionMethod: "unallocated",
      verification: "verified",
      sourceRef: ownerInput().sourceRef,
      description: "业主股比实收",
      status: "verified",
      bookedAmountXof: 5_000_000,
    };
    const before = getOperatingAssetFollowUp(asset, [], today);
    expect(getOperatingAssetFollowUp(asset, [entry], today)).toEqual(before);
    expect(before).toMatchObject({
      paidThrough: null,
      outstanding: { amountNative: 9_000_000 },
      status: "needs_evidence",
    });
    expect(summarizeOperatingAssetCash([asset], [entry]).originals).toEqual([
      expect.objectContaining({
        currency: "XOF",
        income: 5_000_000,
        net: 5_000_000,
        entryCount: 1,
      }),
    ]);
  });
});
