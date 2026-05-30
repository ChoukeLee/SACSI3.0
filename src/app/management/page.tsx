import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { dictionaries } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { sortUnits } from "@/lib/utils";
import { ManagementDashboard } from "@/features/management";
import { runQualityChecks } from "@/features/data-quality";
import type { QualityIssue } from "@/features/data-quality/quality-types";
import type {
  BuildingRow, UnitRow, DailyBookingRow, LeaseContractRow,
  SaleContractRow, SalePaymentScheduleRow, LedgerEntryRow, ReceivableRow,
  PaymentRow, CustomerRow,
} from "@/types/database";

export const dynamic = "force-dynamic";

export default async function ManagementPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

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
    { data: payments },
    { data: customers },
  ] = await Promise.all([
    supabase.from("buildings").select("*").eq("is_active", true).order("code"),
    supabase.from("units").select("*").order("unit_no"),
    supabase.from("daily_bookings").select("*").in("status", ["pending_review", "confirmed", "checked_in"]).order("check_in", { ascending: false }).limit(200),
    supabase.from("lease_contracts").select("*").in("status", ["active", "draft"]).order("start_date", { ascending: false }).limit(200),
    supabase.from("sale_contracts").select("*").in("status", ["active", "draft"]).order("signed_date", { ascending: false }).limit(200),
    supabase.from("sale_payment_schedule").select("*").order("due_date", { ascending: false }).limit(500),
    supabase.from("ledger_entries").select("*").order("entry_date", { ascending: false }).limit(500),
    supabase.from("cleaning_tasks").select("id, unit_id, is_completed"),
    supabase.from("receivables").select("*").order("due_date", { ascending: false }).limit(300),
    supabase.from("payments").select("*").order("payment_date", { ascending: false }).limit(300),
    supabase.from("customers").select("*").order("name").limit(300),
  ]);

  // Quality checks
  const qualityIssues = runQualityChecks({
    units: (units ?? []) as UnitRow[],
    customers: (customers ?? []) as CustomerRow[],
    dailyBookings: (dailyBookings ?? []) as DailyBookingRow[],
    leaseContracts: (leaseContracts ?? []) as LeaseContractRow[],
    saleContracts: (saleContracts ?? []) as SaleContractRow[],
    saleSchedules: (saleSchedules ?? []) as SalePaymentScheduleRow[],
    receivables: (receivables ?? []) as ReceivableRow[],
    payments: (payments ?? []) as PaymentRow[],
  }, user.role as "admin" | "boss" | "finance" | "front_desk");

  return (
    <ManagementDashboard
      buildings={(buildings ?? []) as BuildingRow[]}
      units={sortUnits((units ?? []) as UnitRow[])}
      dailyBookings={(dailyBookings ?? []) as DailyBookingRow[]}
      leaseContracts={(leaseContracts ?? []) as LeaseContractRow[]}
      saleContracts={(saleContracts ?? []) as SaleContractRow[]}
      saleSchedules={(saleSchedules ?? []) as SalePaymentScheduleRow[]}
      cleaningTasks={(cleaningTasks ?? []) as { unit_id: string; is_completed: boolean }[]}
      ledgerEntries={(ledgerEntries ?? []) as LedgerEntryRow[]}
      receivables={(receivables ?? []) as ReceivableRow[]}
      payments={(payments ?? []) as PaymentRow[]}
      customers={(customers ?? []) as CustomerRow[]}
      qualityIssues={qualityIssues}
      t={dictionaries.zh.management}
      locale="zh"
    />
  );
}
