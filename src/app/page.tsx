import Link from "next/link";
import { redirect } from "next/navigation";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { moduleCards } from "@/features/seed/initial-data";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { sortUnits } from "@/lib/utils";
import { MobileWorkbench } from "@/features/mobile";
import { TodoDashboardWidget, computeTodos } from "@/features/todos";
import { QualityDashboardWidget, runQualityChecks } from "@/features/data-quality";
import type { TodoRole } from "@/features/todos/todo-types";
import type {
  UnitRow, DailyBookingRow, CustomerRow, PaymentRow,
  LeaseContractRow, SaleContractRow, ReceivableRow,
  SalePaymentScheduleRow,
} from "@/types/database";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  // front_desk → go directly to workspace
  if (user?.role === "front_desk") redirect("/front-desk");
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

  // Todo data
  let leaseContracts: LeaseContractRow[] = [];
  let saleContracts: SaleContractRow[] = [];
  let receivables: ReceivableRow[] = [];
  let allUnits: UnitRow[] = [];
  let allCustomers: CustomerRow[] = [];
  let paymentsAll: PaymentRow[] = [];
  let saleSchedules: SalePaymentScheduleRow[] = [];

  if (buildingId) {
    const [unitsRes, bookingsRes, customersRes, paymentsRes, cleaningRes,
      leaseRes, saleRes, recRes, allUnitsRes, allCustRes, paymentsAllRes, schedRes] = await Promise.all([
      supabase.from("units").select("*, unit_business_flags!inner(business_type, is_enabled)").eq("building_id", buildingId).eq("unit_business_flags.business_type", "daily_rental").eq("unit_business_flags.is_enabled", true).order("unit_no"),
      supabase.from("daily_bookings").select("*").in("status", ["pending_review", "confirmed", "checked_in", "checked_out"]).order("check_in", { ascending: false }).limit(200),
      supabase.from("customers").select("id, name, phone, is_blacklisted").order("name"),
      supabase.from("payments").select("*").eq("source_type", "daily_booking").order("payment_date", { ascending: false }).limit(200),
      supabase.from("cleaning_tasks").select("id, unit_id, daily_booking_id, is_completed"),
      // Todo-related
      supabase.from("lease_contracts").select("*").eq("status", "active").limit(100),
      supabase.from("sale_contracts").select("*").eq("status", "active").limit(100),
      supabase.from("receivables").select("*").order("due_date", { ascending: false }).limit(500),
      supabase.from("units").select("id, unit_no, building_id"),
      supabase.from("customers").select("id, name, phone"),
      supabase.from("payments").select("*").order("payment_date", { ascending: false }).limit(500),
      supabase.from("sale_payment_schedule").select("*").limit(500),
    ]);
    if (!unitsRes.error) dailyUnits = sortUnits(((unitsRes.data as unknown as UnitRow[]) ?? []));
    if (!bookingsRes.error) bookings = (bookingsRes.data as DailyBookingRow[]) ?? [];
    if (!customersRes.error) customers = (customersRes.data as CustomerRow[]) ?? [];
    if (!paymentsRes.error) payments = (paymentsRes.data as PaymentRow[]) ?? [];
    if (!cleaningRes.error) cleaningTasks = cleaningRes.data ?? [];
    if (!leaseRes.error) leaseContracts = leaseRes.data ?? [];
    if (!saleRes.error) saleContracts = saleRes.data ?? [];
    if (!recRes.error) receivables = recRes.data ?? [];
    if (!allUnitsRes.error) allUnits = sortUnits((allUnitsRes.data as unknown as UnitRow[]) ?? []);
    if (!allCustRes.error) allCustomers = (allCustRes.data as unknown as CustomerRow[]) ?? [];
    if (!paymentsAllRes.error) paymentsAll = (paymentsAllRes.data as unknown as PaymentRow[]) ?? [];
    if (!schedRes.error) saleSchedules = (schedRes.data as unknown as SalePaymentScheduleRow[]) ?? [];
  }

  // Compute todos for the current user
  const role = (user?.role ?? "front_desk") as TodoRole;
  const dashboardTodos = computeTodos({
    dailyBookings: bookings,
    leaseContracts,
    saleContracts,
    receivables,
    units: allUnits,
    customers: allCustomers,
    targetRole: role,
  });

  // Compute quality issues
  const qualityIssues = runQualityChecks({
    units: allUnits as unknown as UnitRow[],
    customers: allCustomers as unknown as CustomerRow[],
    dailyBookings: bookings,
    leaseContracts,
    saleContracts,
    saleSchedules,
    receivables,
    payments: paymentsAll,
  }, role);

  return (
    <>
      <div className="lg:hidden">
        <MobileWorkbench dailyUnits={dailyUnits} bookings={bookings} customers={customers} payments={payments} cleaningTasks={cleaningTasks} notifications={notifications} locale="zh" />
      </div>
      <div className="hidden lg:block">
        <PageHeader title="11#公寓运营仪表盘" description="首期只启用 11#公寓，但所有数据结构保留多楼栋扩展字段。" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="主楼房源" value="72户" caption="1-12F，每层 101-106" />
          <MetricCard title="日租房源" value="21间" caption="固定房间，统一 40,000 XOF/晚" accent="green" />
          <MetricCard title="业务类型" value="3类" caption="日租、长租、出售" accent="ink" />
          <MetricCard title="扩展楼栋" value="5栋预留" caption="3#/4#/5#/6#/7# 后续导入" />
        </div>
        <section className="mt-8 grid gap-4 lg:grid-cols-2">
          {moduleCards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="rounded-xl border border-brand-warm-400 bg-white p-5 shadow-natural transition hover:-translate-y-0.5 hover:border-brand-orange-400"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-brand-ink-900">{card.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-brand-ink-500">{card.description}</p>
                </div>
                <span className="rounded-lg bg-brand-orange-50 px-2.5 py-1 text-xs font-semibold text-brand-orange-700">
                  {card.metric}
                </span>
              </div>
            </Link>
          ))}
        </section>

        {/* Today's todos */}
        <section className="mt-8">
          <TodoDashboardWidget todos={dashboardTodos} locale="zh" />
        </section>

        {/* Data quality widget */}
        {qualityIssues.length > 0 && (
          <section className="mt-8">
            <QualityDashboardWidget issues={qualityIssues} locale="zh" variant="dashboard" />
          </section>
        )}
      </div>
    </>
  );
}
