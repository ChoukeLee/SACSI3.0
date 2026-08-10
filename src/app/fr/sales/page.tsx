import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { SaleLazyView } from "@/features/sales/sale-lazy-view";
import { getSalePageData } from "@/features/sales/sale-page-data";
import { DesktopOnly } from "@/features/mobile";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";

export default async function FrenchSalesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "finance", "boss", "rental_sales"].includes(user.role)) redirect("/");

  return (
    <>
      <div className="lg:hidden"><DesktopOnly locale="fr" /></div>
      <div className="hidden lg:block">
        <Suspense fallback={<OperationalPageSkeleton kind="records" rows={8} />}>
          <FrenchSalesData role={user.role} />
        </Suspense>
      </div>
    </>
  );
}

async function FrenchSalesData({ role }: { role: string }) {
  const data = await getSalePageData();
  return <SaleLazyView {...data} locale="fr" canCreate={role === "admin"} canRecordFinance={role === "admin" || role === "finance"} canManage={role === "admin"} />;
}
