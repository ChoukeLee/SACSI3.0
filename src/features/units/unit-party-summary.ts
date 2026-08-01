import type { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export interface UnitPartySummary {
  dailyCustomerName?: string;
  dailyDateText?: string;
  leaseCustomerName?: string;
  leaseEndDate?: string;
  leaseEndConfirmed?: boolean;
  saleCustomerName?: string;
}

export async function getUnitPartySummaries(supabase: ServerClient, unitIds: string[]) {
  const summaries: Record<string, UnitPartySummary> = {};
  if (unitIds.length === 0) return { summaries, activeLeaseUnitIds: [] as string[] };

  const [leasesRes, salesRes, bookingsRes, customersRes] = await Promise.all([
    supabase
      .from("lease_contracts")
      .select("unit_id, customer_id, expected_end_date, expected_end_confirmed")
      .eq("status", "active")
      .in("unit_id", unitIds),
    supabase
      .from("sale_contracts")
      .select("unit_id, customer_id, signed_date")
      .eq("status", "active")
      .in("unit_id", unitIds)
      .order("signed_date", { ascending: false }),
    supabase
      .from("daily_bookings")
      .select("unit_id, customer_id, check_in, check_out, checkout_mode, actual_check_out, status")
      .in("status", ["confirmed", "checked_in"])
      .in("unit_id", unitIds)
      .order("check_in"),
    supabase.from("customers").select("id, name"),
  ]);

  if (leasesRes.error) console.error("Failed to fetch unit lease parties:", leasesRes.error);
  if (salesRes.error) console.error("Failed to fetch unit sale parties:", salesRes.error);
  if (bookingsRes.error) console.error("Failed to fetch unit daily parties:", bookingsRes.error);
  if (customersRes.error) console.error("Failed to fetch unit party names:", customersRes.error);

  const customerNames = new Map((customersRes.data ?? []).map((customer) => [customer.id, customer.name]));
  const activeLeaseUnitIds: string[] = [];

  for (const lease of leasesRes.data ?? []) {
    activeLeaseUnitIds.push(lease.unit_id);
    summaries[lease.unit_id] = {
      ...summaries[lease.unit_id],
      leaseCustomerName: customerNames.get(lease.customer_id),
      leaseEndDate: lease.expected_end_date,
      leaseEndConfirmed: lease.expected_end_confirmed !== false,
    };
  }

  for (const sale of salesRes.data ?? []) {
    if (summaries[sale.unit_id]?.saleCustomerName) continue;
    summaries[sale.unit_id] = {
      ...summaries[sale.unit_id],
      saleCustomerName: customerNames.get(sale.customer_id),
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const bookingsByUnit = new Map<string, NonNullable<typeof bookingsRes.data>>();
  for (const booking of bookingsRes.data ?? []) {
    const rows = bookingsByUnit.get(booking.unit_id) ?? [];
    rows.push(booking);
    bookingsByUnit.set(booking.unit_id, rows);
  }

  for (const [unitId, rows] of bookingsByUnit) {
    const booking = [...rows].sort((a, b) => {
      if (a.status === "checked_in" && b.status !== "checked_in") return -1;
      if (b.status === "checked_in" && a.status !== "checked_in") return 1;
      const aFuture = a.check_in >= today ? 0 : 1;
      const bFuture = b.check_in >= today ? 0 : 1;
      return aFuture - bFuture || a.check_in.localeCompare(b.check_in);
    })[0];
    if (!booking) continue;
    const end = booking.checkout_mode === "open"
      ? booking.actual_check_out ?? "未定"
      : booking.check_out ?? booking.check_in;
    summaries[unitId] = {
      ...summaries[unitId],
      dailyCustomerName: customerNames.get(booking.customer_id),
      dailyDateText: `${booking.check_in} - ${end}`,
    };
  }

  return { summaries, activeLeaseUnitIds: Array.from(new Set(activeLeaseUnitIds)) };
}
