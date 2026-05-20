import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { DesktopOnly } from "@/features/mobile";
import { TodoCenter, computeTodos } from "@/features/todos";
import type { TodoRole } from "@/features/todos/todo-types";
import type {
  DailyBookingRow, LeaseContractRow, SaleContractRow,
  ReceivableRow, UnitRow, CustomerRow,
} from "@/types/database";

export const dynamic = "force-dynamic";

export default async function TodosPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance", "front_desk"].includes(user.role)) redirect("/");

  const supabase = await createClient();
  const role = user.role as TodoRole;

  const [
    { data: units },
    { data: customers },
    { data: dailyBookings },
    { data: leaseContracts },
    { data: saleContracts },
    { data: receivables },
  ] = await Promise.all([
    supabase.from("units").select("id, unit_no, building_id, kind, status"),
    supabase.from("customers").select("id, name, phone"),
    supabase.from("daily_bookings").select("*").order("check_in", { ascending: false }).limit(300),
    supabase.from("lease_contracts").select("*").order("start_date", { ascending: false }).limit(200),
    supabase.from("sale_contracts").select("*").order("signed_date", { ascending: false }).limit(200),
    supabase.from("receivables").select("*").order("due_date", { ascending: false }).limit(1000),
  ]);

  const todos = computeTodos({
    dailyBookings: (dailyBookings ?? []) as DailyBookingRow[],
    leaseContracts: (leaseContracts ?? []) as LeaseContractRow[],
    saleContracts: (saleContracts ?? []) as SaleContractRow[],
    receivables: (receivables ?? []) as ReceivableRow[],
    units: (units ?? []) as UnitRow[],
    customers: (customers ?? []) as CustomerRow[],
    targetRole: role,
  });

  return (
    <>
      <div className="lg:hidden">
        <DesktopOnly locale="zh" />
      </div>
      <div className="hidden lg:block">
        <PageHeader title="通知与待办中心" description="根据当前业务数据实时计算：待入住、待退房、欠费、到期、异常等需要处理的事项" />
        <section className="mt-8">
          <TodoCenter todos={todos} locale="zh" />
        </section>
      </div>
    </>
  );
}
