import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { parseManagementFinanceSnapshot } from "@/features/management/finance-snapshot";
import { fetchAllPages } from "@/lib/supabase/fetch-all";

export const getBuildings = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.from("buildings").select("id, display_name, is_active, code").eq("is_active", true).order("code");
  return data ?? [];
});

export const getUnits = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.from("units").select("id, unit_no, floor_label, kind, status, building_id, layout, notes").order("unit_no");
  return data ?? [];
});

export const getManagementFinanceSnapshot = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("management_finance_snapshot");
  if (error) {
    throw new Error(`Failed to load management finance snapshot: ${error.message}`);
  }
  return parseManagementFinanceSnapshot(data);
});

export const getDailyBookings = cache(async () => {
  const supabase = await createClient();
  return fetchAllPages(
    (from, to) => supabase.from("daily_bookings")
      .select("id, unit_id, customer_id, check_in, check_out, checkout_mode, actual_check_out, status")
      .in("status", ["pending_review", "confirmed", "checked_in"])
      .order("check_in", { ascending: false }).order("id").range(from, to),
    "management daily bookings",
  );
});

export const getLeaseContracts = cache(async () => {
  const supabase = await createClient();
  return fetchAllPages(
    (from, to) => supabase.from("lease_contracts")
      .select("id, contract_no, unit_id, customer_id, status, expected_end_date, start_date")
      .in("status", ["active", "draft"])
      .order("start_date", { ascending: false }).order("id").range(from, to),
    "management lease contracts",
  );
});

export const getSaleContracts = cache(async () => {
  const supabase = await createClient();
  return fetchAllPages(
    (from, to) => supabase.from("sale_contracts")
      .select("id, unit_id, customer_id, status, signed_date")
      .in("status", ["active", "draft"])
      .order("signed_date", { ascending: false }).order("id").range(from, to),
    "management sale contracts",
  );
});

export const getCleaningTasks = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.from("cleaning_tasks").select("id, unit_id, is_completed");
  return data ?? [];
});

export const getCustomers = cache(async () => {
  const supabase = await createClient();
  return fetchAllPages(
    (from, to) => supabase.from("customers")
      .select("id, name")
      .order("name")
      .order("id")
      .range(from, to),
    "management customers",
  );
});

