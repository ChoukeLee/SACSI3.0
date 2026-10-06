import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { dictionaries } from "@/lib/i18n";
import { FinanceWorkspace } from "@/features/finance/finance-workspace";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance"].includes(user.role)) redirect("/");
  return (
    <div className="space-y-5">
      <PageHeader title={dictionaries.zh.finance.title} description={dictionaries.zh.finance.description} />
      <Suspense fallback={<OperationalPageSkeleton kind="table" rows={8} />}>
        <FinanceWorkspace params={await searchParams} locale="zh" canWrite={user.role === "admin" || user.role === "finance"} />
      </Suspense>
    </div>
  );
}
