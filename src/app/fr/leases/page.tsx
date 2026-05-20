import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { dictionaries } from "@/lib/i18n";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sortUnits } from "@/lib/utils";
import { LeaseList } from "@/features/leases";
import { DesktopOnly } from "@/features/mobile";
import type { LeaseContractRow, UnitRow, CustomerRow, PaymentRow, ReceivableRow } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function FrenchLeasesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin","front_desk","finance","boss"].includes(user.role)) redirect("/");

  const t = dictionaries.fr.leases;
  const supabase = await createClient();

  const { data: building } = await supabase.from("buildings").select("id").eq("code", "SASCI11").single();
  const buildingId = building?.id;

  let contracts: LeaseContractRow[] = [];
  let units: UnitRow[] = [];
  let customers: CustomerRow[] = [];
  let payments: PaymentRow[] = [];
  let receivables: ReceivableRow[] = [];

  if (buildingId) {
    const [contractsRes, unitsRes, customersRes, paymentsRes, receivablesRes] = await Promise.all([
      supabase.from("lease_contracts").select("*").order("start_date", { ascending: false }).limit(200),
      supabase.from("units").select("*").eq("building_id", buildingId).order("unit_no"),
      supabase.from("customers").select("*").order("name"),
      supabase.from("payments").select("*").in("source_type", ["lease_rent", "lease_deposit"]).order("payment_date", { ascending: false }).limit(500),
      supabase.from("receivables").select("*").in("source_type", ["lease_contract"]).order("due_date", { ascending: false }).limit(1000),
    ]);
    if (!contractsRes.error) contracts = contractsRes.data;
    if (!unitsRes.error) units = sortUnits(unitsRes.data);
    if (!customersRes.error) customers = customersRes.data;
    if (!paymentsRes.error) payments = paymentsRes.data;
    if (!receivablesRes.error) receivables = receivablesRes.data;
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
          <LeaseList contracts={contracts} units={units} customers={customers} payments={payments} receivables={receivables} locale="fr" />
        </section>
      </div>
    </>
  );
}
