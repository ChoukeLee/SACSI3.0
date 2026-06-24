import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { dictionaries } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { sortUnits } from "@/lib/utils";
import { LeaseList } from "@/features/leases";
import { DesktopOnly } from "@/features/mobile";
import type { LeaseContractRow, UnitRow, CustomerRow, PaymentRow, ReceivableRow } from "@/types/database";


export default async function LeasesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "front_desk", "finance", "boss"].includes(user.role)) redirect("/");

  const t = dictionaries.zh.leases;
  const supabase = await createClient();

  // Fetch all active buildings
  const { data: allBuildings, error: bldErr } = await supabase
    .from("buildings")
    .select("id, code, display_name")
    .eq("is_active", true)
    .order("code");

  if (bldErr) {
    console.error("Failed to fetch buildings:", bldErr);
    return <div>Failed to load buildings</div>;
  }

  const buildingIds = allBuildings?.map((b) => b.id) ?? [];

  let contracts: LeaseContractRow[] = [];
  let units: UnitRow[] = [];
  let customers: CustomerRow[] = [];
  let payments: PaymentRow[] = [];
  let receivables: ReceivableRow[] = [];

  if (buildingIds.length > 0) {
    const [contractsRes, unitsRes, customersRes, paymentsRes, receivablesRes] = await Promise.all([
      supabase.from("lease_contracts").select("*").order("start_date", { ascending: false }).limit(200),
      supabase.from("units").select("*, unit_business_flags(business_type, is_enabled, default_price_xof)").in("building_id", buildingIds).order("unit_no"),
      supabase.from("customers").select("*").order("name"),
      supabase.from("payments").select("*").in("source_type", ["lease_rent", "lease_deposit"]).order("payment_date", { ascending: false }).limit(200),
      supabase.from("receivables").select("*").in("source_type", ["lease_contract"]).order("due_date", { ascending: false }).limit(2000),
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
        <DesktopOnly locale="zh" />
      </div>
      <div className="hidden lg:block">
        <section>
          <LeaseList contracts={contracts} units={units} customers={customers} payments={payments} receivables={receivables} buildings={allBuildings ?? []} locale="zh" />
        </section>
      </div>
    </>
  );
}

