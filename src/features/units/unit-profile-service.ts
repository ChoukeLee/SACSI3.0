import { createClient } from "@/lib/supabase/server";
import type {
  UnitRow, DailyBookingRow, LeaseContractRow, SaleContractRow,
  ReceivableRow, PaymentRow, CustomerRow,
} from "@/types/database";

export interface UnitProfileData {
  unit: UnitRow;
  dailyBookings: DailyBookingRow[];
  leaseContracts: LeaseContractRow[];
  saleContracts: SaleContractRow[];
  receivables: ReceivableRow[];
  payments: PaymentRow[];
  customers: CustomerRow[];
  auditLogs: { id: string; created_at: string; action: string; entity_type: string; entity_id: string | null; metadata: Record<string, unknown> | null }[];
  buildingName: string;
}

export async function fetchUnitProfile(unitId: string): Promise<UnitProfileData | null> {
  const supabase = await createClient();

  const { data: unit } = await supabase.from("units").select("*").eq("id", unitId).single();
  if (!unit) return null;

  const { data: building } = await supabase.from("buildings").select("display_name, code").eq("id", unit.building_id).single();

  const [
    { data: dailyBookings },
    { data: leaseContracts },
    { data: saleContracts },
    { data: receivables },
    { data: payments },
    { data: auditLogs },
    { data: customers },
  ] = await Promise.all([
    supabase.from("daily_bookings").select("*").eq("unit_id", unitId).order("check_in", { ascending: false }).limit(100),
    supabase.from("lease_contracts").select("*").eq("unit_id", unitId).order("start_date", { ascending: false }).limit(50),
    supabase.from("sale_contracts").select("*").eq("unit_id", unitId).order("signed_date", { ascending: false }).limit(50),
    supabase.from("receivables").select("*").eq("unit_id", unitId).order("due_date", { ascending: false }).limit(200),
    supabase.from("payments").select("*").eq("unit_id", unitId).order("payment_date", { ascending: false }).limit(200),
    supabase.from("audit_logs").select("id, created_at, action, entity_type, entity_id, metadata").eq("entity_id", unitId).order("created_at", { ascending: false }).limit(100),
    supabase.from("customers").select("*").order("name").limit(500),
  ]);

  // Collect customer IDs from bookings/contracts
  const customerIds = new Set<string>();
  for (const b of (dailyBookings ?? [])) b.customer_id && customerIds.add(b.customer_id);
  for (const l of (leaseContracts ?? [])) l.customer_id && customerIds.add(l.customer_id);
  for (const s of (saleContracts ?? [])) s.customer_id && customerIds.add(s.customer_id);
  const relevantCustomers = (customers ?? []).filter(c => customerIds.has(c.id));

  return {
    unit: unit as UnitRow,
    dailyBookings: (dailyBookings ?? []) as DailyBookingRow[],
    leaseContracts: (leaseContracts ?? []) as LeaseContractRow[],
    saleContracts: (saleContracts ?? []) as SaleContractRow[],
    receivables: (receivables ?? []) as ReceivableRow[],
    payments: (payments ?? []) as PaymentRow[],
    customers: relevantCustomers as CustomerRow[],
    auditLogs: (auditLogs ?? []) as { id: string; created_at: string; action: string; entity_type: string; entity_id: string | null; metadata: Record<string, unknown> | null }[],
    buildingName: building?.display_name ?? building?.code ?? "",
  };
}
