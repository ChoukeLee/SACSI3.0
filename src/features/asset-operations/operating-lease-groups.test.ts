import { describe, expect, it, vi } from "vitest";
import {
  getOperatingAssetFollowUp,
  type OperatingAssetDirectoryAsset,
  type OperatingAssetDirectoryEntry,
} from "./operating-asset-directory-model";
import { withIncubatorDormitoryLeaseGroups } from "./operating-lease-groups-server";
import { operatingLeaseViews } from "./operating-lease-groups";

vi.mock("server-only", () => ({}));

const workbook =
  "sha256:e3ed7762344e6e731633bd753702308c51c6a4d24559ee520065ab947d9b16c6|file:公寓、仓库租金截止日期等.xlsx|sheet:孵化园|range:";
const rows = [17, 23, 29, 43];
const asset: OperatingAssetDirectoryAsset = {
  id: "dorm",
  projectId: "sacsi",
  unitId: null,
  sourceKey: "incubator:dormitory",
  code: "DORM",
  name: "孵化园配套宿舍（四组明细）",
  group: "配套宿舍",
  displayName: "孵化园配套宿舍（四组明细）",
  displayGroup: "配套宿舍",
  category: "dormitory",
  verification: "verified",
  sourceRefs: rows.map((row) => `${workbook}A${row}:D${row}`),
  monthlyRentNative: 210_000,
  rentCurrency: "XOF",
  costCoverageThrough: null,
  updatedAt: "2026-11-09T00:00:00Z",
  referenceRent: { amountNative: 210_000, currency: "XOF", period: "month" },
  leaseEvidence: {
    assetSourceRef: `${workbook}A17:D17`,
    paidThrough: { date: "2026-12-31", sourceRef: `${workbook}D17:K43` },
    nextPayment: { dueDate: "2026-11-10", sourceRef: `${workbook}D17:K43`, unpaid: true },
  },
};

function receipt(row: number): OperatingAssetDirectoryEntry {
  return {
    id: `receipt-${row}`,
    assetId: asset.id,
    kind: "income",
    category: "rent",
    amountNative: 450_000,
    bookedAmountXof: 450_000,
    currency: "XOF",
    cashDate: "2026-09-17",
    periodStart: "2026-09-01",
    periodEnd: "2026-11-30",
    recognitionMethod: "daily",
    verification: "verified",
    status: "verified",
    sourceRef: `${workbook}I${row}:K${row}`,
    description: "",
  };
}

describe("incubator dormitory lease groups", () => {
  it("maps the warehouse owner evidence and attributes only the group's exact existing receipt", () => {
    const entries = [
      receipt(17),
      receipt(17),
      receipt(23),
      receipt(43),
      { ...receipt(29), sourceRef: `${workbook}I29:K29|other` },
      { ...receipt(29), id: "another-asset", assetId: "other" },
    ];
    const directory = withIncubatorDormitoryLeaseGroups({
      projectId: asset.projectId,
      assets: [asset],
      entries,
      canWrite: false,
    });
    const views = operatingLeaseViews(directory.assets[0], directory.entries);

    expect(directory.entries).toBe(entries);
    expect(views.map((view) => view.key)).toEqual(rows.map((row) => `dorm:row-${row}`));
    expect(views.map((view) => view.entries.map((entry) => entry.id))).toEqual([
      ["receipt-17"],
      ["receipt-23"],
      [],
      ["receipt-43"],
    ]);
    expect(views.map((view) => view.asset.leaseEvidence?.tenantEvidence?.sourceRef)).toEqual(
      [16, 22, 28, 43].map((row) => `${workbook}B${row}`),
    );
    expect(
      views.every((view) => view.asset.id === asset.id && view.asset.name === asset.name),
    ).toBe(true);
    expect(
      views.every((view) => !view.asset.leaseGroups && view.asset.referenceRent === null),
    ).toBe(true);
    expect(
      views.map(({ asset, entries }) => {
        const followUp = getOperatingAssetFollowUp(asset, entries, "2026-11-09");
        return [followUp.paidThrough?.date ?? null, followUp.dueDate];
      }),
    ).toEqual([
      ["2026-11-30", null],
      ["2026-11-30", null],
      [null, null],
      ["2026-11-30", null],
    ]);
  });

  it("keeps the ordinary asset view when the workbook sources do not all match", () => {
    const partialAsset = { ...asset, sourceRefs: asset.sourceRefs.slice(0, 3) };
    const entries = [receipt(17), receipt(43)];
    const directory = withIncubatorDormitoryLeaseGroups({
      projectId: asset.projectId,
      assets: [partialAsset],
      entries,
      canWrite: false,
    });

    expect(directory.assets[0]).toBe(partialAsset);
    expect(operatingLeaseViews(directory.assets[0], entries)).toEqual([
      { key: asset.id, asset: partialAsset, entries },
    ]);
  });
});
