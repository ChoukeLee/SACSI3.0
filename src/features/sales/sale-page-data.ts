import "server-only";

import { createClient } from "@/lib/supabase/server";
import { sortUnits } from "@/lib/utils";
import type {
  BuildingRow,
  CustomerRow,
  PaymentRow,
  ReceivableRow,
  SaleContractRow,
  SalePaymentScheduleRow,
  UnitRow,
} from "@/types/database";

export async function getSalePageData() {
  const supabase = await createClient();
  const [
    projectsRes,
    buildingsRes,
    contractsRes,
    schedulesRes,
    unitsRes,
    customersRes,
    paymentsRes,
    receivablesRes,
  ] = await Promise.all([
    supabase.from("projects").select("id").eq("is_active", true).eq("allows_sale", true),
    supabase.from("buildings").select("id, project_id, code, display_name").eq("is_active", true).order("code"),
    supabase.from("sale_contracts").select("*").order("signed_date", { ascending: false }).limit(1000),
    supabase.from("sale_payment_schedule").select("*").order("installment_no").limit(5000),
    supabase.from("units").select("*").order("unit_no"),
    supabase.from("customers").select("*").order("name"),
    supabase
      .from("payments")
      .select("*")
      .in("source_type", [
        "sale",
        "sale_contract",
        "property_fee",
        "parking_fee",
        "sale_registration_fee",
        "sale_agency_income",
        "sale_agency_expense",
        "sale_other_income",
        "sale_other_expense",
      ])
      .order("payment_date", { ascending: false })
      .limit(5000),
    supabase.from("receivables").select("*").eq("source_type", "sale_contract").order("due_date").limit(5000),
  ]);

  if (projectsRes.error) throw projectsRes.error;
  if (buildingsRes.error) throw buildingsRes.error;

  const sellableProjectIds = new Set((projectsRes.data ?? []).map((project) => project.id));
  const buildings = ((buildingsRes.data ?? []) as BuildingRow[]).filter((building) => building.project_id && sellableProjectIds.has(building.project_id));
  const buildingIds = new Set(buildings.map((building) => building.id));

  return {
    buildings,
    contracts: (contractsRes.error ? [] : contractsRes.data ?? []) as SaleContractRow[],
    schedules: (schedulesRes.error ? [] : schedulesRes.data ?? []) as SalePaymentScheduleRow[],
    units: sortUnits(((unitsRes.error ? [] : unitsRes.data ?? []) as UnitRow[]).filter((unit) => buildingIds.has(unit.building_id))),
    customers: (customersRes.error ? [] : customersRes.data ?? []) as CustomerRow[],
    payments: (paymentsRes.error ? [] : paymentsRes.data ?? []) as PaymentRow[],
    receivables: (receivablesRes.error ? [] : receivablesRes.data ?? []) as ReceivableRow[],
  };
}
