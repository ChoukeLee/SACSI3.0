import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

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

export const getDailyBookings = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("daily_bookings")
    .select("id, unit_id, customer_id, check_in, check_out, checkout_mode, actual_check_out, status")
    .in("status", ["pending_review", "confirmed", "checked_in"])
    .order("check_in", { ascending: false })
    .limit(200);
  return data ?? [];
});

export const getLeaseContracts = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("lease_contracts")
    .select("id, contract_no, unit_id, customer_id, status, expected_end_date, start_date")
    .in("status", ["active", "draft"])
    .order("start_date", { ascending: false })
    .limit(200);
  return data ?? [];
});

export const getSaleContracts = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sale_contracts")
    .select("id, unit_id, customer_id, status, signed_date")
    .in("status", ["active", "draft"])
    .order("signed_date", { ascending: false })
    .limit(200);
  return data ?? [];
});

export const getSaleSchedules = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sale_payment_schedule")
    .select("id, sale_contract_id, status, due_date")
    .order("due_date", { ascending: false })
    .limit(200);
  return data ?? [];
});

export const getCleaningTasks = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.from("cleaning_tasks").select("id, unit_id, is_completed");
  return data ?? [];
});

export const getLedgerEntries = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ledger_entries")
    .select("id, building_id, unit_id, entry_date, direction, category, amount_xof, description")
    .order("entry_date", { ascending: false })
    .limit(200);
  return data ?? [];
});

export const getReceivables = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("receivables")
    .select("id, unit_id, customer_id, building_id, amount_xof, paid_amount_xof, due_date, status, source_type, category")
    .order("due_date", { ascending: false })
    .limit(200);
  return data ?? [];
});

export const getPayments = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payments")
    .select("id, source_id, source_type, amount, payment_date, customer_id, unit_id, receipt_no")
    .order("payment_date", { ascending: false })
    .limit(200);
  return data ?? [];
});

export const getCustomers = cache(async () => {
  const supabase = await createClient();
  const pageSize = 1_000;
  const customers: { id: string; name: string }[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("customers")
      .select("id, name")
      .order("name")
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) {
      console.error("Failed to fetch management customers:", error);
      break;
    }
    customers.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }

  return customers;
});

