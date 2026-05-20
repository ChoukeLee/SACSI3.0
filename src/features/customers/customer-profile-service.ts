import { createClient } from "@/lib/supabase/server";
import type {
  CustomerRow, DailyBookingRow, LeaseContractRow, SaleContractRow,
  ReceivableRow, PaymentRow, UnitRow
} from "@/types/database";

export interface CustomerProfileData {
  customer: CustomerRow;
  units: UnitRow[];
  dailyBookings: DailyBookingRow[];
  leaseContracts: LeaseContractRow[];
  saleContracts: SaleContractRow[];
  receivables: ReceivableRow[];
  payments: PaymentRow[];
  auditLogs: { id: string; created_at: string; action: string; entity_type: string; entity_id: string | null; metadata: Record<string, unknown> | null }[];
}

export async function fetchCustomerProfile(customerId: string): Promise<CustomerProfileData | null> {
  const supabase = await createClient();

  const { data: customer } = await supabase.from("customers").select("*").eq("id", customerId).single();
  if (!customer) return null;

  const [
    { data: dailyBookings },
    { data: leaseContracts },
    { data: saleContracts },
    { data: receivables },
    { data: payments },
    { data: auditLogs },
    { data: units },
  ] = await Promise.all([
    supabase.from("daily_bookings").select("*").eq("customer_id", customerId).order("check_in", { ascending: false }).limit(100),
    supabase.from("lease_contracts").select("*").eq("customer_id", customerId).order("start_date", { ascending: false }).limit(50),
    supabase.from("sale_contracts").select("*").eq("customer_id", customerId).order("signed_date", { ascending: false }).limit(50),
    supabase.from("receivables").select("*").eq("customer_id", customerId).order("due_date", { ascending: false }).limit(200),
    supabase.from("payments").select("*").eq("customer_id", customerId).order("payment_date", { ascending: false }).limit(200),
    supabase.from("audit_logs").select("id, created_at, action, entity_type, entity_id, metadata").eq("entity_id", customerId).order("created_at", { ascending: false }).limit(100),
    supabase.from("units").select("*").order("unit_no"),
  ]);

  // Get all units that appear in this customer's bookings/contracts
  const unitIds = new Set<string>();
  for (const b of (dailyBookings ?? [])) unitIds.add(b.unit_id);
  for (const l of (leaseContracts ?? [])) l.unit_id && unitIds.add(l.unit_id);
  for (const s of (saleContracts ?? [])) s.unit_id && unitIds.add(s.unit_id);
  const relevantUnits = (units ?? []).filter(u => unitIds.has(u.id));

  return {
    customer: customer as CustomerRow,
    units: relevantUnits as UnitRow[],
    dailyBookings: (dailyBookings ?? []) as DailyBookingRow[],
    leaseContracts: (leaseContracts ?? []) as LeaseContractRow[],
    saleContracts: (saleContracts ?? []) as SaleContractRow[],
    receivables: (receivables ?? []) as ReceivableRow[],
    payments: (payments ?? []) as PaymentRow[],
    auditLogs: (auditLogs ?? []) as { id: string; created_at: string; action: string; entity_type: string; entity_id: string | null; metadata: Record<string, unknown> | null }[],
  };
}
