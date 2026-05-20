
import { PageHeader } from "@/components/page-header";
import { dictionaries } from "@/lib/i18n";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sortUnits } from "@/lib/utils";
import { DailyCalendar } from "@/features/daily-rentals";
import type { UnitRow, DailyBookingRow } from "@/types/database";
import type { CustomerSummary } from "@/features/daily-rentals/calendar";

export const dynamic = "force-dynamic";

export default async function FrenchDailyRentalsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin","front_desk","finance","boss"].includes(user.role)) redirect("/");

  const t = dictionaries.fr.dailyRentals;
  const supabase = await createClient();

  const { data: building } = await supabase
    .from("buildings")
    .select("id")
    .eq("code", "SASCI11")
    .single();

  const buildingId = building?.id;

  let dailyUnits: UnitRow[] = [];
  let bookings: DailyBookingRow[] = [];
  let customers: CustomerSummary[] = [];
  let cleaningTasks: { id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean }[] = [];
  let payments: { id: string; source_id: string; amount: number; payment_date: string }[] = [];

  if (buildingId) {
    const [unitsRes, bookingsRes, customersRes, cleaningRes, paymentsRes] = await Promise.all([
      supabase
        .from("units")
        .select("*, unit_business_flags!inner(business_type, is_enabled)")
        .eq("building_id", buildingId)
        .eq("unit_business_flags.business_type", "daily_rental")
        .eq("unit_business_flags.is_enabled", true)
        .order("unit_no"),
      supabase
        .from("daily_bookings")
        .select("*")
        .in("status", ["pending_review", "confirmed", "checked_in", "checked_out"])
        .order("check_in", { ascending: false })
        .limit(500),
      supabase.from("customers").select("id, name, phone, is_blacklisted").order("name"),
      supabase.from("cleaning_tasks").select("id, unit_id, daily_booking_id, is_completed"),
      supabase.from("payments").select("id, source_id, amount, payment_date").eq("source_type", "daily_booking").order("payment_date", { ascending: false }).limit(500),
    ]);

    if (!unitsRes.error) dailyUnits = sortUnits(((unitsRes.data as unknown as UnitRow[]) ?? []));
    if (!bookingsRes.error) bookings = bookingsRes.data ?? [];
    if (!customersRes.error) customers = customersRes.data ?? [];
    if (!cleaningRes.error) cleaningTasks = cleaningRes.data ?? [];
    if (!paymentsRes.error) payments = paymentsRes.data ?? [];
  }

  return (
      <>

<><PageHeader title={t.title} description={t.description} />
      <p className="text-xs text-brand-ink-400 mt-2 mb-6">Location jour : 21 chambres fixes · 40 000 XOF/nuit · paiement anticipe obligatoire</p>
      <section>
        <DailyCalendar
          dailyUnits={dailyUnits}
          bookings={bookings}
          customers={customers}
          cleaningTasks={cleaningTasks}
          payments={payments}
          locale="fr"
        />
      </section>

      </>
</>);
}
