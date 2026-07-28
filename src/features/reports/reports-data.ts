import "server-only";

import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { sortUnits } from "@/lib/utils";
import type {
  LedgerEntryRow, DailyBookingRow, UnitRow, LeaseContractRow,
  SaleContractRow, SalePaymentScheduleRow, ReceivableRow, PaymentRow, CustomerRow,
} from "@/types/database";

export interface ReportsData {
  entries: LedgerEntryRow[];
  bookings: DailyBookingRow[];
  units: UnitRow[];
  leaseContracts: LeaseContractRow[];
  saleContracts: SaleContractRow[];
  saleSchedules: SalePaymentScheduleRow[];
  receivables: ReceivableRow[];
  payments: PaymentRow[];
  customers: CustomerRow[];
}

const emptyReportsData = (): ReportsData => ({
  entries: [],
  bookings: [],
  units: [],
  leaseContracts: [],
  saleContracts: [],
  saleSchedules: [],
  receivables: [],
  payments: [],
  customers: [],
});

export async function getReportsData(): Promise<ReportsData> {
  const supabase = await createClient();
  const { data: building, error: buildingError } = await supabase
    .from("buildings")
    .select("id")
    .eq("code", "SACSI11")
    .single();

  if (buildingError) throw new Error(`Failed to resolve report building: ${buildingError.message}`);
  if (!building?.id) return emptyReportsData();

  const [
    entries, bookings, units, leaseContracts, saleContracts,
    saleSchedules, receivables, payments, customers,
  ] = await Promise.all([
    fetchAllPages<LedgerEntryRow>(
      (from, to) => supabase.from("ledger_entries").select("*")
        .order("entry_date", { ascending: false }).order("id").range(from, to),
      "report ledger entries",
    ),
    fetchAllPages<DailyBookingRow>(
      (from, to) => supabase.from("daily_bookings").select("*").neq("status", "cancelled")
        .order("check_in").order("id").range(from, to),
      "report daily bookings",
    ),
    fetchAllPages<UnitRow>(
      (from, to) => supabase.from("units").select("*").eq("building_id", building.id)
        .order("unit_no").order("id").range(from, to),
      "report units",
    ),
    fetchAllPages<LeaseContractRow>(
      (from, to) => supabase.from("lease_contracts").select("*")
        .order("start_date", { ascending: false }).order("id").range(from, to),
      "report lease contracts",
    ),
    fetchAllPages<SaleContractRow>(
      (from, to) => supabase.from("sale_contracts").select("*")
        .order("signed_date", { ascending: false }).order("id").range(from, to),
      "report sale contracts",
    ),
    fetchAllPages<SalePaymentScheduleRow>(
      (from, to) => supabase.from("sale_payment_schedule").select("*")
        .order("installment_no").order("id").range(from, to),
      "report sale schedules",
    ),
    fetchAllPages<ReceivableRow>(
      (from, to) => supabase.from("receivables").select("*")
        .order("due_date", { ascending: false }).order("id").range(from, to),
      "report receivables",
    ),
    fetchAllPages<PaymentRow>(
      (from, to) => supabase.from("payments").select("*")
        .order("payment_date", { ascending: false }).order("id").range(from, to),
      "report payments",
    ),
    fetchAllPages<CustomerRow>(
      (from, to) => supabase.from("customers").select("*")
        .order("name").order("id").range(from, to),
      "report customers",
    ),
  ]);

  return {
    entries,
    bookings,
    units: sortUnits(units),
    leaseContracts,
    saleContracts,
    saleSchedules,
    receivables,
    payments,
    customers,
  };
}
