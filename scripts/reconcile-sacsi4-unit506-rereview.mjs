import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
  const i = line.indexOf("=");
  return [line.slice(0, i), line.slice(i + 1)];
}));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI4").single(), "load building");
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "506").single(), "load 506");
const leases = await checked(supabase.from("lease_contracts").select("id, contract_no, customer_id").eq("unit_id", unit.id).order("start_date"), "load 506 leases");
if (leases.length !== 2) throw new Error(`Unexpected 506 lease count: ${leases.length}`);
const oumou = leases.find((lease) => lease.contract_no === "WB-LEASE-SACSI4-506-20231201-OUMOU");
const jiang = leases.find((lease) => lease.contract_no === "WB-LEASE-SACSI4-506-20250210");
if (!oumou || !jiang) throw new Error("Unexpected 506 lease contracts");

await checked(supabase.from("lease_contracts").update({
  status: "terminated",
  actual_end_date: "2025-02-05",
  expected_end_confirmed: true,
}).eq("id", oumou.id), "confirm OUMOU lease");
await checked(supabase.from("lease_contracts").update({
  status: "active",
  actual_end_date: null,
  expected_end_date: "2026-08-09",
  expected_end_confirmed: true,
  paid_through_date: "2026-08-09",
}).eq("id", jiang.id), "confirm Jiang lease");

function categoryFor(sourceType) {
  return sourceType === "lease_rent" ? "lease_rent" : "lease_deposit";
}
function titleFor(sourceType) {
  return sourceType === "lease_rent" ? "506\u79df\u91d1" : "506\u62bc\u91d1";
}
function keyFor(payment) {
  return `${categoryFor(payment.source_type)}|${payment.payment_date}|${Number(payment.amount)}`;
}

const leaseExpectations = new Map([
  [oumou.id, { count: 7, total_xof: 9_858_333 }],
  [jiang.id, { count: 4, total_xof: 13_000_000 }],
]);
for (const lease of leases) {
  const payments = await checked(supabase.from("payments").select("source_type, payment_date, amount, receipt_no, notes").eq("source_id", lease.id).in("source_type", ["lease_rent", "lease_deposit"]).order("payment_date"), `load payments ${lease.contract_no}`);
  const expected = leaseExpectations.get(lease.id);
  if (payments.length !== expected.count || payments.reduce((sum, payment) => sum + Number(payment.amount), 0) !== expected.total_xof) throw new Error(`${lease.contract_no}: unexpected income payments`);

  const groups = new Map();
  for (const payment of payments) {
    const key = keyFor(payment);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(payment);
  }
  for (const group of groups.values()) {
    const sample = group[0];
    const category = categoryFor(sample.source_type);
    const rows = await checked(supabase.from("receivables").select("id").eq("source_id", lease.id).eq("category", category).eq("due_date", sample.payment_date).eq("amount_xof", Number(sample.amount)).order("created_at"), `find receivable group ${sample.receipt_no}`);
    if (rows.length > group.length) throw new Error(`Too many receivables for ${sample.receipt_no}`);
    for (let index = 0; index < group.length; index += 1) {
      const payment = group[index];
      const payload = {
        building_id: building.id,
        unit_id: unit.id,
        customer_id: lease.customer_id,
        source_type: "lease_contract",
        source_id: lease.id,
        category,
        title: titleFor(payment.source_type),
        due_date: payment.payment_date,
        amount_xof: Number(payment.amount),
        paid_amount_xof: Number(payment.amount),
        status: "paid",
        currency: "XOF",
        notes: `${payment.notes}\n\u6536\u636e\u53f7\uff1a${payment.receipt_no}`,
      };
      if (index < rows.length) await checked(supabase.from("receivables").update(payload).eq("id", rows[index].id), `update receivable ${payment.receipt_no}`);
      else await checked(supabase.from("receivables").insert(payload), `insert receivable ${payment.receipt_no}`);
    }
  }
  const receivables = await checked(supabase.from("receivables").select("id").eq("source_id", lease.id).neq("status", "cancelled"), `verify receivables ${lease.contract_no}`);
  if (receivables.length !== payments.length) throw new Error(`${lease.contract_no}: ${payments.length} income payments but ${receivables.length} receivables`);
}

const refund = await checked(supabase.from("payments").select("amount").eq("source_id", oumou.id).eq("source_type", "lease_deposit_refund").single(), "load OUMOU refund");
if (Number(refund.amount) !== 595_833) throw new Error("Unexpected OUMOU refund allocation");

const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof, agency_commission_amount_xof, agency_commission_paid").eq("unit_id", unit.id).single(), "load 506 sale");
if (Number(sale.total_amount_xof) !== 93_100_000 || Number(sale.agency_commission_amount_xof) !== 4_515_000 || !sale.agency_commission_paid) throw new Error("Unexpected 506 sale header");
const salePayments = await checked(supabase.from("payments").select("source_type, payment_date, amount, receipt_no, notes").eq("source_id", sale.id).order("payment_date"), "load 506 sale payments");
const housePayments = salePayments.filter((payment) => payment.source_type === "sale_contract");
const agencyExpense = salePayments.find((payment) => payment.source_type === "sale_agency_expense");
const taxPayment = salePayments.find((payment) => payment.source_type === "sale_other_income");
if (housePayments.length !== 3 || housePayments.reduce((sum, payment) => sum + Number(payment.amount), 0) !== 93_100_000) throw new Error("Unexpected 506 house payments");
if (!agencyExpense || Number(agencyExpense.amount) !== 4_515_000) throw new Error("Unexpected 506 agency expense");
if (!taxPayment || Number(taxPayment.amount) !== 2_250_000) throw new Error("Unexpected 506 tax allocation");

const combined = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum").eq("amount_xof", 93_100_000), "find combined house receivable");
if (combined.length > 1) throw new Error("Duplicate combined 506 house receivable");
for (let index = 0; index < housePayments.length; index += 1) {
  const payment = housePayments[index];
  const rows = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum").eq("due_date", payment.payment_date).eq("amount_xof", Number(payment.amount)), `find house receivable ${payment.receipt_no}`);
  if (rows.length > 1) throw new Error(`Duplicate house receivable ${payment.receipt_no}`);
  const payload = {
    building_id: building.id,
    unit_id: unit.id,
    customer_id: sale.customer_id,
    source_type: "sale_contract",
    source_id: sale.id,
    category: "sale_lump_sum",
    title: "4# 506\u8d2d\u623f\u6b3e",
    due_date: payment.payment_date,
    amount_xof: Number(payment.amount),
    paid_amount_xof: Number(payment.amount),
    status: "paid",
    currency: "XOF",
    notes: `${payment.notes}\n\u6536\u636e\u53f7\uff1a${payment.receipt_no}`,
  };
  if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update house receivable ${payment.receipt_no}`);
  else if (index === 0 && combined.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", combined[0].id), "split combined house receivable");
  else await checked(supabase.from("receivables").insert(payload), `insert house receivable ${payment.receipt_no}`);
}

const taxRows = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "other").eq("due_date", taxPayment.payment_date).eq("amount_xof", 2_250_000), "find tax receivable");
if (taxRows.length > 1) throw new Error("Duplicate 506 tax receivable");
const taxPayload = {
  building_id: building.id,
  unit_id: unit.id,
  customer_id: sale.customer_id,
  source_type: "sale_contract",
  source_id: sale.id,
  category: "other",
  title: "506\u8fc7\u6237\u7a0e\u4ee3\u6536",
  due_date: taxPayment.payment_date,
  amount_xof: 2_250_000,
  paid_amount_xof: 2_250_000,
  status: "paid",
  currency: "XOF",
  notes: `${taxPayment.notes}\n\u6536\u636e\u53f7\uff1a${taxPayment.receipt_no}`,
};
if (taxRows.length === 1) await checked(supabase.from("receivables").update(taxPayload).eq("id", taxRows[0].id), "update tax receivable");
else await checked(supabase.from("receivables").insert(taxPayload), "insert tax receivable");
const saleReceivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).neq("status", "cancelled"), "verify sale receivables");
if (saleReceivables.length !== 4) throw new Error(`Unexpected 506 sale receivable count: ${saleReceivables.length}`);

await checked(supabase.from("units").update({ notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u539f208\u623f\u6362506\u623f\uff0c\u4e70\u65b9BAMAB\uff0c\u623f\u6b3e9310\u4e07\u5206\u4e3a3\u7b14\u5df2\u7ed3\u6e05\uff0c\u516c\u53f8\u652f\u4ed8\u51fa\u552e\u4e2d\u4ecb\u8d39451.5\u4e07\uff1b201/308/506\u5408\u4ed8\u7a0e\u6b3e675\u4e07\u5e73\u5747\u5206\u914d\uff0c506\u4ee3\u6536225\u4e07\uff1b\u516c\u53f8\u4ee3\u79df\uff0c\u848b\u53cb\u5e73\u5f53\u524d\u5728\u79df\u5e76\u5df2\u7f34\u81f32026-08-09\uff1bOUMOU\u62bc\u91d1260\u4e07\u4e2d\u5df2\u900059.5833\u4e07\uff0c\u4f59\u989d200.4167\u4e07Excel\u672a\u8bb0\u5904\u7f6e\uff0c\u5f85\u6838\u5b9e\u3002" }).eq("id", unit.id), "update 506 notes");
await checked(supabase.from("audit_logs").insert({ action: "rereview_unit_data", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI4", unit_no: "506", active_tenant: "Jiang Youping", paid_through: "2026-08-09", sale_paid_xof: 93_100_000, agency_expense_xof: 4_515_000, transfer_tax_allocated_xof: 2_250_000, oumou_deposit_received_xof: 2_600_000, oumou_deposit_refund_xof: 595_833, oumou_deposit_unresolved_xof: 2_004_167, receivables_rebuilt_per_payment: true } }), "write audit");

console.log(JSON.stringify({ ok: true, unit: "506", active_tenant: "\u848b\u53cb\u5e73", paid_through: "2026-08-09", sale_receivables: 4, oumou_deposit_unresolved_xof: 2_004_167 }));
