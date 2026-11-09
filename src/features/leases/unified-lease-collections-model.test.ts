import { expect, it } from "vitest";
import { formatPropertyMoney } from "@/lib/property-money";
import type { LeaseContractRow } from "@/types/database";
import type { OperatingAssetDirectoryData } from "@/features/asset-operations/operating-asset-directory-model";
import { workspaceFixture } from "../../../tests/fixtures/contract-workspace";
import { buildLeaseRecordOverview } from "./lease-room-overview-model";
import {
  buildApartmentCollectionRows,
  buildOperatingCollectionRows,
  parseCollectionCategory,
  sortCollectionRows,
} from "./unified-lease-collections-model";

const today = "2026-11-09";

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
        id: "97504e75-3bdd-40dd-bc80-d5e1b661d91b",
        projectId: "fixture-project",
        unitId: null,
        code: "W-1",
        name: "仓库一号",
        group: "仓库",
        displayName: "仓库一号",
        displayGroup: "仓库",
        category: "warehouse",
        verification: "verified",
        sourceRefs: ["source!A1"],
        sourceKey: "fixture-key",
        monthlyRentNative: null,
        rentCurrency: null,
        costCoverageThrough: null,
        updatedAt: "2026-11-09T00:00:00Z",
        referenceRent: null,
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
      category: "warehouse",
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
  expect(parseCollectionCategory("other")).toBe("other");
  expect(parseCollectionCategory(["warehouse"])).toBe("all");
});
