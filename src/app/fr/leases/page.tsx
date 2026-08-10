import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LeaseLazyView } from "@/features/leases/lease-lazy-view";
import { loadLeasePageData } from "@/features/leases/lease-page-data";
import { DesktopOnly } from "@/features/mobile";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";

export default async function FrenchLeasesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "front_desk", "finance", "boss", "rental_sales"].includes(user.role)) redirect("/");

  return (
    <>
      <div className="lg:hidden"><DesktopOnly locale="fr" /></div>
      <div className="hidden lg:block">
        <Suspense fallback={<OperationalPageSkeleton kind="records" rows={8} />}>
          <FrenchLeasesData canCreate={user.role === "admin" || user.role === "rental_sales"} canRecordFinance={user.role === "admin" || user.role === "finance"} canActivate={user.role === "admin" || user.role === "rental_sales"} canMoveOut={user.role === "admin" || user.role === "finance"} />
        </Suspense>
      </div>
    </>
  );
}

async function FrenchLeasesData({ canCreate, canRecordFinance, canActivate, canMoveOut }: { canCreate: boolean; canRecordFinance: boolean; canActivate: boolean; canMoveOut: boolean }) {
  const data = await loadLeasePageData();
  return <LeaseLazyView {...data} locale="fr" canCreate={canCreate} canRecordFinance={canRecordFinance} canActivate={canActivate} canMoveOut={canMoveOut} />;
}
