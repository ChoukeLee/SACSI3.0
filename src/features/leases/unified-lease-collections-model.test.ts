import { expect, it } from "vitest";
import { formatPropertyMoney } from "@/lib/property-money";
import type { LeaseContractRow } from "@/types/database";
import type {
  OperatingAssetDirectoryAsset,
  OperatingAssetDirectoryData,
} from "@/features/asset-operations/operating-asset-directory-model";
import { workspaceFixture } from "../../../tests/fixtures/contract-workspace";
import { operatingAssetMatchesSearch } from "@/features/asset-operations/operating-asset-display";
import { buildLeaseRecordOverview } from "./lease-room-overview-model";
import {
  buildApartmentCollectionRows,
  buildOperatingCollectionRows,
  parseCollectionCategory,
  sortCollectionRows,
} from "./unified-lease-collections-model";

const today = "2026-11-09";

const operatingAsset: OperatingAssetDirectoryAsset = {
  id: "97504e75-3bdd-40dd-bc80-d5e1b661d91b",
  projectId: "fixture-project",
  unitId: null,
  code: "W-1",
  name: "老仓库一号",
  group: "old_warehouse",
  displayName: "老仓库一号",
  displayGroup: "老仓库",
  category: "warehouse",
  verification: "verified",
  sourceRefs: ["source!A1"],
  sourceKey: "fixture-key",
  monthlyRentNative: null,
  rentCurrency: null,
  costCoverageThrough: null,
  updatedAt: "2026-11-09T00:00:00Z",
  referenceRent: null,
  leaseEvidence: null,
};

function apartmentRecords() {
  const workspace = workspaceFixture();
  const contracts = workspace.contracts as LeaseContractRow[];
  contracts[0].paid_through_date = "2026-11-04";
  return buildLeaseRecordOverview({
    units: workspace.units,
    contracts,
    customers: workspace.customers,
    buildings: workspace.buildings,
    receivables: [],
    today,
  });
}

it("keeps apartment coverage review separate from payment dates", () => {
  const records = apartmentRecords();
  expect(records[0].attention?.kind).toBe("coverage");
  expect(buildApartmentCollectionRows(records, "zh")).toMatchObject([
    {
      category: "apartment",
      status: "needs_evidence",
      dueDate: null,
      paidThrough: "2026-11-04",
      amount: null,
    },
  ]);
});

it("keeps a historical native-currency debt and links to its original contract", () => {
  const [record] = apartmentRecords();
  const [row] = buildApartmentCollectionRows(
    [
      {
        ...record,
        historical: true,
        attention: {
          kind: "unsettled",
          dueDate: "2026-11-10",
          days: 1,
          amount: 180,
          currency: "USD",
          amountIsEstimated: false,
        },
      },
    ],
    "fr",
  );
  expect(row).toMatchObject({
    status: "unsettled",
    dueDate: "2026-11-10",
    amount: formatPropertyMoney(180, "USD", "fr"),
  });
  const target = new URL(row.href, "https://example.test");
  expect(target.pathname).toBe("/fr/leases");
  expect(target.searchParams.get("contract")).toBe(record.contract.id);
  expect(target.searchParams.get("returnTo")).toBe("/fr/leases?assetCategory=followup");
});

it("lists an explicit warehouse balance with missing due date as evidence, not overdue", () => {
  const data: OperatingAssetDirectoryData = {
    projectId: "fixture-project",
    canWrite: false,
    entries: [],
    assets: [
      {
        ...operatingAsset,
        leaseEvidence: {
          assetSourceRef: "source!A1",
          paidThrough: { date: "2026-10-31", sourceRef: "source!B1" },
          outstanding: { amountNative: 30, currency: "CNY", sourceRef: "source!C1" },
        },
      },
    ],
  };
  const operating = buildOperatingCollectionRows(data, today, "zh");
  expect(operating).toMatchObject([
    {
      category: "multi-unit",
      group: "老仓库",
      status: "needs_evidence",
      reason: "付款日未登记",
      dueDate: null,
      paidThrough: "2026-10-31",
      amount: formatPropertyMoney(30, "CNY", "zh"),
      amountLabel: "原表余款",
    },
  ]);
  const apartment = buildApartmentCollectionRows(apartmentRecords(), "zh");
  expect(sortCollectionRows([...apartment, ...operating], "zh")[0]).toBe(operating[0]);
  expect(parseCollectionCategory("warehouse")).toBe("multi-unit");
  expect(parseCollectionCategory("other")).toBe("whole");
  expect(parseCollectionCategory(["warehouse"])).toBe("all");
});

it("shows a prepaid whole lease with a missing next date and its confirmed receipt", () => {
  const wholeAsset: OperatingAssetDirectoryAsset = {
    ...operatingAsset,
    category: "commercial",
    name: "整租样例",
    displayName: "整租样例",
    group: "商铺",
    displayGroup: "商铺",
    leaseEvidence: {
      assetSourceRef: "source!A1",
      paidThrough: { date: "2027-04-30", sourceRef: "source!B1" },
    },
  };
  const receipt: OperatingAssetDirectoryData["entries"][number] = {
    id: "receipt-confirmed",
    assetId: wholeAsset.id,
    kind: "income",
    category: "rent",
    amountNative: 15_840_000,
    currency: "XOF",
    cashDate: "2026-09-19",
    periodStart: "2026-11-01",
    periodEnd: "2027-04-30",
    recognitionMethod: "unallocated",
    verification: "verified",
    status: "verified",
    bookedAmountXof: 15_840_000,
    sourceRef: "source!D1",
    description: "",
  };
  const [row] = buildOperatingCollectionRows(
    {
      projectId: wholeAsset.projectId,
      canWrite: false,
      assets: [wholeAsset],
      entries: [
        receipt,
        {
          ...receipt,
          id: "receipt-pending",
          cashDate: today,
          status: "pending",
          verification: "pending",
        },
      ],
    },
    today,
    "zh",
  );
  expect(row).toMatchObject({
    category: "whole",
    status: "needs_evidence",
    reason: "下期付款日待补",
    dueDate: null,
    paidThrough: "2027-04-30",
    amount: null,
    latestReceipt: {
      date: "2026-09-19",
      amount: formatPropertyMoney(receipt.amountNative, receipt.currency, "zh"),
      periodStart: "2026-11-01",
      periodEnd: "2027-04-30",
    },
  });
  expect(row.group).toBeUndefined();
  const target = new URL(row.href, "https://example.test");
  expect(target.searchParams.get("assetCategory")).toBe("whole");
  expect(target.searchParams.get("operatingAsset")).toBe(wholeAsset.id);
});

it("keeps the incubator dormitory's grouped record in multi-unit follow-up", () => {
  const name = "孵化园配套宿舍（四组明细）";
  const dormitory: OperatingAssetDirectoryAsset = {
    ...operatingAsset,
    category: "dormitory",
    group: "宿舍",
    displayGroup: "宿舍",
    name,
    displayName: name,
    leaseEvidence: {
      assetSourceRef: "source!A1",
      paidThrough: { date: "2026-11-30", sourceRef: "source!B1" },
    },
  };
  expect(operatingAssetMatchesSearch(dormitory, "孵化园宿舍")).toBe(true);
  expect(
    buildOperatingCollectionRows(
      { projectId: dormitory.projectId, canWrite: false, assets: [dormitory], entries: [] },
      today,
      "zh",
    ),
  ).toMatchObject([
    {
      category: "multi-unit",
      group: "孵化园宿舍",
      name,
      status: "needs_evidence",
      paidThrough: "2026-11-30",
      dueDate: null,
      amount: null,
    },
  ]);
});

it("replaces the incubator dormitory follow-up with four groups and isolates receipts", () => {
  const name = "孵化园配套宿舍（四组明细）";
  const dormitory: OperatingAssetDirectoryAsset = {
    ...operatingAsset,
    category: "dormitory",
    group: "宿舍",
    displayGroup: "宿舍",
    name,
    displayName: name,
    leaseEvidence: {
      assetSourceRef: "source!A1",
      paidThrough: { date: "2027-10-31", sourceRef: "source!B1" },
      outstanding: { amountNative: 500_000, currency: "XOF", sourceRef: "source!C1" },
    },
    leaseGroups: [
      {
        key: "row-17",
        label: "宿舍 · 3间",
        sourceRef: "source!A17",
        receiptSourceRef: "source!I17:K17",
      },
      {
        key: "row-23",
        label: "宿舍 · 4间",
        sourceRef: "source!A23",
        receiptSourceRef: "source!I23:K23",
      },
      {
        key: "row-29",
        label: "宿舍 · 6间",
        sourceRef: "source!A29",
        receiptSourceRef: "source!I29:K29",
      },
      {
        key: "row-43",
        label: "308宿舍 · 1间",
        sourceRef: "source!A43",
        receiptSourceRef: "source!I43:K43",
      },
    ],
  };
  const receipt: OperatingAssetDirectoryData["entries"][number] = {
    id: "receipt-17",
    assetId: dormitory.id,
    kind: "income",
    category: "rent",
    amountNative: 300_000,
    currency: "XOF",
    cashDate: "2026-09-01",
    periodStart: "2026-09-01",
    periodEnd: "2026-11-30",
    recognitionMethod: "unallocated",
    verification: "verified",
    status: "verified",
    bookedAmountXof: 300_000,
    sourceRef: "source!I17:K17",
    description: "",
  };
  const rows = buildOperatingCollectionRows(
    {
      projectId: dormitory.projectId,
      canWrite: false,
      assets: [dormitory],
      entries: [
        receipt,
        {
          ...receipt,
          id: "receipt-23",
          amountNative: 400_000,
          bookedAmountXof: 400_000,
          cashDate: "2026-10-01",
          periodStart: "2026-10-01",
          periodEnd: "2026-12-31",
          sourceRef: "source!I23:K23",
        },
        {
          ...receipt,
          id: "receipt-unassigned",
          cashDate: "2026-11-08",
          periodEnd: "2027-10-31",
          sourceRef: "source!I1:K1",
        },
      ],
    },
    today,
    "zh",
  );
  expect(
    rows.map(({ id, category, group, status, amount }) => ({
      id,
      category,
      group,
      status,
      amount,
    })),
  ).toEqual(
    ["row-17", "row-23", "row-29", "row-43"].map((key) => ({
      id: `asset:${dormitory.id}:${key}`,
      category: "multi-unit",
      group: "孵化园宿舍",
      status: "needs_evidence",
      amount: null,
    })),
  );
  expect(rows.map((row) => row.paidThrough)).toEqual(["2026-11-30", "2026-12-31", null, null]);
  expect(rows.map((row) => row.latestReceipt?.date)).toEqual([
    "2026-09-01",
    "2026-10-01",
    undefined,
    undefined,
  ]);
  const target = new URL(rows[1].href, "https://example.test");
  expect(target.searchParams.get("operatingAsset")).toBe(dormitory.id);
  expect(target.searchParams.get("operatingLeaseGroup")).toBe("row-23");
});
