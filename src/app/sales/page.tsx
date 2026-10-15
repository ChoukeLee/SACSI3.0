import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { SaleLazyView } from "@/features/sales/sale-lazy-view";
import { getSalePageData } from "@/features/sales/sale-page-data";
import { DesktopOnly } from "@/features/mobile";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string | string[] }>;
}) {
  const params = await searchParams;
  if (Array.isArray(params.project)) throw new Error("ContractProjectUnavailable");
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "finance", "boss", "rental_sales"].includes(user.role)) redirect("/");

  return (
    <>
      <div className="lg:hidden">
        <DesktopOnly locale="zh" />
      </div>
      <div className="hidden lg:block">
        <Suspense fallback={<OperationalPageSkeleton kind="records" rows={8} />}>
          <SalesData initialProject={params.project} locale="zh" role={user.role} />
        </Suspense>
      </div>
    </>
  );
}

async function SalesData({
  initialProject,
  locale,
  role,
}: {
  initialProject?: string;
  locale: "zh" | "fr";
  role: string;
}) {
  const data = await getSalePageData();
  const canOperateSales = role === "admin" || role === "rental_sales";
  return (
    <SaleLazyView
      {...data}
      initialProject={initialProject}
      locale={locale}
      canCreate={canOperateSales}
      canRecordFinance={role === "admin" || role === "finance"}
      canManage={canOperateSales}
      canTerminate={role === "admin"}
    />
  );
}
