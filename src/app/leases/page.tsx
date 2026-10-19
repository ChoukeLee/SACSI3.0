import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LeaseLazyView } from "@/features/leases/lease-lazy-view";
import { loadLeaseWorkspace } from "@/features/leases/lease-workspace-data";
import { DesktopOnly } from "@/features/mobile";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";

export default async function LeasesPage({
  searchParams,
}: {
  searchParams: Promise<{
    project?: string | string[];
    building?: string | string[];
    contract?: string | string[];
    returnTo?: string | string[];
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

  return (
    <>
      <div className="lg:hidden">
        <DesktopOnly locale="zh" />
      </div>
      <div className="hidden lg:block">
        <Suspense fallback={<OperationalPageSkeleton kind="records" rows={8} />}>
          <LeasesData
            viewerId={user.id}
            initialProject={params.project}
            initialBuilding={typeof params.building === "string" ? params.building : undefined}
            initialContract={typeof params.contract === "string" ? params.contract : undefined}
            returnTo={typeof params.returnTo === "string" ? params.returnTo : undefined}
            locale="zh"
            canCreate={user.role === "admin" || user.role === "rental_sales"}
            canRecordFinance={user.role === "admin" || user.role === "finance"}
            canCorrectRentPeriod={user.role === "admin"}
            canActivate={user.role === "admin" || user.role === "rental_sales"}
            canMoveOut={user.role === "admin" || user.role === "finance"}
          />
        </Suspense>
      </div>
    </>
  );
}

async function LeasesData({
  viewerId,
  initialProject,
  initialBuilding,
  initialContract,
  returnTo,
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
      locale={locale}
      canCreate={canCreate}
      canRecordFinance={canRecordFinance}
      canCorrectRentPeriod={canCorrectRentPeriod}
      canActivate={canActivate}
      canMoveOut={canMoveOut}
    />
  );
}
