import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";
import { ReportsView } from "@/features/reports";
import { loadReportData } from "@/features/reports/report-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ReportsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance"].includes(user.role)) redirect("/");

  return (
    <div className="space-y-5">
      <PageHeader title="报表" description="月度收支、楼栋利润与收入支出构成" />
      <Suspense fallback={<OperationalPageSkeleton kind="table" rows={8} />}>
        <ReportsData locale="zh" />
      </Suspense>
    </div>
  );
}

async function ReportsData({ locale }: { locale: "zh" | "fr" }) {
  const data = await loadReportData();
  return <ReportsView entries={data.entries} buildings={data.buildings} units={data.units} dailyBookings={data.dailyBookings} dailyPayments={data.dailyPayments} dailyUnitIds={data.dailyUnitIds} locale={locale} />;
}