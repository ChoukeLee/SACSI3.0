import { Children, isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LeasesPage from "@/app/leases/page";
import FrenchLeasesPage from "@/app/fr/leases/page";
import UnitsPage from "@/app/units/page";
import FrenchUnitsPage from "@/app/fr/units/page";
import { AssetBrowseNavigation } from "@/features/units/asset-browse-navigation";
import LegacyOperationsPage from "@/app/asset-operations/page";
import LegacyFrenchOperationsPage from "@/app/fr/asset-operations/page";
import { UnifiedLeaseCollectionsPage } from "@/features/leases/unified-lease-collections-page";
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
  cookieGet: vi.fn(),
  redirectLegacyCimac: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(path);
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookieGet }) }));
vi.mock("@/features/cimac/cimac-legacy-redirect", () => ({
  redirectLegacyCimac: mocks.redirectLegacyCimac,
}));
vi.mock("@/features/leases/lease-lazy-view", () => ({ LeaseLazyView: () => null }));
vi.mock("@/features/leases/lease-workspace-data", () => ({ loadLeaseWorkspace: vi.fn() }));
vi.mock("@/features/leases/unified-lease-collections-page", () => ({
  UnifiedLeaseCollectionsPage: () => null,
  loadApartmentLeaseOverview: async () => ({ rows: [], unavailable: false }),
}));
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
  target:
    | typeof OperatingAssetDirectoryPage
    | typeof OperatingAssetNavigation
    | typeof AssetBrowseNavigation
    | typeof UnifiedLeaseCollectionsPage,
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
    mocks.cookieGet.mockReturnValue(undefined);
  });

  it.each([
    { locale: "zh", page: UnitsPage },
    { locale: "fr", page: FrenchUnitsPage },
  ] as const)(
    "opens three asset browse categories in $locale while keeping maintenance secondary",
    async ({ locale, page }) => {
      const whole = await page({ searchParams: Promise.resolve({ assetCategory: "whole" }) });
      expect(findProps(whole, OperatingAssetDirectoryPage)).toMatchObject({
        category: "whole",
        assetBrowse: true,
        viewerId: "viewer",
        locale,
      });
      expect(findProps(whole, AssetBrowseNavigation)).toMatchObject({
        category: "whole",
        canReadOperatingAssets: true,
        maintenance: false,
      });
      const apartment = await page({
        searchParams: Promise.resolve({ assetCategory: "apartment", assetView: "operations" }),
      });
      expect(findProps(apartment, OperatingAssetDirectoryPage)).toBeUndefined();
      mocks.getCurrentUser.mockResolvedValue({ id: "viewer", role: "rental_sales" });
      const limited = await page({
        searchParams: Promise.resolve({ assetCategory: "whole", assetView: "operations" }),
      });
      expect(findProps(limited, OperatingAssetDirectoryPage)).toBeUndefined();
      expect(findProps(limited, AssetBrowseNavigation)).toMatchObject({
        category: "apartment",
        canReadOperatingAssets: false,
      });
    },
  );

  it("passes the same operating asset selection to the shared directory from both routes", async () => {
    const leases = await LeasesPage({
      searchParams: Promise.resolve({ assetCategory: "land", operatingAsset: assetId }),
    });
    const units = await UnitsPage({
      searchParams: Promise.resolve({ assetView: "operations", operatingAsset: assetId }),
    });
    expect(findProps(leases, OperatingAssetDirectoryPage)).toMatchObject({
      category: "whole",
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
    expect(findProps(leases, UnifiedLeaseCollectionsPage)).toBeUndefined();
    expect(findProps(leases, OperatingAssetNavigation)).toBeUndefined();
    expect(findProps(units, OperatingAssetDirectoryPage)).toBeUndefined();
    expect(findProps(units, OperatingAssetNavigation)).toBeUndefined();
  });

  it.each([
    { locale: "zh", page: LeasesPage },
    { locale: "fr", page: FrenchLeasesPage },
  ] as const)(
    "defaults to apartments and restores only valid $locale browse preferences",
    async ({ locale, page }) => {
      const open = (params = {}) => page({ searchParams: Promise.resolve(params) });
      const first = await open();
      expect(findProps(first, OperatingAssetDirectoryPage)).toBeUndefined();

      mocks.cookieGet.mockReturnValue({ value: "warehouse" });
      const remembered = await open();
      expect(mocks.cookieGet).toHaveBeenCalledWith("sacsi_lease_category_v1_viewer");
      expect(findProps(remembered, OperatingAssetDirectoryPage)).toMatchObject({
        category: "multi-unit",
        locale,
      });
      const retired = await open({ assetCategory: "all", q: "  " });
      expect(findProps(retired, OperatingAssetDirectoryPage)).toMatchObject({
        category: "multi-unit",
      });
      for (const params of [
        { assetCategory: "apartment" },
        { project: "SACSI", building: assetId, contract: assetId },
      ]) {
        expect(findProps(await open(params), OperatingAssetDirectoryPage)).toBeUndefined();
      }
      const search = await open({ assetCategory: "warehouse", q: "  国基  " });
      expect(findProps(search, OperatingAssetDirectoryPage)).toMatchObject({
        category: undefined,
        searchCategory: "multi-unit",
        searchQuery: "国基",
        locale,
      });

      const followup = await page({
        searchParams: Promise.resolve({
          assetCategory: "followup",
          collectionCategory: "warehouse",
        }),
      });
      const dormitory = await page({
        searchParams: Promise.resolve({ assetCategory: "dormitory" }),
      });
      expect(findProps(followup, UnifiedLeaseCollectionsPage)).toMatchObject({
        initialCategory: "multi-unit",
        locale,
      });
      expect(findProps(dormitory, OperatingAssetDirectoryPage)).toMatchObject({
        category: "whole",
        locale,
      });
      expect(
        findProps(await open({ assetCategory: "followup" }), UnifiedLeaseCollectionsPage),
      ).toMatchObject({ initialCategory: "all", locale });
    },
  );

  it("includes assets with incomplete rental evidence in the shared directory and avoids duplicating linked units", async () => {
    const projectId = "test-sacsi";
    const warehouse: AssetOperationAsset = {
      id: assetId,
      projectId,
      unitId: null,
      sourceKey: "test-warehouse",
      code: "TEST-01",
      name: "Warehouse 1",
      group: "old_warehouse",
      verification: "verified",
      sourceRefs: [],
      monthlyRentNative: null,
      rentCurrency: null,
      costCoverageThrough: null,
      updatedAt: "2026-11-09T00:00:00Z",
    };
    const wholeAsset = {
      ...warehouse,
      id: "whole-asset",
      code: "TEST-WHOLE",
      name: "Standalone warehouse",
      sourceKey: "test-standalone",
      group: "Independent site",
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
        wholeAsset,
      ],
      entries: [
        receipt,
        { ...receipt, id: "canonical-receipt", assetId: "canonical" },
        { ...receipt, id: "voided-receipt", assetId: "voided-only", voidedAt: "2026-11-09" },
      ],
    });

    const search = await OperatingAssetDirectoryPage({
      locale: "zh",
      searchCategory: "apartment",
      searchQuery: "TEST-01",
      viewerId: "viewer",
      selectedAssetId: "no-receipt",
    });
    expect(search).toMatchObject({
      props: {
        category: "all",
        enableCollections: true,
        initialView: "cards",
        browseViewerId: "viewer",
        searchCategory: "apartment",
        searchQuery: "TEST-01",
        selectedAssetId: "no-receipt",
        apartmentRows: [],
        data: {
          assets: [assetId, "no-receipt", "voided-only"].map((id) =>
            expect.objectContaining({ id }),
          ),
          entries: ["receipt", "voided-receipt"].map((id) => expect.objectContaining({ id })),
        },
      },
    });

    const directory = await OperatingAssetDirectoryPage({
      locale: "zh",
      category: "multi-unit",
      viewerId: "viewer",
    });
    expect(directory).toMatchObject({
      props: {
        leaseCategory: "multi-unit",
        initialView: "cards",
        data: {
          assets: [assetId, "no-receipt", "voided-only"].map((id) =>
            expect.objectContaining({ id }),
          ),
        },
      },
    });

    const legacySelection = await OperatingAssetDirectoryPage({
      locale: "zh",
      category: "multi-unit",
      viewerId: "viewer",
      selectedAssetId: wholeAsset.id,
    });
    expect(legacySelection).toMatchObject({
      props: {
        leaseCategory: "whole",
        selectedAssetId: wholeAsset.id,
        data: { assets: [expect.objectContaining({ id: wholeAsset.id })] },
      },
    });
  });

  it("keeps bookmarks to maintenance and reports under Assets in both languages", () => {
    expect(() => LegacyOperationsPage()).toThrow("/units?assetView=maintenance");
    expect(() => LegacyFrenchOperationsPage()).toThrow("/fr/units?assetView=maintenance");
  });
});
