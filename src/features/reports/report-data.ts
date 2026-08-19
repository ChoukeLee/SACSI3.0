import "server-only";

import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import type { LedgerEntryRow, BuildingRow, UnitRow, DailyBookingRow, PaymentRow } from "@/types/database";

export async function loadReportData() {
  const supabase = await createClient();

  const [entries, buildingsRes, unitsRes, dailyBookings, dailyPayments, dailyFlagsRes] = await Promise.all([
    fetchAllPages(
      (from, to) => supabase
        .from("ledger_entries")
        .select("id, building_id, unit_id, payment_id, entry_date, direction, category, amount_xof, amount_cny, description")
        .order("entry_date", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
      "report ledger entries",
    ),
    supabase.from("buildings").select("id, code, display_name").eq("is_active", true).order("code"),
    supabase.from("units").select("id, building_id, unit_no").order("unit_no"),
    fetchAllPages(
      (from, to) => supabase
        .from("daily_bookings")
        .select("id, unit_id, check_in, check_out, checkout_mode, actual_check_out, status")
        .order("check_in", { ascending: false })
        .range(from, to),
      "report daily bookings",
    ),
    fetchAllPages(
      (from, to) => supabase
        .from("payments")
        .select("id, source_type, source_id, amount, payment_date")
        .eq("source_type", "daily_booking")
        .order("payment_date", { ascending: false })
        .range(from, to),
      "report daily payments",
    ),
    supabase
      .from("unit_business_flags")
      .select("unit_id")
      .eq("business_type", "daily_rental")
      .eq("is_enabled", true),
  ]);

  return {
    entries: entries as LedgerEntryRow[],
    buildings: (buildingsRes.data ?? []) as BuildingRow[],
    units: (unitsRes.data ?? []) as UnitRow[],
    dailyBookings: dailyBookings as DailyBookingRow[],
    dailyPayments: dailyPayments as PaymentRow[],
    dailyUnitIds: ((dailyFlagsRes.data ?? []) as { unit_id: string }[]).map((f) => f.unit_id),
  };
}