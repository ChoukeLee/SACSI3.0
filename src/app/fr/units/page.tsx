import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { UnitLazyView } from "@/features/units/unit-lazy-view";
import { loadUnitPageData } from "@/features/units/unit-page-data";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";

export default async function FrenchUnitsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "finance", "boss", "rental_sales"].includes(user.role)) redirect("/");

  return (
    <Suspense fallback={<OperationalPageSkeleton kind="records" rows={8} />}>
      <FrenchUnitsData canEdit={user.role === "admin"} />
    </Suspense>
  );
}

async function FrenchUnitsData({ canEdit }: { canEdit: boolean }) {
  const data = await loadUnitPageData();
  return <UnitLazyView {...data} locale="fr" canEdit={canEdit} />;
}
