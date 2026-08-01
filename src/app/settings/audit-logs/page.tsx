import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DesktopOnly } from "@/features/mobile";
import { AuditLogViewer } from "@/features/settings";
import { enrichAuditLogsWithUnitNumbers, type AuditLogRow } from "@/features/settings/audit-log-enrichment";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AuditLogsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss"].includes(user.role)) redirect("/");

  const supabase = await createClient();

  const query = supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  const { data } = await query;
  const logs = await enrichAuditLogsWithUnitNumbers(supabase, (data ?? []) as unknown as AuditLogRow[]);

  return (
    <>
      <div className="lg:hidden">
        <DesktopOnly locale="zh" />
      </div>
      <div className="hidden lg:block">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">审计日志</h1>
        <section className="mt-8">
          <AuditLogViewer logs={logs} locale="zh" />
        </section>
      </div>
    </>
  );
}
