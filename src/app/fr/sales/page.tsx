import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { SaleLazyView } from "@/features/sales/sale-lazy-view";
import { loadSaleWorkspace, type SaleSearchParams } from "@/features/sales/sale-workspace-data";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";

export default async function FrenchSalesPage({
  searchParams,
}: {
  searchParams: Promise<SaleSearchParams>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "finance", "boss", "rental_sales"].includes(user.role)) redirect("/");

  return (
    <Suspense fallback={<OperationalPageSkeleton kind="records" rows={8} />}>
      <FrenchSalesData params={params} role={user.role} />
    </Suspense>
  );
}

async function FrenchSalesData({ params, role }: { params: SaleSearchParams; role: string }) {
  const data = await loadSaleWorkspace("fr", params);
  const canOperateSales = role === "admin" || role === "rental_sales";
  return (
    <SaleLazyView
      {...data}
      key={JSON.stringify(params)}
      locale="fr"
      canCreate={canOperateSales}
      canRecordFinance={role === "admin" || role === "finance"}
      canManage={canOperateSales}
      canTerminate={role === "admin"}
    />
  );
}
