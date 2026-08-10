import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { UnitLazyView } from "@/features/units/unit-lazy-view";
import { loadUnitPageData } from "@/features/units/unit-page-data";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";

export default async function UnitsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "finance", "boss", "rental_sales"].includes(user.role)) redirect("/");

  return (
    <Suspense fallback={<OperationalPageSkeleton kind="records" rows={8} />}>
      <UnitsData locale="zh" canEdit={user.role === "admin"} />
    </Suspense>
  );
}

async function UnitsData({ locale, canEdit }: { locale: "zh" | "fr"; canEdit: boolean }) {
  const data = await loadUnitPageData();
  return <UnitLazyView {...data} locale={locale} canEdit={canEdit} />;
}
