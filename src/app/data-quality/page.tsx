import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";
import { sortUnits } from "@/lib/utils";
import { DesktopOnly } from "@/features/mobile";
import {
  BusinessRepairCenter,
  QualityCenter,
  runQualityChecks,
} from "@/features/data-quality";
import {
  fetchDatabaseQualityIssues,
  mergeDatabaseQualityIssues,
} from "@/features/data-quality/database-quality-service";
import { scanDailyRentalIssues } from "@/features/daily-rentals/daily-rental-audit";
import type { TodoRole } from "@/features/data-quality/quality-types";
import type {
  UnitRow, CustomerRow, DailyBookingRow, LeaseContractRow,
  SaleContractRow, SalePaymentScheduleRow, ReceivableRow, PaymentRow,
} from "@/types/database";

export const revalidate = 60;

export default async function DataQualityPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  const supabase = await createClient();

  const [
    { data: units },
    { data: customers },
    { data: dailyBookings },
    { data: leaseContracts },
    { data: saleContracts },
    { data: saleSchedules },
    { data: receivables },
    { data: payments },
    { data: cleaningTasks },
    { data: ledgerEntries },
    { data: auditLogs },
    databaseIssues,
  ] = await Promise.all([
    complete(() => supabase.from("units").select("*", { count: "exact" }).order("unit_no").order("id"), "units"),
    complete(() => supabase.from("customers").select("*", { count: "exact" }).order("name").order("id"), "customers"),
    complete(() => supabase.from("daily_bookings").select("*", { count: "exact" }).order("check_in", { ascending: false }).order("id"), "daily_bookings"),
    complete(() => supabase.from("lease_contracts").select("*", { count: "exact" }).order("start_date", { ascending: false }).order("id"), "lease_contracts"),
    complete(() => supabase.from("sale_contracts").select("*", { count: "exact" }).order("signed_date", { ascending: false }).order("id"), "sale_contracts"),
    complete(() => supabase.from("sale_payment_schedule").select("*", { count: "exact" }).order("installment_no").order("id"), "sale_payment_schedule"),
    complete(() => supabase.from("receivables").select("*", { count: "exact" }).neq("status", "cancelled").order("due_date", { ascending: false }).order("id"), "receivables"),
    complete(() => supabase.from("payments").select("*", { count: "exact" }).order("payment_date", { ascending: false }).order("id"), "payments"),
    complete(() => supabase.from("cleaning_tasks").select("*", { count: "exact" }).order("id"), "cleaning_tasks"),
    complete(() => supabase.from("ledger_entries").select("*", { count: "exact" }).order("entry_date", { ascending: false }).order("id"), "ledger_entries"),
    complete(() => supabase.from("audit_logs").select("*", { count: "exact" }).in("entity_type", ["daily_booking", "unit"]).order("created_at", { ascending: false }).order("id"), "audit_logs"),
    fetchDatabaseQualityIssues("zh"),
  ]);

  const existingIssues = runQualityChecks({
    units: sortUnits((units ?? []) as UnitRow[]),
    customers: (customers ?? []) as CustomerRow[],
    dailyBookings: (dailyBookings ?? []) as DailyBookingRow[],
    leaseContracts: (leaseContracts ?? []) as LeaseContractRow[],
    saleContracts: (saleContracts ?? []) as SaleContractRow[],
    saleSchedules: (saleSchedules ?? []) as SalePaymentScheduleRow[],
    receivables: (receivables ?? []) as ReceivableRow[],
    payments: (payments ?? []) as PaymentRow[],
  }, user.role as TodoRole);

  const drIssues = scanDailyRentalIssues({
    dailyBookings: (dailyBookings ?? []),
    units: (units ?? []),
    payments: (payments ?? []),
    receivables: (receivables ?? []),
    cleaningTasks: (cleaningTasks ?? []),
    ledgerEntries: (ledgerEntries ?? []),
    auditLogs: (auditLogs ?? []),
  });

  const allIssues = mergeDatabaseQualityIssues(
    [...existingIssues, ...drIssues],
    databaseIssues,
  );

  return (
    <>
      <div className="lg:hidden"><DesktopOnly locale="zh" /></div>
      <div className="hidden space-y-5 lg:block">
        <BusinessRepairCenter locale="zh" userRole={user.role} />
        <QualityCenter issues={allIssues} locale="zh" userRole={user.role} />
      </div>
    </>
  );
}
async function complete<T>(factory: () => { range(from:number,to:number): PromiseLike<{data:T[]|null;error:{message:string}|null;count?:number|null}> }, label:string) {
  return {data:await fetchAllPages((from,to)=>factory().range(from,to),label)};
}
