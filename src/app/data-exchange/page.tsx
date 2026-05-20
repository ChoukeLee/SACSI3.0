import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { DataExchangeCenter } from "@/features/data-exchange";

export const dynamic = "force-dynamic";

export default async function DataExchangePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance", "front_desk"].includes(user.role)) redirect("/");

  return (
    <>
      <PageHeader title="导入导出中心" description="按模块导出客户、房源、合同、应收、收款数据为 CSV，或批量导入新数据" />
      <section className="mt-8">
        <DataExchangeCenter locale="zh" userRole={user.role} />
      </section>
    </>
  );
}
