import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { FinanceWorkspace } from "@/features/finance/finance-workspace";
import { FinanceWorkbenchSkeleton } from "@/features/finance/finance-workbench-skeleton";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance"].includes(user.role)) redirect("/");
  return (
    <div className="space-y-5">
      <Suspense fallback={<FinanceWorkbenchSkeleton locale="zh" />}>
        <FinanceWorkspace
          params={await searchParams}
          locale="zh"
          canWrite={user.role === "admin" || user.role === "finance"}
        />
      </Suspense>
    </div>
  );
}
