import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { dictionaries } from "@/lib/i18n";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LedgerList } from "@/features/finance";
import { ReceivableList } from "@/features/finance/receivable-list";
import { DesktopOnly } from "@/features/mobile";
import { FinanceTabs } from "@/features/finance/finance-tabs";
import type { LedgerEntryRow, ReceivableRow, BuildingRow } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function FrenchFinancePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin","boss","finance"].includes(user.role)) redirect("/");

  const t = dictionaries.fr.finance;
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
    if (!unitsRes.error) units = unitsRes.data;
    if (!receivablesRes.error) receivables = receivablesRes.data;
    if (!customersRes.error) customers = customersRes.data;
    if (!buildingsRes.error) buildings = buildingsRes.data;
  }

  return (
    <>
      <div className="lg:hidden">
        <DesktopOnly locale="fr" />
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
            ledger={<LedgerList entries={entries} units={units} buildingId={buildingId} locale="fr" />}
            receivables={<ReceivableList receivables={receivables} units={units} customers={customers} buildings={buildings} locale="fr" />}
            locale="fr"
          />
        </section>
      </div>
    </>
  );
}
