import "server-only";

import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
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
    all(() => supabase.from("projects").select("id", {count:"exact"}).eq("is_active", true).eq("allows_sale", true), "projects"),
    all(() => supabase.from("buildings").select("id, project_id, code, display_name", {count:"exact"}).eq("is_active", true).order("code"), "buildings"),
    all(() => supabase.from("sale_contracts").select("*", {count:"exact"}).order("signed_date", { ascending: false }), "sale contracts"),
    all(() => supabase.from("sale_payment_schedule").select("*", {count:"exact"}).order("installment_no"), "sale schedules"),
    all(() => supabase.from("units").select("*", {count:"exact"}).order("unit_no"), "units"),
    all(() => supabase.from("customers").select("*", {count:"exact"}).order("name"), "customers"),
    all(() => supabase.from("payments").select("*", {count:"exact"}).in("source_type", [
      "sale", "sale_contract", "property_fee", "parking_fee", "sale_registration_fee",
      "sale_agency_income", "sale_agency_expense", "sale_other_income", "sale_other_expense",
    ]).order("payment_date", { ascending: false }), "sale payments"),
    all(() => supabase.from("receivables").select("*", {count:"exact"}).eq("source_type", "sale_contract").order("due_date"), "sale receivables"),
  ]);
  for (const result of [projectsRes, buildingsRes, contractsRes, schedulesRes, unitsRes, customersRes, paymentsRes, receivablesRes]) {
    if (result.error) throw result.error;
  }

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
// Every query ends in a unique tie-breaker; any failed page rejects the whole report.
async function all<T>(factory: () => { order(column: string): { range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }> } }, label: string) {
  return { data: await fetchAllPages((from, to) => factory().order("id").range(from, to), label), error: null };
}
