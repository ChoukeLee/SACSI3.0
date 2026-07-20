import { createClient } from "@/lib/supabase/server";
import { unstable_noStore as noStore } from "next/cache";
import { sortUnits } from "@/lib/utils";
import { DailyRentalsResponsiveView } from "@/features/daily-rentals/daily-rentals-responsive-view";
import type { UnitRow, DailyBookingRow } from "@/types/database";
import type { CustomerSummary } from "@/features/daily-rentals/calendar";

import type { Locale } from "@/lib/i18n";

interface DailyRentalDataProps {
  userRole: string;
  locale: Locale;
}

/**
 * Async data-fetching component for daily rentals.
 * Wrapped in Suspense in the page — streams in after the page shell.
 */
export async function DailyRentalData({ userRole, locale }: DailyRentalDataProps) {
  noStore();
  const supabase = await createClient();

  const [buildingRes, customersRes, activeLeasesRes, activeSalesRes, cleaningRes, paymentsRes, bookingsRes] =
    await Promise.all([
      supabase.from("buildings").select("id").eq("code", "SACSI11").single(),
      supabase.from("customers").select("id, name, phone, is_blacklisted").order("name"),
      supabase.from("lease_contracts").select("customer_id").eq("status", "active"),
      supabase.from("sale_contracts").select("customer_id").eq("status", "active"),
      supabase.from("cleaning_tasks").select("id, unit_id, daily_booking_id, is_completed"),
      supabase
        .from("payments")
        .select("id, source_id, amount, payment_date")
        .eq("source_type", "daily_booking")
        .order("payment_date", { ascending: false })
        .limit(200),
      supabase
        .from("daily_bookings")
        .select(
          "id, unit_id, customer_id, check_in, check_out, checkout_mode, actual_check_out, nightly_price_xof, total_amount_xof, prepaid_amount_xof, manual_discount_amount_xof, final_amount_xof, status, notes"
        )
        .in("status", ["pending_review", "confirmed", "checked_in", "checked_out"])
        .order("check_in", { ascending: false })
        .limit(300),
    ]);

  let dailyUnits: UnitRow[] = [];
  let bookings: DailyBookingRow[] = [];
  let customers: CustomerSummary[] = [];
  let cleaningTasks: { id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean }[] = [];
  let payments: { id: string; source_id: string; amount: number; payment_date: string }[] = [];

  if (!customersRes.error) {
    const activeLeaseCustomerIds = new Set((activeLeasesRes.data ?? []).map((row) => row.customer_id).filter(Boolean));
    const activeSaleCustomerIds = new Set((activeSalesRes.data ?? []).map((row) => row.customer_id).filter(Boolean));
    customers = (customersRes.data ?? []).map((customer) => ({
      ...customer,
      has_active_lease_contract: activeLeaseCustomerIds.has(customer.id),
      has_active_sale_contract: activeSaleCustomerIds.has(customer.id),
    }));
  }
  if (!cleaningRes.error) cleaningTasks = cleaningRes.data ?? [];
  if (!paymentsRes.error) payments = paymentsRes.data ?? [];
  if (!bookingsRes.error) bookings = (bookingsRes.data as unknown as DailyBookingRow[]) ?? [];

  const buildingId = buildingRes.data?.id;
  if (buildingId) {
    const { data: unitsData, error: unitsErr } = await supabase
      .from("units")
      .select("id, unit_no, floor_label, status, notes, unit_business_flags!inner(business_type, is_enabled)")
      .eq("building_id", buildingId)
      .eq("unit_business_flags.business_type", "daily_rental")
      .eq("unit_business_flags.is_enabled", true)
      .neq("unit_no", "503")
      .in("status", ["available", "reserved", "daily_occupied", "cleaning_pending", "maintenance"])
      .order("unit_no");
    if (!unitsErr) dailyUnits = sortUnits((unitsData as unknown as UnitRow[]) ?? []);
  }

  return (
    <DailyRentalsResponsiveView
      dailyUnits={dailyUnits}
      bookings={bookings}
      customers={customers}
      payments={payments}
      cleaningTasks={cleaningTasks}
      locale={locale}
      userRole={userRole}
    />
  );
}
