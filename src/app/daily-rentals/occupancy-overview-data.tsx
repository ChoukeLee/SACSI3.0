import { unstable_noStore as noStore } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sortUnits } from "@/lib/utils";
import { DailyOccupancyOverview } from "@/features/daily-rentals/occupancy-overview";
import type { Locale } from "@/lib/i18n";
import type { DailyBookingRow, UnitRow } from "@/types/database";

export async function DailyOccupancyOverviewData({ locale }: { locale: Locale }) {
  noStore();
  const supabase = await createClient();
  const { data: building } = await supabase.from("buildings").select("id").eq("code", "SACSI11").single();

  if (!building) {
    return <DailyOccupancyOverview dailyUnits={[]} bookings={[]} cleaningTasks={[]} locale={locale} />;
  }

  const [unitsRes, bookingsRes, cleaningRes] = await Promise.all([
    supabase
      .from("units")
      .select("id, unit_no, floor_label, status, notes, unit_business_flags!inner(business_type, is_enabled)")
      .eq("building_id", building.id)
      .eq("unit_business_flags.business_type", "daily_rental")
      .eq("unit_business_flags.is_enabled", true)
      .neq("unit_no", "503")
      .in("status", ["available", "reserved", "daily_occupied", "cleaning_pending", "maintenance"])
      .order("unit_no"),
    supabase
      .from("daily_bookings")
      .select("id, unit_id, customer_id, check_in, check_out, checkout_mode, actual_check_out, nightly_price_xof, total_amount_xof, prepaid_amount_xof, manual_discount_amount_xof, final_amount_xof, status, notes")
      .in("status", ["confirmed", "checked_in"]),
    supabase
      .from("cleaning_tasks")
      .select("id, unit_id, daily_booking_id, is_completed")
      .eq("is_completed", false),
  ]);

  const bookings = (bookingsRes.data ?? []) as unknown as DailyBookingRow[];
  return (
    <DailyOccupancyOverview
      dailyUnits={sortUnits((unitsRes.data ?? []) as unknown as UnitRow[])}
      bookings={bookings}
      cleaningTasks={cleaningRes.data ?? []}
      locale={locale}
    />
  );
}
