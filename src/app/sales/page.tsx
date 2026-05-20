import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { dictionaries } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { sortUnits } from "@/lib/utils";
import { SaleList } from "@/features/sales";
import { DesktopOnly } from "@/features/mobile";
import type { SaleContractRow, SalePaymentScheduleRow, UnitRow, CustomerRow, PaymentRow, ReceivableRow } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function SalesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "front_desk", "finance", "boss"].includes(user.role)) redirect("/");

  const t = dictionaries.zh.sales;
  const supabase = await createClient();

  const { data: building } = await supabase.from("buildings").select("id").eq("code", "SASCI11").single();
  const buildingId = building?.id;

  let contracts: SaleContractRow[] = [];
  let schedules: SalePaymentScheduleRow[] = [];
  let units: UnitRow[] = [];
  let customers: CustomerRow[] = [];
  let payments: PaymentRow[] = [];
  let receivables: ReceivableRow[] = [];

  if (buildingId) {
    const [contractsRes, schedulesRes, unitsRes, customersRes, paymentsRes, receivablesRes] = await Promise.all([
      supabase.from("sale_contracts").select("*").order("signed_date", { ascending: false }).limit(200),
      supabase.from("sale_payment_schedule").select("*").order("installment_no").limit(500),
      supabase.from("units").select("*").eq("building_id", buildingId).order("unit_no"),
      supabase.from("customers").select("*").order("name"),
      supabase.from("payments").select("*").eq("source_type", "sale").order("payment_date", { ascending: false }).limit(500),
      supabase.from("receivables").select("*").eq("source_type", "sale_contract").order("due_date").limit(1000),
    ]);
    if (!contractsRes.error) contracts = contractsRes.data;
    if (!schedulesRes.error) schedules = schedulesRes.data;
    if (!unitsRes.error) units = sortUnits(unitsRes.data);
    if (!customersRes.error) customers = customersRes.data;
    if (!paymentsRes.error) payments = paymentsRes.data;
    if (!receivablesRes.error) receivables = receivablesRes.data;
  }

  return (
    <>
      <div className="lg:hidden">
        <DesktopOnly locale="zh" />
      </div>
      <div className="hidden lg:block">
        <PageHeader title={t.title} description={t.description} />
        <p className="text-xs text-brand-ink-400 mt-2 mb-6">出售规则：房源/车位可售 · 一次性/固定分期/灵活分期 · 合同终止后恢复可售</p>
        <section>
          <SaleList contracts={contracts} schedules={schedules} units={units} customers={customers} payments={payments} receivables={receivables} locale="zh" />
        </section>
      </div>
    </>
  );
}
