import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { dictionaries } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { OverviewView } from "@/features/daily-rentals/overview-view";
import type { UnitRow, DailyBookingRow, CustomerRow, PaymentRow } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function DailyOverviewPage() {
  const t = dictionaries.zh.dailyOccupancy;
  const supabase = await createClient();

  const { data: building } = await supabase.from("buildings").select("id").eq("code", "SASCI11").single();
  const buildingId = building?.id;

  let dailyUnits: UnitRow[] = [];
  let bookings: DailyBookingRow[] = [];
  let customers: CustomerRow[] = [];
  let payments: PaymentRow[] = [];
  let cleaningTasks: { id: string; unit_id: string; is_completed: boolean }[] = [];

  if (buildingId) {
    const [unitsRes, bookingsRes, customersRes, paymentsRes, cleaningRes] = await Promise.all([
      supabase.from("units").select("*, unit_business_flags!inner(business_type, is_enabled)")
        .eq("building_id", buildingId)
        .eq("unit_business_flags.business_type", "daily_rental")
        .eq("unit_business_flags.is_enabled", true)
        .order("unit_no"),
      supabase.from("daily_bookings").select("*")
        .in("status", ["confirmed", "checked_in", "checked_out"])
        .order("check_in", { ascending: false }).limit(500),
      supabase.from("customers").select("id, name, phone, is_blacklisted").order("name"),
      supabase.from("payments").select("*").eq("source_type", "daily_booking").order("payment_date", { ascending: false }).limit(500),
      supabase.from("cleaning_tasks").select("id, unit_id, is_completed"),
    ]);

    if (!unitsRes.error) dailyUnits = ((unitsRes.data as unknown as UnitRow[]) ?? []).sort((a, b) => {
      const aFloor = parseInt(a.floor_label, 10);
      const bFloor = parseInt(b.floor_label, 10);
      if (aFloor !== bFloor) return aFloor - bFloor;
      return parseInt(a.unit_no, 10) - parseInt(b.unit_no, 10);
    });
    if (!bookingsRes.error) bookings = (bookingsRes.data as DailyBookingRow[]) ?? [];
    if (!customersRes.error) customers = (customersRes.data as CustomerRow[]) ?? [];
    if (!paymentsRes.error) payments = (paymentsRes.data as PaymentRow[]) ?? [];
    if (!cleaningRes.error) cleaningTasks = cleaningRes.data ?? [];
  }

  return (
    <AppShell>
      <PageHeader title={t.title} description={t.description} />
      <OverviewView
        dailyUnits={dailyUnits}
        bookings={bookings}
        customers={customers}
        payments={payments}
        cleaningTasks={cleaningTasks}
        locale="zh"
      />
    </AppShell>
  );
}
