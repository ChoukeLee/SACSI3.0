import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LeasesPage from "@/app/leases/page";
import FrenchLeasesPage from "@/app/fr/leases/page";
import UnitsPage from "@/app/units/page";
import LegacyOperationsPage from "@/app/asset-operations/page";
import LegacyFrenchOperationsPage from "@/app/fr/asset-operations/page";
import type {
  AssetOperationAsset,
  AssetOperationEntry,
} from "@/features/asset-operations/asset-operations-model";
import {
  OperatingAssetDirectoryPage,
  OperatingAssetNavigation,
} from "@/features/asset-operations/operating-asset-page";

const mocks = vi.hoisted(() => ({
  fetchAssetOperations: vi.fn(),
  getCurrentUser: vi.fn(),
  redirectLegacyCimac: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(path);
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/features/cimac/cimac-legacy-redirect", () => ({
  redirectLegacyCimac: mocks.redirectLegacyCimac,
}));
vi.mock("@/features/leases/lease-lazy-view", () => ({ LeaseLazyView: () => null }));
vi.mock("@/features/leases/lease-workspace-data", () => ({ loadLeaseWorkspace: vi.fn() }));
vi.mock("@/features/units/unit-workbench-workspace", () => ({
  UnitWorkbenchWorkspace: () => null,
  UnitWorkbenchSkeleton: () => null,
}));
vi.mock("@/features/asset-operations/asset-operations-page", () => ({
  AssetOperationsPage: () => null,
}));
vi.mock("@/features/asset-operations/asset-operations-server", () => ({
  fetchAssetOperations: mocks.fetchAssetOperations,
}));
vi.mock("@/features/asset-operations/operating-asset-directory", () => ({
  OperatingAssetDirectory: () => null,
}));

const assetId = "00000000-0000-4000-8000-000000000001";
function findProps(
  tree: ReactNode,
  target: typeof OperatingAssetDirectoryPage | typeof OperatingAssetNavigation,
): Record<string, unknown> | undefined {
  for (const child of Children.toArray(tree)) {
    if (!isValidElement<{ children?: ReactNode }>(child)) continue;
    if (child.type === target) return child.props;
    const props = findProps(child.props.children, target);
    if (props) return props;
  }
}

describe("operating assets are available through the existing workspaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "viewer", role: "admin" });
  });

  it("passes the same operating asset selection to the shared directory from both routes", async () => {
    const leases = await LeasesPage({
      searchParams: Promise.resolve({ assetCategory: "land", operatingAsset: assetId }),
    });
    const units = await UnitsPage({
      searchParams: Promise.resolve({ assetView: "operations", operatingAsset: assetId }),
    });
    expect(findProps(leases, OperatingAssetDirectoryPage)).toMatchObject({
      category: "land",
      selectedAssetId: assetId,
    });
    expect(findProps(units, OperatingAssetDirectoryPage)).toMatchObject({
      selectedAssetId: assetId,
    });
  });

  it("does not mount the financial directory for the rental sales role", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "viewer", role: "rental_sales" });
    const leases = await LeasesPage({
      searchParams: Promise.resolve({ assetCategory: "followup", operatingAsset: assetId }),
    });
    const units = await UnitsPage({
      searchParams: Promise.resolve({ assetView: "operations", operatingAsset: assetId }),
    });
    expect(findProps(leases, OperatingAssetDirectoryPage)).toBeUndefined();
    expect(findProps(leases, OperatingAssetNavigation)).toBeUndefined();
    expect(findProps(units, OperatingAssetDirectoryPage)).toBeUndefined();
    expect(findProps(units, OperatingAssetNavigation)).toBeUndefined();
  });

  it.each([
    { locale: "zh", page: LeasesPage, path: "/leases" },
    { locale: "fr", page: FrenchLeasesPage, path: "/fr/leases" },
  ] as const)(
    "exposes the $locale collection and dormitory routes",
    async ({ locale, page, path }) => {
      const followup = await page({ searchParams: Promise.resolve({ assetCategory: "followup" }) });
      const dormitory = await page({
        searchParams: Promise.resolve({ assetCategory: "dormitory" }),
      });
      expect(findProps(followup, OperatingAssetDirectoryPage)).toMatchObject({
        category: "followup",
        locale,
      });
      expect(findProps(dormitory, OperatingAssetDirectoryPage)).toMatchObject({
        category: "dormitory",
        locale,
      });
      const navigation = renderToStaticMarkup(
        <OperatingAssetNavigation area="leases" locale={locale} category="followup" />,
      );
      expect(navigation).toContain(`href="${path}?assetCategory=followup"`);
      expect(navigation).toContain(`href="${path}?assetCategory=dormitory"`);
    },
  );

  it("opens the collection view with only supplemental assets with rental evidence", async () => {
    const projectId = "test-sacsi";
    const warehouse: AssetOperationAsset = {
      id: assetId,
      projectId,
      unitId: null,
      sourceKey: "test-warehouse",
      code: "TEST-01",
      name: "Warehouse 1",
      group: "Warehouse",
      verification: "verified",
      sourceRefs: [],
      monthlyRentNative: null,
      rentCurrency: null,
      costCoverageThrough: null,
      updatedAt: "2026-11-09T00:00:00Z",
    };
    const receipt: AssetOperationEntry = {
      id: "receipt",
      assetId,
      kind: "income",
      category: "rent",
      amountNative: 10000,
      currency: "XOF",
      cashDate: "2026-08-01",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      recognitionMethod: "unallocated",
      verification: "verified",
      sourceRef: "Warehouse receipt",
      description: "",
    };
    mocks.fetchAssetOperations.mockResolvedValue({
      projectId,
      canWrite: false,
      assets: [
        warehouse,
        { ...warehouse, id: "canonical", unitId: "canonical-unit" },
        { ...warehouse, id: "no-receipt" },
        { ...warehouse, id: "voided-only" },
      ],
      entries: [
        receipt,
        { ...receipt, id: "canonical-receipt", assetId: "canonical" },
        { ...receipt, id: "voided-receipt", assetId: "voided-only", voidedAt: "2026-11-09" },
      ],
    });

    const followup = await OperatingAssetDirectoryPage({
      locale: "zh",
      category: "followup",
      selectedAssetId: "no-receipt",
    });
    expect(followup).toMatchObject({
      props: {
        category: "all",
        enableCollections: true,
        initialView: "collections",
        selectedAssetId: null,
        data: {
          assets: [expect.objectContaining({ id: assetId })],
          entries: [expect.objectContaining({ id: "receipt" })],
        },
      },
    });

    const directory = await OperatingAssetDirectoryPage({ locale: "zh", category: "warehouse" });
    expect(directory).toMatchObject({
      props: {
        initialView: "cards",
        data: {
          assets: [assetId, "no-receipt", "voided-only"].map((id) =>
            expect.objectContaining({ id }),
          ),
        },
      },
    });
  });

  it("keeps bookmarks to maintenance and reports under Assets in both languages", () => {
    expect(() => LegacyOperationsPage()).toThrow("/units?assetView=maintenance");
    expect(() => LegacyFrenchOperationsPage()).toThrow("/fr/units?assetView=maintenance");
  });
});
