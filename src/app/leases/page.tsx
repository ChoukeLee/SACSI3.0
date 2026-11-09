import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LeaseLazyView } from "@/features/leases/lease-lazy-view";
import { loadLeaseWorkspace } from "@/features/leases/lease-workspace-data";
import { LeaseWorkbenchFrame } from "@/features/leases/lease-workbench-frame";
import { UnifiedLeaseCollectionsPage } from "@/features/leases/unified-lease-collections-page";
import { parseCollectionCategory } from "@/features/leases/unified-lease-collections-model";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";
import { redirectLegacyCimac } from "@/features/cimac/cimac-legacy-redirect";
import {
  canReadOperatingAssets,
  leaseCollectionHref,
  OperatingAssetDirectoryPage,
  OperatingAssetNavigation,
  parseLeaseAssetCategory,
  parseOperatingAssetId,
} from "@/features/asset-operations/operating-asset-page";

export default async function LeasesPage({
  searchParams,
}: {
  searchParams: Promise<{
    project?: string | string[];
    building?: string | string[];
    contract?: string | string[];
    returnTo?: string | string[];
    assetCategory?: string | string[];
    collectionCategory?: string | string[];
    operatingAsset?: string | string[];
  }>;
}) {
  const params = await searchParams;
  if (Array.isArray(params.project) || Array.isArray(params.building))
    throw new Error("ContractProjectUnavailable");
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "front_desk", "finance", "boss", "rental_sales"].includes(user.role))
    redirect("/");
  if (user.role === "front_desk") {
    const query = new URLSearchParams();
    for (const key of ["project", "building", "contract", "returnTo"] as const) {
      const value = params[key];
      if (typeof value === "string") query.set(key, value);
    }
    redirect(`/fr/leases${query.size ? `?${query}` : ""}`);
  }

  await redirectLegacyCimac("leases", params, "zh");
  const showAssetCategories = canReadOperatingAssets(user.role);
  const category = showAssetCategories ? parseLeaseAssetCategory(params.assetCategory) : undefined;
  const navigation = showAssetCategories ? (
    <OperatingAssetNavigation area="leases" locale="zh" category={category} />
  ) : null;

  return (
    <Suspense fallback={<OperationalPageSkeleton kind="records" rows={8} />}>
      {category ? (
        <LeaseWorkbenchFrame locale="zh" navigation={navigation}>
          {category === "followup" ? (
            <UnifiedLeaseCollectionsPage
              locale="zh"
              viewerId={user.id}
              project={params.project}
              initialCategory={parseCollectionCategory(params.collectionCategory)}
            />
          ) : (
            <OperatingAssetDirectoryPage
              locale="zh"
              category={category}
              project={params.project}
              viewerId={user.id}
              selectedAssetId={parseOperatingAssetId(params.operatingAsset)}
            />
          )}
        </LeaseWorkbenchFrame>
      ) : (
        <LeasesData
          viewerId={user.id}
          initialProject={params.project}
          initialBuilding={typeof params.building === "string" ? params.building : undefined}
          initialContract={typeof params.contract === "string" ? params.contract : undefined}
          returnTo={typeof params.returnTo === "string" ? params.returnTo : undefined}
          categoryNavigation={navigation}
          collectionHref={showAssetCategories ? leaseCollectionHref("zh", "apartment") : undefined}
          locale="zh"
          canCreate={user.role === "admin" || user.role === "rental_sales"}
          canRecordFinance={user.role === "admin" || user.role === "finance"}
          canCorrectRentPeriod={user.role === "admin"}
          canActivate={user.role === "admin" || user.role === "rental_sales"}
          canMoveOut={user.role === "admin" || user.role === "finance"}
        />
      )}
    </Suspense>
  );
}

async function LeasesData({
  viewerId,
  initialProject,
  initialBuilding,
  initialContract,
  returnTo,
  categoryNavigation,
  collectionHref,
  locale,
  canCreate,
  canRecordFinance,
  canCorrectRentPeriod,
  canActivate,
  canMoveOut,
}: {
  viewerId: string;
  initialProject?: string;
  initialBuilding?: string;
  initialContract?: string;
  returnTo?: string;
  categoryNavigation?: ReactNode;
  collectionHref?: string;
  locale: "zh" | "fr";
  canCreate: boolean;
  canRecordFinance: boolean;
  canCorrectRentPeriod: boolean;
  canActivate: boolean;
  canMoveOut: boolean;
}) {
  const data = await loadLeaseWorkspace(locale, initialProject, viewerId, initialBuilding);
  return (
    <LeaseLazyView
      key={viewerId}
      {...data}
      initialProject={initialProject}
      initialBuilding={initialBuilding}
      initialContract={initialContract}
      returnTo={returnTo}
      categoryNavigation={categoryNavigation}
      collectionHref={collectionHref}
      locale={locale}
      canCreate={canCreate}
      canRecordFinance={canRecordFinance}
      canCorrectRentPeriod={canCorrectRentPeriod}
      canActivate={canActivate}
      canMoveOut={canMoveOut}
    />
  );
}
