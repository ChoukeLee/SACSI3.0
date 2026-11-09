import { Children, isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LeasesPage from "@/app/leases/page";
import UnitsPage from "@/app/units/page";
import LegacyOperationsPage from "@/app/asset-operations/page";
import LegacyFrenchOperationsPage from "@/app/fr/asset-operations/page";
import {
  OperatingAssetDirectoryPage,
  OperatingAssetNavigation,
} from "@/features/asset-operations/operating-asset-page";

const mocks = vi.hoisted(() => ({
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
  fetchAssetOperations: vi.fn(),
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
      searchParams: Promise.resolve({ assetCategory: "land", operatingAsset: assetId }),
    });
    const units = await UnitsPage({
      searchParams: Promise.resolve({ assetView: "operations", operatingAsset: assetId }),
    });
    expect(findProps(leases, OperatingAssetDirectoryPage)).toBeUndefined();
    expect(findProps(leases, OperatingAssetNavigation)).toBeUndefined();
    expect(findProps(units, OperatingAssetDirectoryPage)).toBeUndefined();
    expect(findProps(units, OperatingAssetNavigation)).toBeUndefined();
  });

  it("keeps bookmarks to maintenance and reports under Assets in both languages", () => {
    expect(() => LegacyOperationsPage()).toThrow("/units?assetView=maintenance");
    expect(() => LegacyFrenchOperationsPage()).toThrow("/fr/units?assetView=maintenance");
  });
});
