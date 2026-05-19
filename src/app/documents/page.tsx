import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { DesktopOnly } from "@/features/mobile";
import { DocumentCenter } from "@/features/documents";
import type { DocumentRecord } from "@/features/documents/types";
import type {
  LeaseContractRow, DailyBookingRow, SaleContractRow,
  ReceivableRow, PaymentRow, UnitRow, CustomerRow,
} from "@/types/database";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance", "front_desk"].includes(user.role)) redirect("/");

  const supabase = await createClient();

  const [
    { data: units },
    { data: customers },
    { data: leaseContracts },
    { data: dailyBookings },
    { data: saleContracts },
    { data: receivables },
    { data: payments },
  ] = await Promise.all([
    supabase.from("units").select("id, unit_no, building_id, kind"),
    supabase.from("customers").select("id, name, phone"),
    supabase.from("lease_contracts").select("*").order("start_date", { ascending: false }).limit(300),
    supabase.from("daily_bookings").select("*").order("created_at", { ascending: false }).limit(300),
    supabase.from("sale_contracts").select("*").order("signed_date", { ascending: false }).limit(200),
    supabase.from("receivables").select("*").order("due_date", { ascending: false }).limit(2000),
    supabase.from("payments").select("*").order("payment_date", { ascending: false }).limit(1000),
  ]);

  const unitMap = new Map((units ?? []).map(u => [u.id, u]));
  const customerMap = new Map((customers ?? []).map(c => [c.id, c]));
  const docs: DocumentRecord[] = [];

  function u(id?: string | null) { return id ? unitMap.get(id) : undefined; }
  function c(id?: string | null) { return id ? customerMap.get(id) : undefined; }

  // ── Lease contracts → lease_contract documents ──
  for (const lc of (leaseContracts ?? []) as LeaseContractRow[]) {
    const unit = u(lc.unit_id);
    const cust = c(lc.customer_id);
    docs.push({
      id: `lease_contract_${lc.id}`,
      docType: "lease_contract",
      source: "lease",
      title: `长租合同 ${lc.contract_no}`,
      date: lc.start_date,
      unitNo: unit?.unit_no ?? "",
      customerName: cust?.name ?? "",
      customerPhone: cust?.phone ?? undefined,
      contractNo: lc.contract_no,
      amountXof: Number(lc.monthly_rent_xof),
      paidAmountXof: 0,
      status: lc.status,
      raw: lc,
    });
  }

  // ── Lease receivables → lease_receipt + lease_reminder documents ──
  for (const r of (receivables ?? []) as ReceivableRow[]) {
    if (r.source_type !== "lease_contract") continue;
    const unit = u(r.unit_id);
    const cust = c(r.customer_id);
    const unpaid = Number(r.amount_xof) - Number(r.paid_amount_xof);
    const idBase = `receivable_${r.id}`;

    if (Number(r.paid_amount_xof) > 0) {
      docs.push({
        id: `${idBase}_receipt`,
        docType: "lease_receipt",
        source: "lease",
        title: `长租收款收据 ${r.title}`,
        date: r.due_date,
        unitNo: unit?.unit_no ?? "",
        customerName: cust?.name ?? "",
        customerPhone: cust?.phone ?? undefined,
        amountXof: Number(r.amount_xof),
        paidAmountXof: Number(r.paid_amount_xof),
        status: r.status,
        raw: { ...r, receipt_no: null },
      });
    }

    if (unpaid > 0 && (r.status === "overdue" || r.due_date < new Date().toISOString().slice(0, 10))) {
      docs.push({
        id: `${idBase}_reminder`,
        docType: "lease_reminder",
        source: "lease",
        title: `催款通知 ${r.title}`,
        date: r.due_date,
        unitNo: unit?.unit_no ?? "",
        customerName: cust?.name ?? "",
        customerPhone: cust?.phone ?? undefined,
        amountXof: Number(r.amount_xof),
        paidAmountXof: Number(r.paid_amount_xof),
        status: "overdue",
        raw: r,
      });
    }
  }

  // ── Lease payments → lease_receipt documents ──
  for (const p of (payments ?? []) as PaymentRow[]) {
    if (p.source_type !== "lease_rent" && p.source_type !== "lease_deposit") continue;
    const unit = u(p.unit_id);
    const cust = c(p.customer_id);
    docs.push({
      id: `payment_${p.id}`,
      docType: "lease_receipt",
      source: "lease",
      title: p.source_type === "lease_deposit" ? "长租押金收据" : "长租收款收据",
      date: p.payment_date,
      unitNo: unit?.unit_no ?? "",
      customerName: cust?.name ?? "",
      customerPhone: cust?.phone ?? undefined,
      amountXof: Number(p.amount),
      paidAmountXof: Number(p.amount),
      status: "paid",
      raw: { ...p, receipt_no: p.receipt_no, contract_no: null },
    });
  }

  // ── Daily bookings → daily_booking documents ──
  for (const db of (dailyBookings ?? []) as DailyBookingRow[]) {
    const unit = u(db.unit_id);
    const cust = c(db.customer_id);
    const nights = db.check_out
      ? Math.ceil((new Date(db.check_out).getTime() - new Date(db.check_in).getTime()) / 86400000)
      : 1;
    docs.push({
      id: `daily_booking_${db.id}`,
      docType: "daily_booking",
      source: "daily",
      title: `日租 ${unit?.unit_no ?? ""} ${db.check_in}`,
      date: db.check_in,
      unitNo: unit?.unit_no ?? "",
      customerName: cust?.name ?? "",
      customerPhone: cust?.phone ?? undefined,
      amountXof: Number(db.total_amount_xof),
      paidAmountXof: Number(db.prepaid_amount_xof),
      status: db.status,
      raw: { ...db, nights },
    });
  }

  // ── Daily receipts (from payments) → daily_receipt documents ──
  for (const p of (payments ?? []) as PaymentRow[]) {
    if (p.source_type !== "daily_booking" && p.source_type !== "daily_rental") continue;
    const unit = u(p.unit_id);
    const cust = c(p.customer_id);
    docs.push({
      id: `daily_payment_${p.id}`,
      docType: "daily_receipt",
      source: "daily",
      title: "日租收款收据",
      date: p.payment_date,
      unitNo: unit?.unit_no ?? "",
      customerName: cust?.name ?? "",
      customerPhone: cust?.phone ?? undefined,
      amountXof: Number(p.amount),
      paidAmountXof: Number(p.amount),
      status: "paid",
      raw: { ...p, receipt_no: p.receipt_no },
    });
  }

  // ── Daily checkout documents ──
  for (const db of (dailyBookings ?? []) as DailyBookingRow[]) {
    if (db.status === "checked_out" || db.actual_check_out) {
      const unit = u(db.unit_id);
      const cust = c(db.customer_id);
      docs.push({
        id: `daily_checkout_${db.id}`,
        docType: "daily_checkout",
        source: "daily",
        title: `日租退房结算 ${unit?.unit_no ?? ""} ${db.actual_check_out ?? ""}`,
        date: db.actual_check_out ?? db.check_out ?? new Date().toISOString().slice(0, 10),
        unitNo: unit?.unit_no ?? "",
        customerName: cust?.name ?? "",
        customerPhone: cust?.phone ?? undefined,
        amountXof: Number(db.final_amount_xof ?? db.total_amount_xof),
        paidAmountXof: Number(db.prepaid_amount_xof),
        status: db.status,
        raw: db,
      });
    }
  }

  // ── Sale contracts → sale_contract documents ──
  for (const sc of (saleContracts ?? []) as SaleContractRow[]) {
    const unit = u(sc.unit_id);
    const cust = c(sc.customer_id);
    docs.push({
      id: `sale_contract_${sc.id}`,
      docType: "sale_contract",
      source: "sale",
      title: `出售合同 ${sc.contract_no}`,
      date: sc.signed_date,
      unitNo: unit?.unit_no ?? "",
      customerName: cust?.name ?? "",
      customerPhone: cust?.phone ?? undefined,
      contractNo: sc.contract_no,
      amountXof: Number(sc.total_amount_xof),
      paidAmountXof: 0,
      status: sc.status,
      raw: sc,
    });
  }

  // ── Sale receipts (from payments) → sale_receipt documents ──
  for (const p of (payments ?? []) as PaymentRow[]) {
    if (p.source_type !== "sale") continue;
    const unit = u(p.unit_id);
    const cust = c(p.customer_id);
    docs.push({
      id: `sale_payment_${p.id}`,
      docType: "sale_receipt",
      source: "sale",
      title: "出售收款收据",
      date: p.payment_date,
      unitNo: unit?.unit_no ?? "",
      customerName: cust?.name ?? "",
      customerPhone: cust?.phone ?? undefined,
      amountXof: Number(p.amount),
      paidAmountXof: Number(p.amount),
      status: "paid",
      raw: { ...p, receipt_no: p.receipt_no, contract_no: null },
    });
  }

  // ── Sale receivables with payments → sale_receipt documents ──
  for (const r of (receivables ?? []) as ReceivableRow[]) {
    if (r.source_type !== "sale_contract") continue;
    if (Number(r.paid_amount_xof) <= 0) continue;
    const unit = u(r.unit_id);
    const cust = c(r.customer_id);
    docs.push({
      id: `sale_receivable_${r.id}`,
      docType: "sale_receipt",
      source: "sale",
      title: `出售收款 ${r.title}`,
      date: r.due_date,
      unitNo: unit?.unit_no ?? "",
      customerName: cust?.name ?? "",
      customerPhone: cust?.phone ?? undefined,
      amountXof: Number(r.amount_xof),
      paidAmountXof: Number(r.paid_amount_xof),
      status: r.status,
      raw: r,
    });
  }

  return (
    <>
      <div className="lg:hidden">
        <DesktopOnly locale="zh" />
      </div>
      <div className="hidden lg:block">
        <PageHeader
          title="单据中心"
          description="从现有业务数据生成可打印的业务凭证：合同摘要、收据、催款通知、退房结算单"
        />
        <section className="mt-8">
          <DocumentCenter documents={docs} locale="zh" />
        </section>
      </div>
    </>
  );
}
