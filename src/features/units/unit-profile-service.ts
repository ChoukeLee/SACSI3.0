import { createClient } from "@/lib/supabase/server";
import type {
  CustomerRow,
  DailyBookingRow,
  LeaseContractRow,
  PaymentRow,
  ReceivableRow,
  SaleContractRow,
  UnitRow,
} from "@/types/database";

export interface UnitProfileData {
  unit: UnitRow;
  buildingName: string;
  dailyBookings: DailyBookingRow[];
  leaseContracts: LeaseContractRow[];
  saleContracts: SaleContractRow[];
  receivables: ReceivableRow[];
  payments: PaymentRow[];
  customers: CustomerRow[];
}

export async function fetchUnitProfile(unitId: string): Promise<UnitProfileData | null> {
  const supabase = await createClient();
  const { data: unit } = await supabase.from("units").select("*").eq("id", unitId).single();
  if (!unit) return null;

  const [
    { data: building },
    { data: dailyBookings },
    { data: leaseContracts },
    { data: saleContracts },
    { data: receivables },
    { data: payments },
  ] = await Promise.all([
    supabase.from("buildings").select("display_name, code").eq("id", unit.building_id).single(),
    supabase.from("daily_bookings").select("*").eq("unit_id", unitId).order("check_in", { ascending: false }).limit(100),
    supabase.from("lease_contracts").select("*").eq("unit_id", unitId).order("start_date", { ascending: false }).limit(50),
    supabase.from("sale_contracts").select("*").eq("unit_id", unitId).order("signed_date", { ascending: false }).limit(50),
    supabase.from("receivables").select("*").eq("unit_id", unitId).order("due_date", { ascending: false }).limit(200),
    supabase.from("payments").select("*").eq("unit_id", unitId).order("payment_date", { ascending: false }).limit(200),
  ]);

  const customerIds = new Set<string>();
  for (const row of dailyBookings ?? []) if (row.customer_id) customerIds.add(row.customer_id);
  for (const row of leaseContracts ?? []) if (row.customer_id) customerIds.add(row.customer_id);
  for (const row of saleContracts ?? []) if (row.customer_id) customerIds.add(row.customer_id);
  const { data: customers } = customerIds.size > 0
    ? await supabase.from("customers").select("*").in("id", Array.from(customerIds))
    : { data: [] };

  return {
    unit: unit as UnitRow,
    buildingName: building?.display_name ?? building?.code ?? "-",
    dailyBookings: (dailyBookings ?? []) as DailyBookingRow[],
    leaseContracts: (leaseContracts ?? []) as LeaseContractRow[],
    saleContracts: (saleContracts ?? []) as SaleContractRow[],
    receivables: (receivables ?? []) as ReceivableRow[],
    payments: (payments ?? []) as PaymentRow[],
    customers: (customers ?? []) as CustomerRow[],
  };
}

