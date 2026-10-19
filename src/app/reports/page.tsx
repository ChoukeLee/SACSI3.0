import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";
import { ReportsView } from "@/features/reports/reports-view";
import { loadReportData } from "@/features/reports/report-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ReportParams = Record<string, string | string[] | undefined>;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<ReportParams>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance"].includes(user.role)) redirect("/");

  return (
    <div className="space-y-5">
      <Suspense fallback={<OperationalPageSkeleton kind="table" rows={8} />}>
        <ReportsData params={searchParams} />
      </Suspense>
    </div>
  );
}

async function ReportsData({ params }: { params: Promise<ReportParams> }) {
  const data = await loadReportData(await params);
  return <ReportsView data={data} locale="zh" />;
}
