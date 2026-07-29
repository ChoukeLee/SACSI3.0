import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sortUnits } from "@/lib/utils";
import { SaleLazyView } from "@/features/sales/sale-lazy-view";
import { DesktopOnly } from "@/features/mobile";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";
import type { SaleContractRow, SalePaymentScheduleRow, UnitRow, CustomerRow, PaymentRow, ReceivableRow } from "@/types/database";

export default async function FrenchSalesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "finance", "boss", "rental_sales"].includes(user.role)) redirect("/");

  return (
    <>
      <div className="lg:hidden"><DesktopOnly locale="fr" /></div>
      <div className="hidden lg:block">
        <Suspense fallback={<OperationalPageSkeleton kind="records" rows={8} />}>
          <FrenchSalesData />
        </Suspense>
      </div>
    </>
  );
}

async function FrenchSalesData() {
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
  let contracts: SaleContractRow[] = [];
  let schedules: SalePaymentScheduleRow[] = [];
  let units: UnitRow[] = [];
  let customers: CustomerRow[] = [];
  let payments: PaymentRow[] = [];
  let receivables: ReceivableRow[] = [];

  if (buildingIds.length > 0) {
    const [contractsRes, schedulesRes, unitsRes, customersRes, paymentsRes, receivablesRes] = await Promise.all([
      supabase.from("sale_contracts").select("*").eq("status", "active").order("signed_date", { ascending: false }).limit(200),
      supabase.from("sale_payment_schedule").select("*").order("installment_no").limit(300),
      supabase.from("units").select("*").in("building_id", buildingIds).order("unit_no"),
      supabase.from("customers").select("*").order("name"),
      supabase
        .from("payments")
        .select("*")
        .in("source_type", ["sale", "sale_contract", "property_fee", "parking_fee", "sale_registration_fee", "sale_agency_income", "sale_agency_expense", "sale_other_income", "sale_other_expense"])
        .order("payment_date", { ascending: false })
        .limit(1000),
      supabase.from("receivables").select("*").eq("source_type", "sale_contract").order("due_date").limit(300),
    ]);
    if (!contractsRes.error) contracts = contractsRes.data;
    if (!schedulesRes.error) schedules = schedulesRes.data;
    if (!unitsRes.error) units = sortUnits(unitsRes.data);
    if (!customersRes.error) customers = customersRes.data;
    if (!paymentsRes.error) payments = paymentsRes.data;
    if (!receivablesRes.error) receivables = receivablesRes.data;
  }

  return <SaleLazyView contracts={contracts} schedules={schedules} units={units} customers={customers} payments={payments} receivables={receivables} buildings={allBuildings ?? []} locale="fr" />;
}
