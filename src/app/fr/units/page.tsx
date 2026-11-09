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
  canReadOperatingAssets,
  OperatingAssetDirectoryPage,
  OperatingAssetNavigation,
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

  return (
    <>
      {showOperatingAssets ? (
        <OperatingAssetNavigation area="units" locale="fr" view={view} />
      ) : null}
      <Suspense fallback={<UnitWorkbenchSkeleton locale="fr" />}>
        {view === "maintenance" ? (
          <AssetOperationsPage locale="fr" />
        ) : view === "operations" ? (
          <OperatingAssetDirectoryPage
            locale="fr"
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
