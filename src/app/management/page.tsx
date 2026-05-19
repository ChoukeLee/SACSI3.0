import { createClient } from "@/lib/supabase/server";
import { ManagementDashboard } from "@/features/management";
import type {
  BuildingRow, UnitRow, DailyBookingRow, LeaseContractRow,
  SaleContractRow, SalePaymentScheduleRow, LedgerEntryRow, ReceivableRow,
} from "@/types/database";

export const dynamic = "force-dynamic";

export default async function ManagementPage() {
  const supabase = await createClient();

  const [
    { data: buildings },
    { data: units },
    { data: dailyBookings },
    { data: leaseContracts },
    { data: saleContracts },
    { data: saleSchedules },
    { data: ledgerEntries },
    { data: cleaningTasks },
    { data: receivables },
  ] = await Promise.all([
    supabase.from("buildings").select("*").eq("is_active", true).order("code"),
    supabase.from("units").select("*").order("unit_no"),
    supabase.from("daily_bookings").select("*").in("status", ["pending_review", "confirmed", "checked_in"]).order("check_in", { ascending: false }).limit(500),
    supabase.from("lease_contracts").select("*").in("status", ["active", "draft"]).order("start_date", { ascending: false }).limit(500),
    supabase.from("sale_contracts").select("*").in("status", ["active", "draft"]).order("signed_date", { ascending: false }).limit(500),
    supabase.from("sale_payment_schedule").select("*").order("due_date", { ascending: false }).limit(1000),
    supabase.from("ledger_entries").select("*").order("entry_date", { ascending: false }).limit(2000),
    supabase.from("cleaning_tasks").select("id, unit_id, is_completed"),
    supabase.from("receivables").select("*").order("due_date", { ascending: false }).limit(1000),
  ]);

  return (
    <ManagementDashboard
      buildings={(buildings ?? []) as BuildingRow[]}
      units={(units ?? []) as UnitRow[]}
      dailyBookings={(dailyBookings ?? []) as DailyBookingRow[]}
      leaseContracts={(leaseContracts ?? []) as LeaseContractRow[]}
      saleContracts={(saleContracts ?? []) as SaleContractRow[]}
      saleSchedules={(saleSchedules ?? []) as SalePaymentScheduleRow[]}
      cleaningTasks={(cleaningTasks ?? []) as { unit_id: string; is_completed: boolean }[]}
      ledgerEntries={(ledgerEntries ?? []) as LedgerEntryRow[]}
      receivables={(receivables ?? []) as ReceivableRow[]}
      locale="zh"
    />
  );
}
