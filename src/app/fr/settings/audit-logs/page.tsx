import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DesktopOnly } from "@/features/mobile";
import { AuditLogViewer } from "@/features/settings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

export default async function FrenchAuditLogsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance"].includes(user.role)) redirect("/");

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
        <h1 className="mb-6 text-2xl font-bold tracking-tight">Journal d'audit</h1>
        <section className="mt-8">
          <AuditLogViewer logs={logs} locale="fr" />
        </section>
      </div>
    </>
  );
}

async function enrichAuditLogsWithUnitNumbers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  logs: AuditLogRow[],
) {
  const bookingIds = Array.from(new Set(logs
    .filter((log) => log.entity_type === "daily_booking" && log.entity_id)
    .map((log) => log.entity_id as string)));

  const bookingToUnitId = new Map<string, string>();
  if (bookingIds.length > 0) {
    const { data: bookings } = await supabase
      .from("daily_bookings")
      .select("id, unit_id")
      .in("id", bookingIds);

    for (const booking of bookings ?? []) {
      if (booking.id && booking.unit_id) {
        bookingToUnitId.set(booking.id, booking.unit_id);
      }
    }
  }

  const unitIds = new Set<string>();
  for (const log of logs) {
    const metadataUnitId = typeof log.metadata?.unit_id === "string" ? log.metadata.unit_id : null;
    if (metadataUnitId) unitIds.add(metadataUnitId);
    const bookingUnitId = log.entity_id ? bookingToUnitId.get(log.entity_id) : null;
    if (bookingUnitId) unitIds.add(bookingUnitId);
  }

  const unitIdToNo = new Map<string, string>();
  if (unitIds.size > 0) {
    const { data: units } = await supabase
      .from("units")
      .select("id, unit_no")
      .in("id", Array.from(unitIds));

    for (const unit of units ?? []) {
      if (unit.id && unit.unit_no) {
        unitIdToNo.set(unit.id, unit.unit_no);
      }
    }
  }

  return logs.map((log) => {
    const metadataUnitNo = typeof log.metadata?.unit_no === "string" ? log.metadata.unit_no : null;
    if (metadataUnitNo) return log;

    const metadataUnitId = typeof log.metadata?.unit_id === "string" ? log.metadata.unit_id : null;
    const bookingUnitId = log.entity_id ? bookingToUnitId.get(log.entity_id) : null;
    const unitNo = unitIdToNo.get(metadataUnitId ?? "") ?? unitIdToNo.get(bookingUnitId ?? "");
    if (!unitNo) return log;

    return {
      ...log,
      metadata: {
        ...(log.metadata ?? {}),
        unit_no: unitNo,
      },
    };
  });
}
