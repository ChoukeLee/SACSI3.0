
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { dictionaries } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { LeaseList } from "@/features/leases";
import type { LeaseContractRow, UnitRow, CustomerRow, PaymentRow } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function LeasesPage() {
  const t = dictionaries.zh.leases;
  const supabase = await createClient();

  const { data: building } = await supabase.from("buildings").select("id").eq("code", "SASCI11").single();
  const buildingId = building?.id;

  let contracts: LeaseContractRow[] = [];
  let units: UnitRow[] = [];
  let customers: CustomerRow[] = [];
  let payments: PaymentRow[] = [];

  if (buildingId) {
    const [contractsRes, unitsRes, customersRes, paymentsRes] = await Promise.all([
      supabase.from("lease_contracts").select("*").order("start_date", { ascending: false }).limit(200),
      supabase.from("units").select("*").eq("building_id", buildingId).order("unit_no"),
      supabase.from("customers").select("*").order("name"),
      supabase.from("payments").select("*").in("source_type", ["lease_rent", "lease_deposit"]).order("payment_date", { ascending: false }).limit(500),
    ]);
    if (!contractsRes.error) contracts = contractsRes.data;
    if (!unitsRes.error) units = unitsRes.data;
    if (!customersRes.error) customers = customersRes.data;
    if (!paymentsRes.error) payments = paymentsRes.data;
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
        <LeaseList contracts={contracts} units={units} customers={customers} payments={payments} locale="zh" />
      </section>

      </>
</>);
}
