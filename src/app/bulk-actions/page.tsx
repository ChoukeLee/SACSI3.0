import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { BulkActionCenter } from "@/features/bulk-actions";

export const dynamic = "force-dynamic";

export default async function BulkActionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance", "front_desk"].includes(user.role)) redirect("/");

  return (
    <>
      <PageHeader title="批量操作中心" description="对权限范围内的数据进行批量处理：生成应收、确认收款、修改房态、处理预订、导出清单" />
      <section className="mt-8">
        <BulkActionCenter locale="zh" userRole={user.role} />
      </section>
    </>
  );
}
