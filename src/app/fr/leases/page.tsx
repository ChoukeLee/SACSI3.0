import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LeaseLazyView } from "@/features/leases/lease-lazy-view";
import { LeaseBrowsePreference } from "@/features/leases/lease-browse-toolbar";
import { loadLeaseWorkspace } from "@/features/leases/lease-workspace-data";
import {
  LeaseCollectionsBackLink,
  LeaseWorkbenchFrame,
} from "@/features/leases/lease-workbench-frame";
import { UnifiedLeaseCollectionsPage } from "@/features/leases/unified-lease-collections-page";
import { parseCollectionCategory } from "@/features/leases/unified-lease-collections-model";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";
import { redirectLegacyCimac } from "@/features/cimac/cimac-legacy-redirect";
import {
  canReadOperatingAssets,
  OperatingAssetDirectoryPage,
  parseOperatingAssetId,
  readLeaseBrowseView,
} from "@/features/asset-operations/operating-asset-page";

export default async function FrenchLeasesPage({
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
    q?: string | string[];
  }>;
}) {
  const params = await searchParams;
  if (Array.isArray(params.project) || Array.isArray(params.building))
    throw new Error("ContractProjectUnavailable");
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "front_desk", "finance", "boss", "rental_sales"].includes(user.role))
    redirect("/");
  await redirectLegacyCimac("leases", params, "fr");
  const browseViewerId = canReadOperatingAssets(user.role) ? user.id : undefined;
  const { category, searchQuery, rememberCategory } = browseViewerId
    ? await readLeaseBrowseView(params, browseViewerId)
    : { category: "apartment" as const, searchQuery: "", rememberCategory: false };

  return (
    <Suspense fallback={<OperationalPageSkeleton kind="records" rows={8} />}>
      {browseViewerId && rememberCategory && category !== "followup" ? (
        <LeaseBrowsePreference viewerId={browseViewerId} category={category} />
      ) : null}
      {category === "followup" ? (
        <LeaseWorkbenchFrame
          locale="fr"
          view="collections"
          action={<LeaseCollectionsBackLink locale="fr" />}
        >
          <UnifiedLeaseCollectionsPage
            locale="fr"
            viewerId={user.id}
            project={params.project}
            initialCategory={parseCollectionCategory(params.collectionCategory)}
          />
        </LeaseWorkbenchFrame>
      ) : searchQuery || category !== "apartment" ? (
        <LeaseWorkbenchFrame locale="fr">
          <OperatingAssetDirectoryPage
            locale="fr"
            category={!searchQuery && category !== "apartment" ? category : undefined}
            searchQuery={searchQuery || undefined}
            searchCategory={searchQuery ? category : undefined}
            project={params.project}
            viewerId={user.id}
            selectedAssetId={parseOperatingAssetId(params.operatingAsset)}
          />
        </LeaseWorkbenchFrame>
      ) : (
        <FrenchLeasesData
          viewerId={user.id}
          initialProject={params.project}
          initialBuilding={typeof params.building === "string" ? params.building : undefined}
          initialContract={typeof params.contract === "string" ? params.contract : undefined}
          returnTo={typeof params.returnTo === "string" ? params.returnTo : undefined}
          browseViewerId={browseViewerId}
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

async function FrenchLeasesData({
  viewerId,
  initialProject,
  initialBuilding,
  initialContract,
  returnTo,
  browseViewerId,
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
  browseViewerId?: string;
  canCreate: boolean;
  canRecordFinance: boolean;
  canCorrectRentPeriod: boolean;
  canActivate: boolean;
  canMoveOut: boolean;
}) {
  const data = await loadLeaseWorkspace("fr", initialProject, viewerId, initialBuilding);
  return (
    <LeaseLazyView
      key={viewerId}
      {...data}
      initialProject={initialProject}
      initialBuilding={initialBuilding}
      initialContract={initialContract}
      returnTo={returnTo}
      browseViewerId={browseViewerId}
      locale="fr"
      canCreate={canCreate}
      canRecordFinance={canRecordFinance}
      canCorrectRentPeriod={canCorrectRentPeriod}
      canActivate={canActivate}
      canMoveOut={canMoveOut}
    />
  );
}
