import { fetchAllPages } from "@/lib/supabase/fetch-all";
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
  position?: UnitPosition;

  buildingName: string;
  dailyBookings: DailyBookingRow[];
  leaseContracts: LeaseContractRow[];
  saleContracts: SaleContractRow[];
  receivables: ReceivableRow[];
  payments: PaymentRow[];
  customers: CustomerRow[];
}

export interface UnitPosition {
  ownership: "sold" | "unspecified";
  operational_condition: string;
  daily_occupied: boolean;
  lease_occupied: boolean;
  cleaning_pending: boolean;
  daily_enabled: boolean;
  lease_enabled: boolean;
}

export async function fetchUnitProfile(unitId: string): Promise<UnitProfileData | null> {
  const supabase = await createClient();
  const { data: unit, error: unitError } = await supabase.from("units").select("*").eq("id", unitId).maybeSingle();
  if (unitError) throw new Error("UnitProfileUnavailable");
  if (!unit) return null;
  const [buildingResult, positionResult, dailyBookings, leaseContracts, saleContracts, receivables, payments] = await Promise.all([
    supabase.from("buildings").select("display_name, code").eq("id", unit.building_id).single(),
    supabase.from("unit_operational_position").select("*").eq("id",unitId).single(),
    fetchAllPages<DailyBookingRow>((from,to)=>supabase.from("daily_bookings").select("*",{count:"exact"}).eq("unit_id",unitId).order("check_in",{ascending:false}).order("id").range(from,to),"daily bookings"),
    fetchAllPages<LeaseContractRow>((from,to)=>supabase.from("lease_contracts").select("*",{count:"exact"}).eq("unit_id",unitId).order("start_date",{ascending:false}).order("id").range(from,to),"lease contracts"),
    fetchAllPages<SaleContractRow>((from,to)=>supabase.from("sale_contracts").select("*",{count:"exact"}).eq("unit_id",unitId).order("signed_date",{ascending:false}).order("id").range(from,to),"sale contracts"),
    fetchAllPages<ReceivableRow>((from,to)=>supabase.from("receivables").select("*",{count:"exact"}).eq("unit_id",unitId).order("due_date",{ascending:false}).order("id").range(from,to),"receivables"),
    fetchAllPages<PaymentRow>((from,to)=>supabase.from("payments").select("*",{count:"exact"}).eq("unit_id",unitId).order("payment_date",{ascending:false}).order("id").range(from,to),"payments"),
  ]);
  if (buildingResult.error || positionResult.error) throw new Error("UnitProfileUnavailable");
  const customerIds = new Set<string>();
  for (const row of dailyBookings) {
    if(row.customer_id) customerIds.add(row.customer_id);
    if(row.guest_customer_id) customerIds.add(row.guest_customer_id);
    if(row.booking_agent_id) customerIds.add(row.booking_agent_id);
  }
  for (const row of [...leaseContracts,...saleContracts]) if(row.customer_id) customerIds.add(row.customer_id);
  // Avoid oversized URL filters; each batch remains ordered and fully paged.
  const ids=[...customerIds]; const customers: CustomerRow[]=[];
  for(let offset=0;offset<ids.length;offset+=100) customers.push(...await fetchAllPages<CustomerRow>(
    (from,to)=>supabase.from("customers").select("*",{count:"exact"}).in("id",ids.slice(offset,offset+100)).order("id").range(from,to),"customers"));
  return { unit: unit as UnitRow, position: positionResult.data as UnitPosition,
    buildingName: buildingResult.data?.display_name ?? buildingResult.data?.code ?? "-",
    dailyBookings,leaseContracts,saleContracts,receivables,payments,customers };
}
