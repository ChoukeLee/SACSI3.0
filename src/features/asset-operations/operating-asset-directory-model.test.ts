import { describe, expect, it } from "vitest";
import type {
  AssetOperationAsset,
  AssetOperationEntry,
  AssetOperationsData,
} from "./asset-operations-model";
import {
  buildOperatingAssetDirectory,
  getOperatingAssetFollowUp,
  hasOperatingAssetLeaseEvidence,
  summarizeOperatingAssetCash,
  type OperatingAssetLeaseEvidence,
} from "./operating-asset-directory-model";

const projectId = "test-sacsi";
const options = { sacsiProjectId: projectId, applyExcelConfirmation: true };
const workbook =
  "sha256:e3ed7762344e6e731633bd753702308c51c6a4d24559ee520065ab947d9b16c6|file:公寓、仓库租金截止日期等.xlsx|sheet:老仓库等";
const workbookSource = `${workbook}|range:A77:G77`;
const octoberSource = `${workbook}|cell:I77|event:1`;
const juneSource = `${workbook}|range:H77`;

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
    sourceRefs: [workbookSource, "用户于2026-11-09确认独立仓库"],
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
  it("uses matched Excel rates and verified cutoffs without manufacturing a payment date", () => {
    const evidence = {
      assetSourceRef: workbookSource,
      paidThrough: { date: "2026-09-30", sourceRef: octoberSource },
      outstanding: { amountNative: 30, currency: "CNY", sourceRef: juneSource },
      rates: [
        {
          amountNative: 1_210_000,
          currency: "XOF",
          period: "month",
          sourceRef: workbookSource,
          effectiveFrom: "2026-11-01",
          effectiveThrough: "2027-04-30",
        },
      ],
    } satisfies OperatingAssetLeaseEvidence;
    const snapshot: AssetOperationsData = {
      projectId,
      assets: [asset()],
      entries: [],
      canWrite: false,
    };
    const makeDirectory = (assetSourceRef: string, today: string) =>
      buildOperatingAssetDirectory(snapshot, {
        ...options,
        today,
        leaseEvidence: { "warehouse:guoji": { ...evidence, assetSourceRef } },
      });
    const directory = makeDirectory(workbookSource, "2026-11-09");
    expect(directory.assets[0].referenceRent).toMatchObject({
      amountNative: 1_210_000,
      period: "month",
    });
    expect(getOperatingAssetFollowUp(directory.assets[0], [], "2026-11-09")).toMatchObject({
      paidThrough: { date: "2026-09-30", sourceRef: octoberSource, status: "verified" },
      dueDate: null,
      outstanding: { amountNative: 30, currency: "CNY" },
      status: "needs_evidence",
      reason: "due_date_missing",
    });
    expect(makeDirectory("wrong source", "2026-11-09").assets[0].leaseEvidence).toBeNull();
    expect(makeDirectory(workbookSource, "2027-05-01").assets[0].referenceRent).toBeNull();
  });

  it("only flags the 15-day window and overdue when an agreed due date and unpaid evidence are present", () => {
    const sourceAsset = asset();
    const snapshot: AssetOperationsData = {
      projectId,
      assets: [sourceAsset],
      entries: [],
      canWrite: false,
    };
    const makeAsset = (dueDate: string, unpaid?: boolean, selfUse?: boolean) =>
      buildOperatingAssetDirectory(snapshot, {
        ...options,
        leaseEvidence: {
          "warehouse:guoji": {
            assetSourceRef: workbookSource,
            paidThrough: { date: "2026-10-31", sourceRef: octoberSource },
            nextPayment: { dueDate, sourceRef: juneSource, unpaid },
            selfUse,
          },
        },
      }).assets[0];
    const today = "2026-11-09";
    expect(getOperatingAssetFollowUp(makeAsset("2026-11-08", true), [], today)).toMatchObject({
      status: "overdue",
      daysUntilDue: -1,
    });
    expect(getOperatingAssetFollowUp(makeAsset("2026-11-09", true), [], today)).toMatchObject({
      status: "upcoming",
      daysUntilDue: 0,
    });
    expect(getOperatingAssetFollowUp(makeAsset("2026-11-24", true), [], today)).toMatchObject({
      status: "upcoming",
      daysUntilDue: 15,
    });
    expect(getOperatingAssetFollowUp(makeAsset("2026-11-25", true), [], today).status).toBe(
      "current",
    );
    expect(getOperatingAssetFollowUp(makeAsset("2026-11-08"), [], today)).toMatchObject({
      status: "needs_evidence",
      reason: "unpaid_unconfirmed",
    });
    expect(hasOperatingAssetLeaseEvidence(makeAsset("2026-11-08", true, true), [])).toBe(false);
  });

  it("preserves the reviewed cutoff against older partial receipts and can use later verified coverage", () => {
    const directory = buildOperatingAssetDirectory(
      {
        projectId,
        assets: [asset()],
        entries: [
          entry({
            id: "partial",
            assetId: "land-id",
            cashDate: "2026-10-30",
            periodEnd: "2027-02-28",
          }),
          entry({
            id: "newer",
            assetId: "land-id",
            cashDate: "2026-11-10",
            periodEnd: "2027-01-31",
          }),
        ],
        canWrite: false,
      },
      {
        ...options,
        leaseEvidence: {
          "warehouse:guoji": {
            assetSourceRef: workbookSource,
            reviewedOn: "2026-11-09",
            paidThrough: { date: "2026-09-30", sourceRef: octoberSource },
          },
        },
      },
    );
    const [record] = directory.assets;
    expect(
      getOperatingAssetFollowUp(
        record,
        directory.entries.filter((item) => item.id === "partial"),
        "2026-11-09",
      ).paidThrough?.date,
    ).toBe("2026-09-30");
    expect(
      getOperatingAssetFollowUp(record, directory.entries, "2026-11-11").paidThrough?.date,
    ).toBe("2027-01-31");
  });

  it("confirms Excel sources in the SACSI trial while retaining the original land evidence", () => {
    const original = asset();
    const originalReceipt = entry({
      id: "land-source",
      assetId: original.id,
      cashDate: "2026-10-02",
      amountNative: 25000000,
      sourceRef: octoberSource,
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
      referenceRent: { amountNative: 25_000_000, currency: "XOF", period: "quarter" },
      verification: "verified",
      sourceRefs: [workbookSource, "用户更正为土地"],
    });
    expect(directory.entries).toEqual([
      expect.objectContaining({
        ...originalReceipt,
        verification: "verified",
        status: "verified",
        description: "国基土地租金。后续领取按原记录另核。",
      }),
    ]);
    expect(original.sourceRefs).toContain("用户于2026-11-09确认独立仓库");
    expect(originalReceipt.description).toContain("原表为国基仓库租金。");
    expect(original.verification).toBe("pending");
    expect(originalReceipt.verification).toBe("pending");
    expect(directory.canWrite).toBe(false);
    const maintenance = buildOperatingAssetDirectory(snapshot, {
      sacsiProjectId: projectId,
      includeCanonical: true,
    });
    expect(maintenance.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: original.id, verification: "pending" }),
        expect.objectContaining({ id: "canonical-id" }),
      ]),
    );
    expect(maintenance.entries[0]).toMatchObject({ verification: "pending", status: "pending" });

    const otherProject = buildOperatingAssetDirectory(
      { ...snapshot, projectId: "other-project", assets: [asset({ projectId: "other-project" })] },
      options,
    );
    expect(otherProject.assets[0]).toMatchObject({
      displayName: original.name,
      referenceRent: null,
      verification: "pending",
    });
    expect(otherProject.assets[0].category).not.toBe("land");
    expect(otherProject.entries[0]).toMatchObject({ verification: "pending", status: "pending" });
  });

  it("counts the confirmed Guoji receipts in their original cash months", () => {
    const directory = buildOperatingAssetDirectory(
      {
        projectId,
        canWrite: false,
        assets: [asset()],
        entries: [
          entry({
            id: "october",
            assetId: "land-id",
            cashDate: "2026-10-02",
            amountNative: 25000000,
            periodStart: "2026-07-01",
            periodEnd: "2026-09-30",
            sourceRef: octoberSource,
            verification: "pending",
          }),
          entry({
            id: "june",
            assetId: "land-id",
            cashDate: "2026-06-30",
            amountNative: 50000000,
            periodStart: "2026-01-01",
            periodEnd: "2026-06-30",
            sourceRef: juneSource,
            verification: "pending",
          }),
        ],
      },
      options,
    );
    const october = summarizeOperatingAssetCash(directory.assets, directory.entries, {
      start: "2026-10-01",
      end: "2026-10-31",
    });
    const november = summarizeOperatingAssetCash(directory.assets, directory.entries, {
      start: "2026-11-01",
      end: "2026-11-30",
    });
    const all = summarizeOperatingAssetCash(directory.assets, directory.entries);
    expect(october).toMatchObject({
      pendingEntryCount: 0,
      verifiedEntryCount: 1,
      originals: [{ currency: "XOF", income: 25000000, entryCount: 1 }],
      bookedXof: { income: 25000000, entryCount: 1 },
    });
    expect(november).toMatchObject({ pendingEntryCount: 0, verifiedEntryCount: 0, originals: [] });
    expect(all).toMatchObject({
      pendingEntryCount: 0,
      verifiedEntryCount: 2,
      originals: [{ currency: "XOF", income: 75000000, entryCount: 2 }],
    });
    expect(directory.entries.map((item) => item.id)).toEqual(["october", "june"]);
  });

  it("keeps manual and voided records separate and never infers cash timing from a period", () => {
    const manual = asset({
      id: "manual-asset",
      sourceKey: "manual:shop",
      name: "手工资产",
      sourceRefs: ["手工登记"],
    });
    const directory = buildOperatingAssetDirectory(
      {
        projectId,
        canWrite: false,
        assets: [asset(), manual],
        entries: [
          entry({
            id: "manual",
            assetId: "land-id",
            verification: "pending",
            sourceRef: "test.xlsx!A2",
          }),
          entry({
            id: "voided",
            assetId: "land-id",
            sourceRef: juneSource,
            verification: "pending",
            voidedAt: "2026-11-09T09:00:00Z",
          }),
          entry({
            id: "undated",
            assetId: "land-id",
            cashDate: null,
            periodStart: "2026-01-01",
            periodEnd: "2026-12-31",
            sourceRef: octoberSource,
            verification: "pending",
          }),
        ],
      },
      options,
    );
    const november = summarizeOperatingAssetCash(directory.assets, directory.entries, {
      start: "2026-11-01",
      end: "2026-11-30",
    });

    expect(directory.assets.find(({ id }) => id === manual.id)?.verification).toBe("pending");
    expect(directory.entries).toEqual([
      expect.objectContaining({ id: "manual", status: "pending", verification: "pending" }),
      expect.objectContaining({ id: "voided", status: "voided" }),
      expect.objectContaining({ id: "undated", status: "verified", cashDate: null }),
    ]);
    expect(november).toMatchObject({
      pendingEntryCount: 1,
      verifiedEntryCount: 0,
      voidedEntryCount: 1,
      undatedEntryCount: 1,
      originals: [],
      bookedXof: null,
    });
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
