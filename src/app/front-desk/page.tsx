import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sortUnits } from "@/lib/utils";
import { FrontDeskWorkspace } from "@/features/front-desk";
import type { UnitRow, DailyBookingRow, CustomerRow, PaymentRow } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function FrontDeskPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "front_desk"].includes(user.role)) redirect("/");

  const supabase = await createClient();
  const { data: building } = await supabase.from("buildings").select("id, display_name").eq("code", "SASCI11").single();
  const buildingId = building?.id;

  let dailyUnits: UnitRow[] = [];
  let bookings: DailyBookingRow[] = [];
  let customers: CustomerRow[] = [];
  let payments: PaymentRow[] = [];
  let cleaningTasks: { id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean }[] = [];

  if (buildingId) {
    const [unitsRes, bookingsRes, customersRes, paymentsRes, cleaningRes] = await Promise.all([
      supabase.from("units").select("*, unit_business_flags!inner(business_type, is_enabled)").eq("building_id", buildingId).eq("unit_business_flags.business_type", "daily_rental").eq("unit_business_flags.is_enabled", true).order("unit_no"),
      supabase.from("daily_bookings").select("*").in("status", ["pending_review", "confirmed", "checked_in", "checked_out"]).order("check_in", { ascending: false }).limit(300),
      supabase.from("customers").select("*").order("name"),
      supabase.from("payments").select("*").eq("source_type", "daily_booking").order("payment_date", { ascending: false }).limit(500),
      supabase.from("cleaning_tasks").select("id, unit_id, daily_booking_id, is_completed"),
    ]);
    if (!unitsRes.error) dailyUnits = sortUnits(((unitsRes.data as unknown as UnitRow[]) ?? []));
    if (!bookingsRes.error) bookings = (bookingsRes.data as DailyBookingRow[]) ?? [];
    if (!customersRes.error) customers = (customersRes.data as CustomerRow[]) ?? [];
    if (!paymentsRes.error) payments = (paymentsRes.data as PaymentRow[]) ?? [];
    if (!cleaningRes.error) cleaningTasks = cleaningRes.data ?? [];
  }

  return (
    <div className="min-h-screen bg-brand-warm-50">
      <div className="px-3 py-3">
        <FrontDeskWorkspace
          dailyUnits={dailyUnits}
          bookings={bookings}
          customers={customers}
          payments={payments}
          cleaningTasks={cleaningTasks}
          locale="zh"
          buildingName={building?.display_name ?? "SASCI11"}
        />
      </div>
    </div>
  );
}
