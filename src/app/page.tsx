import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { moduleCards } from "@/features/seed/initial-data";
import { createClient } from "@/lib/supabase/server";
import { MobileWorkbench } from "@/features/mobile";
import type { UnitRow, DailyBookingRow, CustomerRow, PaymentRow } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [notifRes, buildingRes] = await Promise.all([
    supabase.from("notifications").select("id, title, body, read_at, created_at, due_at").order("created_at", { ascending: false }).limit(30),
    supabase.from("buildings").select("id").eq("code", "SASCI11").single(),
  ]);

  const buildingId = buildingRes.data?.id;
  const notifications = (notifRes.data ?? []) as { id: string; title: string; body: string; read_at: string | null; created_at: string; due_at: string | null }[];

  let dailyUnits: UnitRow[] = [];
  let bookings: DailyBookingRow[] = [];
  let customers: CustomerRow[] = [];
  let payments: PaymentRow[] = [];
  let cleaningTasks: { id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean }[] = [];

  if (buildingId) {
    const [unitsRes, bookingsRes, customersRes, paymentsRes, cleaningRes] = await Promise.all([
      supabase.from("units").select("*, unit_business_flags!inner(business_type, is_enabled)").eq("building_id", buildingId).eq("unit_business_flags.business_type", "daily_rental").eq("unit_business_flags.is_enabled", true).order("unit_no"),
      supabase.from("daily_bookings").select("*").in("status", ["confirmed", "checked_in", "checked_out"]).order("check_in", { ascending: false }).limit(200),
      supabase.from("customers").select("id, name, phone, is_blacklisted").order("name"),
      supabase.from("payments").select("*").eq("source_type", "daily_booking").order("payment_date", { ascending: false }).limit(200),
      supabase.from("cleaning_tasks").select("id, unit_id, daily_booking_id, is_completed"),
    ]);
    if (!unitsRes.error) dailyUnits = ((unitsRes.data as unknown as UnitRow[]) ?? []).sort((a, b) => {
      const af = parseInt(a.floor_label); const bf = parseInt(b.floor_label);
      return af !== bf ? af - bf : parseInt(a.unit_no) - parseInt(b.unit_no);
    });
    if (!bookingsRes.error) bookings = (bookingsRes.data as DailyBookingRow[]) ?? [];
    if (!customersRes.error) customers = (customersRes.data as CustomerRow[]) ?? [];
    if (!paymentsRes.error) payments = (paymentsRes.data as PaymentRow[]) ?? [];
    if (!cleaningRes.error) cleaningTasks = cleaningRes.data ?? [];
  }

  return (
    <AppShell notifications={notifications}>
      {/* UX-REFACTOR: Mobile workbench — lightweight field ops view */}
      <div className="lg:hidden">
        <MobileWorkbench dailyUnits={dailyUnits} bookings={bookings} customers={customers} payments={payments} cleaningTasks={cleaningTasks} notifications={notifications} locale="zh" />
      </div>

      {/* Desktop dashboard — full admin view */}
      <div className="hidden lg:block">
        <PageHeader title="11#公寓运营仪表盘" description="首期只启用 11#公寓，但所有数据结构保留多楼栋扩展字段。这里先承载日租、长租、出售三条业务线的总览入口。" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="主楼房源" value="72户" caption="1-12F，每层 101-106" />
          <MetricCard title="日租房源" value="21间" caption="固定房间，统一 40,000 XOF/晚" accent="green" />
          <MetricCard title="业务类型" value="3类" caption="日租、长租、出售" accent="ink" />
          <MetricCard title="扩展楼栋" value="5栋预留" caption="3#/4#/5#/6#/7# 后续导入" />
        </div>
        <section className="mt-8 grid gap-4 lg:grid-cols-2">
          {moduleCards.map((card) => (
            <Link key={card.href} href={card.href} className="rounded-md border border-black/10 bg-white p-5 shadow-soft transition hover:-translate-y-0.5 hover:border-brand-orange">
              <div className="flex items-start justify-between gap-4">
                <div><h3 className="text-lg font-bold text-brand-ink">{card.title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{card.description}</p></div>
                <span className="rounded bg-orange-50 px-2.5 py-1 text-xs font-semibold text-brand-orange">{card.metric}</span>
              </div>
            </Link>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
