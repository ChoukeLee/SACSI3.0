import "server-only";

import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import type {
  LedgerEntryRow,
  BuildingRow,
  UnitRow,
  DailyBookingRow,
  ReceivableRow,
  CustomerRow,
} from "@/types/database";
import { loadDailyReceiptMonths } from "./daily-receipt-report-service";

export async function loadReportData() {
  const supabase = await createClient();

  const [
    entries,
    buildingsRes,
    unitsRes,
    dailyBookings,
    dailyCollections,
    dailyFlagsRes,
    receivables,
    customersRes,
  ] = await Promise.all([
    fetchAllPages(
      (from, to) =>
        supabase
          .from("ledger_entries")
          .select(
            "id, building_id, unit_id, payment_id, entry_date, direction, category, amount_xof, amount_cny, description",
          )
          .order("entry_date", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      "report ledger entries",
    ),
    fetchAllPages(
      (from, to) =>
        supabase
          .from("buildings")
          .select("id, code, display_name")
          .eq("is_active", true)
          .order("code")
          .order("id")
          .range(from, to),
      "report buildings",
    ).then((data) => ({ data, error: null })),
    fetchAllPages(
      (from, to) =>
        supabase
          .from("units")
          .select("id, building_id, unit_no")
          .order("unit_no")
          .order("id")
          .range(from, to),
      "report units",
    ).then((data) => ({ data, error: null })),
    fetchAllPages(
      (from, to) =>
        supabase
          .from("daily_bookings")
          .select("id, unit_id, check_in, check_out, checkout_mode, actual_check_out, status")
          .order("check_in", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      "report daily bookings",
    ),
    loadDailyReceiptMonths(supabase),
    fetchAllPages(
      (from, to) =>
        supabase
          .from("unit_business_flags")
          .select("unit_id")
          .eq("business_type", "daily_rental")
          .eq("is_enabled", true)
          .order("unit_id")
          .range(from, to),
      "report daily units",
    ).then((data) => ({ data, error: null })),
    fetchAllPages(
      (from, to) =>
        supabase
          .from("receivables")
          .select(
            "id, building_id, unit_id, customer_id, source_type, source_id, category, title, due_date, amount_xof, paid_amount_xof, status, management_status",
          )
          .neq("status", "cancelled")
          .order("due_date", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      "report receivables",
    ),
    fetchAllPages(
      (from, to) =>
        supabase.from("customers").select("id, name").order("name").order("id").range(from, to),
      "report customers",
    ).then((data) => ({ data, error: null })),
  ]);

  for (const result of [buildingsRes, unitsRes, dailyFlagsRes, customersRes]) {
    if (result.error || !result.data) throw new Error("Report reference data unavailable");
  }

  return {
    entries: entries as LedgerEntryRow[],
    buildings: (buildingsRes.data ?? []) as BuildingRow[],
    units: (unitsRes.data ?? []) as UnitRow[],
    dailyBookings: dailyBookings as DailyBookingRow[],
    dailyCollections,
    dailyUnitIds: ((dailyFlagsRes.data ?? []) as { unit_id: string }[]).map((f) => f.unit_id),
    receivables: receivables as ReceivableRow[],
    customers: (customersRes.data ?? []) as CustomerRow[],
  };
}
