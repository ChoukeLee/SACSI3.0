import { createClient } from "@/lib/supabase/server";
import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
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
  const userAgent = (await headers()).get("user-agent") ?? "";
  const initialIsDesktop = !/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
  const supabase = await createClient();

  const [buildingsRes, customersRes, activeLeasesRes, activeSalesRes, cleaningRes, paymentsRes, bookingsRes, unitsRes] =
    await Promise.all([
      supabase.from("buildings").select("id, code, display_name").in("code", ["SACSI11", "SACSI5"]).eq("is_active", true),
      supabase.from("customers").select("id, name, phone, is_blacklisted").order("name"),
      supabase.from("lease_contracts").select("customer_id").eq("status", "active"),
      supabase.from("sale_contracts").select("customer_id").eq("status", "active"),
      supabase.from("cleaning_tasks").select("id, unit_id, daily_booking_id, is_completed").eq("is_completed", false),
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
      supabase
        .from("units")
        .select("id, building_id, code, unit_no, floor_label, status, notes, unit_business_flags!inner(business_type, is_enabled, default_price_xof)")
        .eq("unit_business_flags.business_type", "daily_rental")
        .eq("unit_business_flags.is_enabled", true)
        .in("status", ["available", "reserved", "daily_occupied", "cleaning_pending", "maintenance"])
        .order("unit_no"),
    ]);

  let dailyUnits: UnitRow[] = [];
  let unitLookupUnits: UnitRow[] = [];
  let bookings: DailyBookingRow[] = [];
  let customers: CustomerSummary[] = [];
  let cleaningTasks: { id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean }[] = [];
  let payments: { id: string; source_id: string; amount: number; payment_date: string }[] = [];

  if (!customersRes.error) {
    const activeLeaseCustomerIds = new Set((activeLeasesRes.data ?? []).map((row) => row.customer_id).filter(Boolean));
    const activeSaleCustomerIds = new Set((activeSalesRes.data ?? []).map((row) => row.customer_id).filter(Boolean));
    customers = (customersRes.data ?? []).map((customer) => ({
      ...(customer as unknown as CustomerSummary),
      has_active_lease_contract: activeLeaseCustomerIds.has(customer.id),
      has_active_sale_contract: activeSaleCustomerIds.has(customer.id),
    }));
  }
  if (!cleaningRes.error) cleaningTasks = cleaningRes.data ?? [];
  if (!paymentsRes.error) payments = paymentsRes.data ?? [];
  if (!bookingsRes.error) bookings = (bookingsRes.data as unknown as DailyBookingRow[]) ?? [];

  const buildings = (buildingsRes.data ?? []).sort((left, right) => (
    left.code === "SACSI11" ? -1 : right.code === "SACSI11" ? 1 : left.code.localeCompare(right.code)
  ));
  const buildingIds = buildings.map((building) => building.id);
  if (buildingIds.length > 0 && !unitsRes.error) {
    const buildingIdSet = new Set(buildingIds);
    dailyUnits = sortUnits((((unitsRes.data ?? []).filter((unit) => buildingIdSet.has(unit.building_id))).map((unit) => {
      const flags = Array.isArray(unit.unit_business_flags) ? unit.unit_business_flags : [unit.unit_business_flags];
      return {
        ...unit,
        daily_rental_price_xof: flags.find((flag) => flag?.business_type === "daily_rental")?.default_price_xof ?? null,
      };
    }) as unknown as UnitRow[]));
    const visibleUnitIds = new Set(dailyUnits.map((unit) => unit.id));
    const bookingUnitIds = Array.from(new Set(bookings.map((booking) => booking.unit_id).filter(Boolean)));
    const missingBookingUnitIds = bookingUnitIds.filter((unitId) => !visibleUnitIds.has(unitId));
    let historyUnits: UnitRow[] = [];
    if (missingBookingUnitIds.length > 0) {
      const { data: historyUnitsData, error: historyUnitsErr } = await supabase
        .from("units")
        .select("id, building_id, code, unit_no, floor_label, status, notes")
        .in("building_id", buildingIds)
        .in("id", missingBookingUnitIds);
      if (!historyUnitsErr) historyUnits = (historyUnitsData as unknown as UnitRow[]) ?? [];
    }
    const activeBookingUnitIds = new Set(
      bookings
        .filter((booking) => booking.status === "confirmed" || booking.status === "checked_in")
        .map((booking) => booking.unit_id),
    );
    const activeExternalUnits = historyUnits.filter((unit) => activeBookingUnitIds.has(unit.id));
    dailyUnits = sortUnits([...dailyUnits, ...activeExternalUnits]);
    unitLookupUnits = sortUnits([...dailyUnits, ...historyUnits]);
  }

  return (
    <DailyRentalsResponsiveView
      dailyUnits={dailyUnits}
      unitLookupUnits={unitLookupUnits}
      bookings={bookings}
      customers={customers}
      payments={payments}
      cleaningTasks={cleaningTasks}
      locale={locale}
      userRole={userRole}
      buildings={buildings}
      initialIsDesktop={initialIsDesktop}
    />
  );
}
