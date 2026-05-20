import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { dictionaries } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { sortUnits } from "@/lib/utils";
import { LedgerList } from "@/features/finance";
import { ReceivableList } from "@/features/finance/receivable-list";
import { DesktopOnly } from "@/features/mobile";
import { FinanceTabs } from "@/features/finance/finance-tabs";
import type { LedgerEntryRow, ReceivableRow, BuildingRow } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance"].includes(user.role)) redirect("/");

  const t = dictionaries.zh.finance;
  const supabase = await createClient();

  const { data: building } = await supabase.from("buildings").select("id").eq("code", "SASCI11").single();
  const buildingId = building?.id ?? null;

  let entries: LedgerEntryRow[] = [];
  let units: { id: string; unit_no: string; building_id: string }[] = [];
  let receivables: ReceivableRow[] = [];
  let customers: { id: string; name: string }[] = [];
  let buildings: BuildingRow[] = [];

  if (buildingId) {
    const [entriesRes, unitsRes, receivablesRes, customersRes, buildingsRes] = await Promise.all([
      supabase.from("ledger_entries").select("*").order("entry_date", { ascending: false }).limit(500),
      supabase.from("units").select("id, unit_no, building_id").order("unit_no"),
      supabase.from("receivables").select("*").order("due_date", { ascending: false }).limit(500),
      supabase.from("customers").select("id, name").order("name"),
      supabase.from("buildings").select("*").eq("is_active", true).order("code"),
    ]);
    if (!entriesRes.error) entries = entriesRes.data;
    if (!unitsRes.error) units = sortUnits(unitsRes.data);
    if (!receivablesRes.error) receivables = receivablesRes.data;
    if (!customersRes.error) customers = customersRes.data;
    if (!buildingsRes.error) buildings = buildingsRes.data;
  }

  return (
    <>
      <div className="lg:hidden">
        <DesktopOnly locale="zh" />
      </div>
      <div className="hidden lg:block">
        <PageHeader title={t.title} description={t.description} />
        <p className="text-xs text-brand-ink-400 mt-2 mb-6">财务规则：XOF/CNY双币种 · 收据编号必留 · 报表统一换算 XOF</p>
        <section>
          <FinanceTabs
            ledger={<LedgerList entries={entries} units={units} buildingId={buildingId} locale="zh" />}
            receivables={<ReceivableList receivables={receivables} units={units} customers={customers} buildings={buildings} locale="zh" />}
            locale="zh"
          />
        </section>
      </div>
    </>
  );
}
