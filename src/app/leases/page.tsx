import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sortUnits } from "@/lib/utils";
import { LeaseLazyView } from "@/features/leases/lease-lazy-view";
import { DesktopOnly } from "@/features/mobile";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";
import type { LeaseContractRow, UnitRow, CustomerRow, PaymentRow, ReceivableRow } from "@/types/database";

export default async function LeasesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "front_desk", "finance", "boss"].includes(user.role)) redirect("/");

  return (
    <>
      <div className="lg:hidden"><DesktopOnly locale="zh" /></div>
      <div className="hidden lg:block">
        <Suspense fallback={<OperationalPageSkeleton kind="records" rows={8} />}>
          <LeasesData locale="zh" />
        </Suspense>
      </div>
    </>
  );
}

async function LeasesData({ locale }: { locale: "zh" | "fr" }) {
  const supabase = await createClient();
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
      supabase.from("payments").select("*").in("source_type", ["lease_rent", "lease_deposit", "lease_contract", "property_fee", "lease_agency_income", "lease_agency_expense", "lease_furniture_income", "lease_deposit_refund", "lease_other_income", "lease_other_expense"]).order("payment_date", { ascending: false }).limit(1000),
      supabase.from("receivables").select("*").in("source_type", ["lease_contract"]).order("due_date", { ascending: false }).limit(2000),
    ]);
    if (!contractsRes.error) contracts = contractsRes.data;
    if (!unitsRes.error) units = sortUnits(unitsRes.data.map((unit) => unit.code === "SACSI7-STOREFRONT" ? {
      ...unit,
      unit_business_flags: [...(unit.unit_business_flags ?? []), { business_type: "long_lease", is_enabled: true, default_price_xof: 1200000 }],
    } : unit));
    if (!customersRes.error) customers = customersRes.data;
    if (!paymentsRes.error) payments = paymentsRes.data;
    if (!receivablesRes.error) receivables = receivablesRes.data;
  }

  return <LeaseLazyView contracts={contracts} units={units} customers={customers} payments={payments} receivables={receivables} buildings={allBuildings ?? []} locale={locale} />;
}
