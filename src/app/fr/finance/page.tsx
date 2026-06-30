import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sortUnits } from "@/lib/utils";
import { LedgerList } from "@/features/finance";
import { ReceivableList } from "@/features/finance/receivable-list";
import { FinanceTabs } from "@/features/finance/finance-tabs";
import { PageHeader } from "@/components/page-header";
import type { LedgerEntryRow, ReceivableRow, BuildingRow } from "@/types/database";


interface AttachmentRow { id: string; storage_path: string; linked_id: string; file_type: string; ocr_text: string | null; ocr_provider: string | null; metadata: Record<string, unknown> | null; paper_archive_status: string; paper_archive_location: string | null; uploaded_at: string; }

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function FrenchFinancePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin","boss","finance"].includes(user.role)) redirect("/");

  const supabase = await createClient();

  const { data: building } = await supabase.from("buildings").select("id").eq("code", "SACSI11").single();
  const buildingId = building?.id ?? null;

  let entries: LedgerEntryRow[] = [];
  let units: { id: string; unit_no: string; building_id: string }[] = [];
  let receivables: ReceivableRow[] = [];
  let customers: { id: string; name: string }[] = [];
  let buildings: BuildingRow[] = [];
  let attachments: AttachmentRow[] = [];

  if (buildingId) {
    const [entriesRes, unitsRes, receivablesRes, customersRes, buildingsRes, attachmentsRes] = await Promise.all([
      supabase.from("ledger_entries").select("*").order("entry_date", { ascending: false }).limit(300),
      supabase.from("units").select("id, unit_no, building_id").order("unit_no"),
      supabase.from("receivables").select("*").order("due_date", { ascending: false }).limit(300),
      supabase.from("customers").select("id, name").order("name"),
      supabase.from("buildings").select("*").eq("is_active", true).order("code"),
      supabase.from("attachments").select("id, storage_path, linked_id, file_type, ocr_text, ocr_provider, metadata, paper_archive_status, paper_archive_location, uploaded_at").eq("linked_type", "payment").limit(500),
    ]);
    if (!entriesRes.error) entries = entriesRes.data;
    if (!unitsRes.error) units = sortUnits(unitsRes.data);
    if (!receivablesRes.error) receivables = receivablesRes.data;
    if (!customersRes.error) customers = customersRes.data;
    if (!buildingsRes.error) buildings = buildingsRes.data;
    if (!attachmentsRes.error) attachments = (attachmentsRes.data ?? []) as unknown as AttachmentRow[];
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Finance"
        description="Ecritures, creances et rapprochement des recus"
      />
      <FinanceTabs
        ledger={<LedgerList entries={entries} units={units} buildingId={buildingId} locale="fr" attachments={attachments} />}
        receivables={<ReceivableList receivables={receivables} units={units} customers={customers} buildings={buildings} locale="fr" />}
        locale="fr"
      />
    </div>
  );
}
