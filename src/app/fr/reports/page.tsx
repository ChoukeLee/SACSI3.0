
import { PageHeader } from "@/components/page-header";
import { dictionaries } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { ReportsView } from "@/features/reports";
import type { LedgerEntryRow, DailyBookingRow, UnitRow, LeaseContractRow, SaleContractRow, SalePaymentScheduleRow } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function FrenchReportsPage() {
  const t = dictionaries.fr.reports;
  const supabase = await createClient();

  const { data: building } = await supabase.from("buildings").select("id").eq("code", "SASCI11").single();
  const buildingId = building?.id;

  let entries: LedgerEntryRow[] = [];
  let bookings: DailyBookingRow[] = [];
  let units: UnitRow[] = [];
  let leaseContracts: LeaseContractRow[] = [];
  let saleContracts: SaleContractRow[] = [];
  let saleSchedules: SalePaymentScheduleRow[] = [];

  if (buildingId) {
    const [entriesRes, bookingsRes, unitsRes, leasesRes, salesRes, schedulesRes] = await Promise.all([
      supabase.from("ledger_entries").select("*").order("entry_date", { ascending: false }).limit(1000),
      supabase.from("daily_bookings").select("*").neq("status", "cancelled").order("check_in").limit(1000),
      supabase.from("units").select("*").eq("building_id", buildingId).order("unit_no"),
      supabase.from("lease_contracts").select("*").order("start_date", { ascending: false }).limit(200),
      supabase.from("sale_contracts").select("*").order("signed_date", { ascending: false }).limit(200),
      supabase.from("sale_payment_schedule").select("*").order("installment_no").limit(500),
    ]);
    if (!entriesRes.error) entries = entriesRes.data;
    if (!bookingsRes.error) bookings = bookingsRes.data;
    if (!unitsRes.error) units = unitsRes.data;
    if (!leasesRes.error) leaseContracts = leasesRes.data;
    if (!salesRes.error) saleContracts = salesRes.data;
    if (!schedulesRes.error) saleSchedules = schedulesRes.data;
  }

  return (
      <>

<><PageHeader title={t.title} description={t.description} />
      <ReportsView
        entries={entries}
        bookings={bookings}
        units={units}
        leaseContracts={leaseContracts}
        saleContracts={saleContracts}
        saleSchedules={saleSchedules}
        locale="fr"
      />

      </>
</>);
}
