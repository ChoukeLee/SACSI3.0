import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DesktopOnly } from "@/features/mobile";
import { AuditLogViewer } from "@/features/settings";
import { enrichAuditLogsWithUnitNumbers, type AuditLogRow } from "@/features/settings/audit-log-enrichment";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function FrenchAuditLogsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance", "rental_sales"].includes(user.role)) redirect("/");

  const supabase = await createClient();

  let query = supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  if (user.role === "finance") {
    query = query.in("entity_type", [
      "payment", "receivable", "ledger_entry",
      "lease_contract", "sale_contract", "daily_booking",
    ]);
  }

  const { data } = await query;
  const logs = await enrichAuditLogsWithUnitNumbers(supabase, (data ?? []) as unknown as AuditLogRow[]);

  return (
    <>
      <div className="lg:hidden">
        <DesktopOnly locale="fr" />
      </div>
      <div className="hidden lg:block">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Journal d'audit</h1>
        <section className="mt-8">
          <AuditLogViewer logs={logs} locale="fr" />
        </section>
      </div>
    </>
  );
}
