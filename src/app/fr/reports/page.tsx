import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { createClient } from "@/lib/supabase/server";
import { sortUnits } from "@/lib/utils";
import { ReportsView } from "@/features/reports";
import { DesktopOnly } from "@/features/mobile";
import type {
  LedgerEntryRow, DailyBookingRow, UnitRow, LeaseContractRow,
  SaleContractRow, SalePaymentScheduleRow, ReceivableRow, PaymentRow, CustomerRow,
} from "@/types/database";

export const dynamic = "force-dynamic";

export default async function FrenchReportsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin","boss","finance","front_desk"].includes(user.role)) redirect("/");

  const supabase = await createClient();
  const { data: building } = await supabase.from("buildings").select("id").eq("code","SASCI11").single();
  const buildingId = building?.id;

  let entries: LedgerEntryRow[]=[]; let bookings: DailyBookingRow[]=[];
  let units: UnitRow[]=[]; let leaseContracts: LeaseContractRow[]=[];
  let saleContracts: SaleContractRow[]=[]; let saleSchedules: SalePaymentScheduleRow[]=[];
  let receivables: ReceivableRow[]=[]; let payments: PaymentRow[]=[];
  let customers: CustomerRow[]=[];

  if (buildingId) {
    const r = await Promise.all([
      supabase.from("ledger_entries").select("*").order("entry_date",{ascending:false}).limit(2000),
      supabase.from("daily_bookings").select("*").neq("status","cancelled").order("check_in").limit(1000),
      supabase.from("units").select("*").eq("building_id",buildingId).order("unit_no"),
      supabase.from("lease_contracts").select("*").order("start_date",{ascending:false}).limit(200),
      supabase.from("sale_contracts").select("*").order("signed_date",{ascending:false}).limit(200),
      supabase.from("sale_payment_schedule").select("*").order("installment_no").limit(500),
      supabase.from("receivables").select("*").order("due_date",{ascending:false}).limit(2000),
      supabase.from("payments").select("*").order("payment_date",{ascending:false}).limit(2000),
      supabase.from("customers").select("*").order("name").limit(500),
    ]);
    if(!r[0].error) entries=r[0].data; if(!r[1].error) bookings=r[1].data;
    if(!r[2].error) units=sortUnits(r[2].data); if(!r[3].error) leaseContracts=r[3].data;
    if(!r[4].error) saleContracts=r[4].data; if(!r[5].error) saleSchedules=r[5].data;
    if(!r[6].error) receivables=r[6].data; if(!r[7].error) payments=r[7].data;
    if(!r[8].error) customers=r[8].data;
  }

  return (
    <>
      <div className="lg:hidden"><DesktopOnly locale="fr" /></div>
      <div className="hidden lg:block">
        <PageHeader title="Rapports" description="Logements, revenus, impayes, journalier, baux, ventes, cloture jour" />
        <ReportsView entries={entries} bookings={bookings} units={units}
          leaseContracts={leaseContracts} saleContracts={saleContracts}
          saleSchedules={saleSchedules} receivables={receivables}
          payments={payments} customers={customers}
          locale="fr" userRole={user.role} />
      </div>
    </>
  );
}
