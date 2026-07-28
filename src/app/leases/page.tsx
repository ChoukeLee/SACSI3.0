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
  if (!["admin", "front_desk", "finance", "boss", "rental_sales"].includes(user.role)) redirect("/");

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
    const contractsPromise = (async () => {
      const pageSize = 1000;
      const rows: LeaseContractRow[] = [];
      for (let from = 0; ; from += pageSize) {
        const page = await supabase
          .from("lease_contracts")
          .select("*")
          .order("start_date", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + pageSize - 1);
        if (page.error) return { data: null, error: page.error };
        rows.push(...page.data);
        if (page.data.length < pageSize) return { data: rows, error: null };
      }
    })();

    const paymentsPromise = (async () => {
      const pageSize = 1000;
      const rows: PaymentRow[] = [];
      for (let from = 0; ; from += pageSize) {
        const page = await supabase
          .from("payments")
          .select("*")
          .in("source_type", ["lease_rent", "lease_deposit", "lease_contract", "property_fee", "lease_agency_income", "lease_agency_expense", "lease_furniture_income", "lease_deposit_refund", "lease_deposit_deduction", "lease_rent_refund", "lease_other_income", "lease_other_expense"])
          .order("payment_date", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + pageSize - 1);
        if (page.error) return { data: null, error: page.error };
        rows.push(...page.data);
        if (page.data.length < pageSize) return { data: rows, error: null };
      }
    })();

    const receivablesPromise = (async () => {
      const pageSize = 1000;
      const rows: ReceivableRow[] = [];
      for (let from = 0; ; from += pageSize) {
        const page = await supabase
          .from("receivables")
          .select("*")
          .eq("source_type", "lease_contract")
          .order("due_date", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + pageSize - 1);
        if (page.error) return { data: null, error: page.error };
        rows.push(...page.data);
        if (page.data.length < pageSize) return { data: rows, error: null };
      }
    })();

    const [contractsRes, unitsRes, customersRes, paymentsRes, receivablesRes] = await Promise.all([
      contractsPromise,
      supabase.from("units").select("*, unit_business_flags(business_type, is_enabled, default_price_xof)").in("building_id", buildingIds).order("unit_no"),
      supabase.from("customers").select("*").order("name"),
      paymentsPromise,
      receivablesPromise,
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
