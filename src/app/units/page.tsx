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

export default async function UnitsPage({
  searchParams,
}: {
  searchParams: Promise<UnitWorkbenchSearch>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "finance", "boss", "rental_sales"].includes(user.role)) redirect("/");
  const params = await searchParams;
  await redirectLegacyCimac("units", params, "zh");
  const showOperatingAssets = canReadOperatingAssets(user.role);
  const view = showOperatingAssets ? parseAssetOperatingView(params.assetView) : undefined;

  return (
    <>
      {showOperatingAssets ? <OperatingAssetNavigation locale="zh" view={view} /> : null}
      <Suspense fallback={<UnitWorkbenchSkeleton locale="zh" />}>
        {view === "maintenance" ? (
          <AssetOperationsPage locale="zh" />
        ) : view === "operations" ? (
          <OperatingAssetDirectoryPage
            locale="zh"
            project={typeof params.project === "string" ? params.project : undefined}
            selectedAssetId={parseOperatingAssetId(params.operatingAsset)}
          />
        ) : (
          <UnitWorkbenchWorkspace
            input={params}
            locale="zh"
            canEdit={user.role === "admin"}
            viewerId={user.id}
          />
        )}
      </Suspense>
    </>
  );
}
