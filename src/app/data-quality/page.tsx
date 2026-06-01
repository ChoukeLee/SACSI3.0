import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sortUnits } from "@/lib/utils";
import { DesktopOnly } from "@/features/mobile";
import { QualityCenter, runQualityChecks } from "@/features/data-quality";
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
  if (!["admin", "boss"].includes(user.role)) redirect("/");

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
  ] = await Promise.all([
    supabase.from("units").select("*").order("unit_no").limit(500),
    supabase.from("customers").select("*").order("name").limit(500),
    supabase.from("daily_bookings").select("*").order("check_in", { ascending: false }).limit(500),
    supabase.from("lease_contracts").select("*").order("start_date", { ascending: false }).limit(300),
    supabase.from("sale_contracts").select("*").order("signed_date", { ascending: false }).limit(200),
    supabase.from("sale_payment_schedule").select("*").order("installment_no").limit(1000),
    supabase.from("receivables").select("*").neq("status", "cancelled").order("due_date", { ascending: false }).limit(1000),
    supabase.from("payments").select("*").order("payment_date", { ascending: false }).limit(1000),
    supabase.from("cleaning_tasks").select("*").limit(500),
    supabase.from("ledger_entries").select("*").order("entry_date", { ascending: false }).limit(1000),
    supabase.from("audit_logs").select("*").in("entity_type", ["daily_booking", "unit"]).order("created_at", { ascending: false }).limit(500),
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

  const allIssues = [...existingIssues, ...drIssues];

  return (
    <>
      <div className="lg:hidden"><DesktopOnly locale="zh" /></div>
      <div className="hidden lg:block">
        <QualityCenter issues={allIssues} locale="zh" userRole={user.role} />
      </div>
    </>
  );
}
