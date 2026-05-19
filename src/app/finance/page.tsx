import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { dictionaries } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { LedgerList } from "@/features/finance";
import { ReceivableList } from "@/features/finance/receivable-list";
import { DesktopOnly } from "@/features/mobile";
import { FinanceTabs } from "@/features/finance/finance-tabs";
import type { LedgerEntryRow, ReceivableRow } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const t = dictionaries.zh.finance;
  const supabase = await createClient();

  const { data: building } = await supabase.from("buildings").select("id").eq("code", "SASCI11").single();
  const buildingId = building?.id ?? null;

  let entries: LedgerEntryRow[] = [];
  let units: { id: string; unit_no: string; building_id: string }[] = [];
  let receivables: ReceivableRow[] = [];
  let customers: { id: string; name: string }[] = [];

  if (buildingId) {
    const [entriesRes, unitsRes, receivablesRes, customersRes] = await Promise.all([
      supabase.from("ledger_entries").select("*").order("entry_date", { ascending: false }).limit(500),
      supabase.from("units").select("id, unit_no, building_id").order("unit_no"),
      supabase.from("receivables").select("*").order("due_date", { ascending: false }).limit(500),
      supabase.from("customers").select("id, name").order("name"),
    ]);
    if (!entriesRes.error) entries = entriesRes.data;
    if (!unitsRes.error) units = unitsRes.data;
    if (!receivablesRes.error) receivables = receivablesRes.data;
    if (!customersRes.error) customers = customersRes.data;
  }

  return (
    <>
      <div className="lg:hidden">
        <DesktopOnly locale="zh" />
      </div>
      <div className="hidden lg:block">
        <PageHeader title={t.title} description={t.description} />
        <div className="grid gap-4 md:grid-cols-3">
          {t.metrics.map(([title, value, caption], i) => (
            <MetricCard key={title} title={title} value={value} caption={caption} accent={i === 1 ? "green" : i === 2 ? "ink" : "orange"} />
          ))}
        </div>
        <section className="mt-8">
          <FinanceTabs
            ledger={<LedgerList entries={entries} units={units} buildingId={buildingId} locale="zh" />}
            receivables={<ReceivableList receivables={receivables} units={units} customers={customers} locale="zh" />}
            locale="zh"
          />
        </section>
      </div>
    </>
  );
}
