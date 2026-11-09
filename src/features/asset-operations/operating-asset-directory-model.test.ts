import { describe, expect, it } from "vitest";
import type {
  AssetOperationAsset,
  AssetOperationEntry,
  AssetOperationsData,
} from "./asset-operations-model";
import {
  buildOperatingAssetDirectory,
  summarizeOperatingAssetCash,
} from "./operating-asset-directory-model";

const projectId = "test-sacsi";
const options = { sacsiProjectId: projectId };

function asset(overrides: Partial<AssetOperationAsset> = {}): AssetOperationAsset {
  return {
    id: "land-id",
    projectId,
    unitId: null,
    sourceKey: "warehouse:guoji",
    code: "TEST-GUOJI",
    name: "国基仓库（原表国基租金）",
    group: "独立仓库",
    verification: "pending",
    sourceRefs: ["test.xlsx!A77:G77", "用户于2026-11-09确认独立仓库"],
    monthlyRentNative: null,
    rentCurrency: null,
    costCoverageThrough: null,
    updatedAt: "2026-11-09T00:00:00Z",
    ...overrides,
  };
}

type Entry = AssetOperationEntry & { bookedAmountXof?: number | null };

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: "current-xof",
    assetId: "office-id",
    kind: "income",
    category: "rent",
    amountNative: 1000,
    currency: "XOF",
    cashDate: "2026-11-05",
    periodStart: null,
    periodEnd: null,
    verification: "verified",
    recognitionMethod: "unallocated",
    sourceRef: "test.xlsx!A2",
    description: "Test source",
    ...overrides,
  };
}

describe("operating asset directory", () => {
  it("shows the corrected SACSI land category on the same source asset and preserves the original evidence", () => {
    const original = asset();
    const originalReceipt = entry({
      id: "land-source",
      assetId: original.id,
      cashDate: "2026-10-02",
      amountNative: 25000000,
      sourceRef: "test.xlsx!I77",
      description: "原表为国基仓库租金。后续领取按原记录另核。",
      verification: "pending",
    });
    const snapshot: AssetOperationsData = {
      projectId,
      canWrite: false,
      assets: [
        original,
        asset({ id: "canonical-id", unitId: "unit-id", sourceKey: "apartment:1" }),
      ],
      entries: [originalReceipt],
    };
    const directory = buildOperatingAssetDirectory(snapshot, options);

    expect(directory.assets).toHaveLength(1);
    expect(directory.assets[0]).toMatchObject({
      ...original,
      category: "land",
      displayName: "国基土地",
      displayGroup: "土地",
      sourceRefs: ["test.xlsx!A77:G77", "用户更正为土地"],
    });
    expect(directory.entries).toEqual([
      expect.objectContaining({
        ...originalReceipt,
        description: "国基土地租金。后续领取按原记录另核。",
      }),
    ]);
    expect(original.sourceRefs).toContain("用户于2026-11-09确认独立仓库");
    expect(originalReceipt.description).toContain("原表为国基仓库租金。");
    expect(directory.canWrite).toBe(false);
    expect(
      buildOperatingAssetDirectory(snapshot, { ...options, includeCanonical: true }).assets,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ id: "canonical-id" })]));

    const otherProject = buildOperatingAssetDirectory(
      { ...snapshot, projectId: "other-project", assets: [asset({ projectId: "other-project" })] },
      options,
    );
    expect(otherProject.assets[0]).toMatchObject({ displayName: original.name });
    expect(otherProject.assets[0].category).not.toBe("land");
  });

  it("limits the monthly cash view by receipt date while keeping the whole pending history", () => {
    const directory = buildOperatingAssetDirectory(
      {
        projectId,
        canWrite: false,
        assets: [asset()],
        entries: [
          entry({ id: "november", assetId: "land-id", verification: "pending" }),
          entry({
            id: "october",
            assetId: "land-id",
            cashDate: "2026-10-02",
            periodStart: "2026-07-01",
            periodEnd: "2026-11-30",
            verification: "pending",
          }),
          entry({
            id: "june",
            assetId: "land-id",
            cashDate: "2026-06-30",
            verification: "pending",
          }),
        ],
      },
      options,
    );
    const current = summarizeOperatingAssetCash(directory.assets, directory.entries, {
      start: "2026-11-01",
      end: "2026-11-30",
    });
    const all = summarizeOperatingAssetCash(directory.assets, directory.entries);
    expect(current).toMatchObject({ pendingEntryCount: 1, verifiedEntryCount: 0, originals: [] });
    expect(all).toMatchObject({ pendingEntryCount: 3, verifiedEntryCount: 0, originals: [] });
    expect(directory.entries.map((item) => item.id)).toEqual(
      expect.arrayContaining(["november", "october", "june"]),
    );
  });

  it("counts original and booked amounts in separate views without duplicating a receipt", () => {
    const cny = entry({ id: "cny", amountNative: 100.25, currency: "CNY", bookedAmountXof: 5000 });
    const directory = buildOperatingAssetDirectory(
      {
        projectId,
        canWrite: false,
        assets: [
          asset({
            id: "office-id",
            sourceKey: "legacy_company:office",
            group: "老公司出租",
            name: "示例办公室",
            verification: "verified",
          }),
        ],
        entries: [
          entry({ bookedAmountXof: 2000 }),
          cny,
          cny,
          entry({
            id: "cny-without-booking",
            amountNative: 10,
            currency: "CNY",
            description: "备注折合 500 西法，尚无记账额",
          }),
        ],
      },
      options,
    );
    const totals = summarizeOperatingAssetCash(directory.assets, directory.entries);

    expect(totals.originals).toHaveLength(2);
    expect(totals.originals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ currency: "XOF", income: 1000, entryCount: 1 }),
        expect.objectContaining({ currency: "CNY", income: 110.25, entryCount: 2 }),
      ]),
    );
    expect(totals.bookedXof).toMatchObject({ income: 6000, entryCount: 2 });
    expect(totals.verifiedEntryCount).toBe(3);
    expect(totals.missingBookedXofCount).toBe(1);
  });
});
