import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  UnitWorkbenchWorkspace,
  UnitWorkbenchSkeleton,
} from "@/features/units/unit-workbench-workspace";
import type { UnitWorkbenchSearch } from "@/features/units/unit-workbench-model";
import { redirectLegacyCimac } from "@/features/cimac/cimac-legacy-redirect";
import { AssetOperationsPage } from "@/features/asset-operations/asset-operations-page";
import {
  AssetBrowseNavigation,
  parseAssetBrowseCategory,
} from "@/features/units/asset-browse-navigation";
import {
  canReadOperatingAssets,
  OperatingAssetDirectoryPage,
  parseAssetOperatingView,
  parseOperatingAssetId,
} from "@/features/asset-operations/operating-asset-page";

export default async function FrenchUnitsPage({
  searchParams,
}: {
  searchParams: Promise<UnitWorkbenchSearch>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "finance", "boss", "rental_sales"].includes(user.role)) redirect("/");
  const params = await searchParams;
  await redirectLegacyCimac("units", params, "fr");
  const showOperatingAssets = canReadOperatingAssets(user.role);
  const view = showOperatingAssets ? parseAssetOperatingView(params.assetView) : undefined;
  const category = showOperatingAssets
    ? parseAssetBrowseCategory(params.assetCategory, view === "operations")
    : "apartment";

  return (
    <>
      <AssetBrowseNavigation
        locale="fr"
        category={category}
        canReadOperatingAssets={showOperatingAssets}
        maintenance={view === "maintenance"}
        project={typeof params.project === "string" ? params.project : undefined}
      />
      <Suspense fallback={<UnitWorkbenchSkeleton locale="fr" />}>
        {view === "maintenance" ? (
          <AssetOperationsPage locale="fr" />
        ) : category !== "apartment" ? (
          <OperatingAssetDirectoryPage
            locale="fr"
            category={category}
            assetBrowse
            viewerId={user.id}
            project={typeof params.project === "string" ? params.project : undefined}
            selectedAssetId={parseOperatingAssetId(params.operatingAsset)}
          />
        ) : (
          <UnitWorkbenchWorkspace
            input={params}
            locale="fr"
            canEdit={user.role === "admin"}
            viewerId={user.id}
          />
        )}
      </Suspense>
    </>
  );
}
