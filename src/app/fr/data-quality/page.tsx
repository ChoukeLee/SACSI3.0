import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sortUnits } from "@/lib/utils";
import { DesktopOnly } from "@/features/mobile";
import { QualityCenter, runQualityChecks } from "@/features/data-quality";
import type { TodoRole } from "@/features/data-quality/quality-types";
import type {
  UnitRow, CustomerRow, DailyBookingRow, LeaseContractRow,
  SaleContractRow, SalePaymentScheduleRow, ReceivableRow, PaymentRow,
} from "@/types/database";

export const revalidate = 60;

export default async function FrenchDataQualityPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance", "front_desk"].includes(user.role)) redirect("/");

  const supabase = await createClient();

  const [
    { data: units }, { data: customers }, { data: dailyBookings },
    { data: leaseContracts }, { data: saleContracts }, { data: saleSchedules },
    { data: receivables }, { data: payments },
  ] = await Promise.all([
    supabase.from("units").select("*").order("unit_no").limit(500),
    supabase.from("customers").select("*").order("name").limit(500),
    supabase.from("daily_bookings").select("*").order("check_in", { ascending: false }).limit(500),
    supabase.from("lease_contracts").select("*").order("start_date", { ascending: false }).limit(300),
    supabase.from("sale_contracts").select("*").order("signed_date", { ascending: false }).limit(200),
    supabase.from("sale_payment_schedule").select("*").order("installment_no").limit(1000),
    supabase.from("receivables").select("*").neq("status", "cancelled").order("due_date", { ascending: false }).limit(1000),
    supabase.from("payments").select("*").order("payment_date", { ascending: false }).limit(1000),
  ]);

  const issues = runQualityChecks({
    units: sortUnits((units ?? []) as UnitRow[]),
    customers: (customers ?? []) as CustomerRow[],
    dailyBookings: (dailyBookings ?? []) as DailyBookingRow[],
    leaseContracts: (leaseContracts ?? []) as LeaseContractRow[],
    saleContracts: (saleContracts ?? []) as SaleContractRow[],
    saleSchedules: (saleSchedules ?? []) as SalePaymentScheduleRow[],
    receivables: (receivables ?? []) as ReceivableRow[],
    payments: (payments ?? []) as PaymentRow[],
  }, user.role as TodoRole);

  return (
    <>
      <div className="lg:hidden"><DesktopOnly locale="fr" /></div>
      <div className="hidden lg:block">
        <QualityCenter issues={issues} locale="fr" />
      </div>
    </>
  );
}
