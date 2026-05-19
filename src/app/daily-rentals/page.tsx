import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { dictionaries } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { DailyCalendar } from "@/features/daily-rentals";
import { MobileDailyCards } from "@/features/mobile";
import type { UnitRow, DailyBookingRow, CustomerRow, PaymentRow } from "@/types/database";
import type { CustomerSummary } from "@/features/daily-rentals/calendar";

export const dynamic = "force-dynamic";

export default async function DailyRentalsPage() {
  const t = dictionaries.zh.dailyRentals;
  const supabase = await createClient();
  const { data: building } = await supabase.from("buildings").select("id").eq("code", "SASCI11").single();
  const buildingId = building?.id;

  let dailyUnits: UnitRow[] = [];
  let bookings: DailyBookingRow[] = [];
  let customers: CustomerSummary[] = [];
  let cleaningTasks: { id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean }[] = [];
  let payments: { id: string; source_id: string; amount: number; payment_date: string }[] = [];

  if (buildingId) {
    const [unitsRes, bookingsRes, customersRes, cleaningRes, paymentsRes] = await Promise.all([
      supabase.from("units").select("*, unit_business_flags!inner(business_type, is_enabled)").eq("building_id", buildingId).eq("unit_business_flags.business_type", "daily_rental").eq("unit_business_flags.is_enabled", true).order("unit_no"),
      supabase.from("daily_bookings").select("*").in("status", ["pending_review", "confirmed", "checked_in", "checked_out"]).order("check_in", { ascending: false }).limit(500),
      supabase.from("customers").select("id, name, phone, is_blacklisted").order("name"),
      supabase.from("cleaning_tasks").select("id, unit_id, daily_booking_id, is_completed"),
      supabase.from("payments").select("id, source_id, amount, payment_date").eq("source_type", "daily_booking").order("payment_date", { ascending: false }).limit(500),
    ]);
    if (!unitsRes.error) dailyUnits = ((unitsRes.data as unknown as UnitRow[]) ?? []).sort((a, b) => {
      const aFloor = parseInt(a.floor_label, 10); const bFloor = parseInt(b.floor_label, 10);
      if (aFloor !== bFloor) return aFloor - bFloor;
      return parseInt(a.unit_no, 10) - parseInt(b.unit_no, 10);
    });
    if (!bookingsRes.error) bookings = bookingsRes.data ?? [];
    if (!customersRes.error) customers = customersRes.data ?? [];
    if (!cleaningRes.error) cleaningTasks = cleaningRes.data ?? [];
    if (!paymentsRes.error) payments = paymentsRes.data ?? [];
  }

  return (
    <>
      <div className="lg:hidden">
        <PageHeader title={t.title} description={t.description} />
        <MobileDailyCards dailyUnits={dailyUnits} bookings={bookings} customers={customers as unknown as CustomerRow[]} payments={payments as unknown as PaymentRow[]} cleaningTasks={cleaningTasks} locale="zh" />
      </div>
      <div className="hidden lg:block">
        <PageHeader title={t.title} description={t.description} />
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard title={t.metrics[0][0]} value={t.metrics[0][1]} caption={t.metrics[0][2]} />
          <MetricCard title={t.metrics[1][0]} value={t.metrics[1][1]} caption={t.metrics[1][2]} accent="green" />
          <MetricCard title={t.metrics[2][0]} value={t.metrics[2][1]} caption={t.metrics[2][2]} accent="ink" />
        </div>
        <section className="mt-8">
          <DailyCalendar dailyUnits={dailyUnits} bookings={bookings} customers={customers} cleaningTasks={cleaningTasks} payments={payments} locale="zh" />
        </section>
      </div>
    </>
  );
}
