import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { SecurityCenter } from "@/features/security";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const user = await getCurrentUser();
  if (!user || !["admin", "boss"].includes(user.role)) redirect("/");

  return (
    <>
      <PageHeader title="安全中心" description="安全检查、数据备份、敏感操作保护" />
      <section className="mt-8"><SecurityCenter locale="zh" /></section>
    </>
  );
}
