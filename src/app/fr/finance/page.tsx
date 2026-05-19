
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { dictionaries } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { LedgerList } from "@/features/finance";
import type { LedgerEntryRow } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function FrenchFinancePage() {
  const t = dictionaries.fr.finance;
  const supabase = await createClient();

  const { data: building } = await supabase.from("buildings").select("id").eq("code", "SASCI11").single();
  const buildingId = building?.id ?? null;

  let entries: LedgerEntryRow[] = [];
  let units: { id: string; unit_no: string }[] = [];

  if (buildingId) {
    const [entriesRes, unitsRes] = await Promise.all([
      supabase.from("ledger_entries").select("*").order("entry_date", { ascending: false }).limit(500),
      supabase.from("units").select("id, unit_no").eq("building_id", buildingId).order("unit_no"),
    ]);
    if (!entriesRes.error) entries = entriesRes.data;
    if (!unitsRes.error) units = unitsRes.data;
  }

  return (
      <>

<><PageHeader title={t.title} description={t.description} />
      <div className="grid gap-4 md:grid-cols-3">
        {t.metrics.map(([title, value, caption], i) => (
          <MetricCard key={title} title={title} value={value} caption={caption} accent={i === 1 ? "green" : i === 2 ? "ink" : "orange"} />
        ))}
      </div>
      <section className="mt-8">
        <LedgerList entries={entries} units={units} buildingId={buildingId} locale="fr" />
      </section>

      </>
</>);
}
