import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { DesktopOnly } from "@/features/mobile";
import { AuditLogViewer } from "@/features/settings";

export const dynamic = "force-dynamic";

interface AuditLogRow {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

export default async function AuditLogsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance"].includes(user.role)) redirect("/");

  const supabase = await createClient();

  let query = supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  // Finance role: filter to financial entities only
  if (user.role === "finance") {
    query = query.in("entity_type", [
      "payment", "receivable", "ledger_entry",
      "lease_contract", "sale_contract", "daily_booking",
    ]);
  }
  // Admin/boss: get all (RLS also enforces this server-side)

  const { data } = await query;
  const logs = (data ?? []) as unknown as AuditLogRow[];

  return (
    <>
      <div className="lg:hidden">
        <DesktopOnly locale="zh" />
      </div>
      <div className="hidden lg:block">
        <PageHeader
          title="审计日志"
          description="记录系统关键操作的变更历史：谁在什么时候创建、修改、删除了什么"
        />
        <section className="mt-8">
          <AuditLogViewer logs={logs} locale="zh" />
        </section>
      </div>
    </>
  );
}
