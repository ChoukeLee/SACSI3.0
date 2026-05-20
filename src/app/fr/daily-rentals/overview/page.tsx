
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { dictionaries } from "@/lib/i18n";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sortUnits } from "@/lib/utils";
import { OverviewView } from "@/features/daily-rentals/overview-view";
import type { UnitRow, DailyBookingRow, CustomerRow, PaymentRow } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function FrenchDailyOverviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "front_desk", "finance", "boss"].includes(user.role)) redirect("/fr");

  const t = dictionaries.fr.dailyOccupancy;
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
        .in("status", ["pending_review", "confirmed", "checked_in", "checked_out"])
        .order("check_in", { ascending: false }).limit(500),
      supabase.from("customers").select("id, name, phone, is_blacklisted").order("name"),
      supabase.from("payments").select("*").eq("source_type", "daily_booking").order("payment_date", { ascending: false }).limit(500),
      supabase.from("cleaning_tasks").select("id, unit_id, is_completed"),
    ]);

    if (!unitsRes.error) dailyUnits = sortUnits(((unitsRes.data as unknown as UnitRow[]) ?? []));
    if (!bookingsRes.error) bookings = (bookingsRes.data as DailyBookingRow[]) ?? [];
    if (!customersRes.error) customers = (customersRes.data as CustomerRow[]) ?? [];
    if (!paymentsRes.error) payments = (paymentsRes.data as PaymentRow[]) ?? [];
    if (!cleaningRes.error) cleaningTasks = cleaningRes.data ?? [];
  }

  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      <OverviewView
        dailyUnits={dailyUnits}
        bookings={bookings}
        customers={customers}
        payments={payments}
        cleaningTasks={cleaningTasks}
        locale="fr"
      />
    </>
  );
}
