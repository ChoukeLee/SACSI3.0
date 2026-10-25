import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { SaleLazyView } from "@/features/sales/sale-lazy-view";
import { loadSaleWorkspace, type SaleSearchParams } from "@/features/sales/sale-workspace-data";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";
import { redirectLegacyCimac } from "@/features/cimac/cimac-legacy-redirect";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<SaleSearchParams>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "finance", "boss", "rental_sales"].includes(user.role)) redirect("/");
  await redirectLegacyCimac("sales", params, "zh");

  return (
    <Suspense fallback={<OperationalPageSkeleton kind="records" rows={8} />}>
      <SalesData params={params} locale="zh" role={user.role} />
    </Suspense>
  );
}

async function SalesData({
  params,
  locale,
  role,
}: {
  params: SaleSearchParams;
  locale: "zh" | "fr";
  role: string;
}) {
  const data = await loadSaleWorkspace(locale, params);
  const canOperateSales = role === "admin" || role === "rental_sales";
  return (
    <SaleLazyView
      {...data}
      key={JSON.stringify(params)}
      locale={locale}
      canCreate={canOperateSales}
      canRecordFinance={role === "admin" || role === "finance"}
      canManage={canOperateSales}
      canTerminate={role === "admin"}
    />
  );
}
