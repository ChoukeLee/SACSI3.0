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
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "502").single(), "load 502");
const lease = await checked(supabase.from("lease_contracts").select("id, contract_no, customer_id").eq("unit_id", unit.id).single(), "load 502 lease");
if (lease.contract_no !== "WB-LEASE-SACSI4-502-20220601") throw new Error(`Unexpected 502 lease: ${lease.contract_no}`);

await checked(supabase.from("lease_contracts").update({
  status: "active",
  actual_end_date: null,
  expected_end_date: "2026-08-30",
  expected_end_confirmed: true,
  paid_through_date: "2026-08-30",
}).eq("id", lease.id), "confirm 502 lease");

function categoryFor(sourceType) {
  return sourceType === "lease_rent" ? "lease_rent" : "other";
}
function titleFor(sourceType) {
  return sourceType === "lease_rent" ? "502\u79df\u91d1" : "502\u7269\u4e1a\u8d39";
}

const incomeTypes = ["lease_rent", "property_fee"];
const payments = await checked(supabase.from("payments").select("id, source_type, payment_date, amount, currency, exchange_rate_to_xof, receipt_no, notes").eq("source_id", lease.id).in("source_type", incomeTypes).order("payment_date"), "load 502 payments");
if (payments.length !== 24) throw new Error(`Unexpected 502 income payment count: ${payments.length}`);
if (payments.reduce((sum, payment) => sum + Number(payment.amount), 0) !== 21_260_000) throw new Error("Unexpected 502 income payment total");

for (const payment of payments) {
  const amountXof = payment.currency === "XOF" ? Number(payment.amount) : Math.round(Number(payment.amount) * Number(payment.exchange_rate_to_xof));
  const category = categoryFor(payment.source_type);
  const rows = await checked(supabase.from("receivables").select("id").eq("source_id", lease.id).eq("category", category).eq("due_date", payment.payment_date).eq("amount_xof", amountXof), `find receivable ${payment.receipt_no}`);
  if (rows.length > 1) throw new Error(`Duplicate receivable ${payment.receipt_no}`);
  const payload = {
    building_id: building.id,
    unit_id: unit.id,
    customer_id: lease.customer_id,
    source_type: "lease_contract",
    source_id: lease.id,
    category,
    title: titleFor(payment.source_type),
    due_date: payment.payment_date,
    amount_xof: amountXof,
    paid_amount_xof: amountXof,
    status: "paid",
    currency: "XOF",
    notes: `${payment.notes}\n\u6536\u636e\u53f7\uff1a${payment.receipt_no}`,
  };
  if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update receivable ${payment.receipt_no}`);
  else await checked(supabase.from("receivables").insert(payload), `insert receivable ${payment.receipt_no}`);
}

const sale = await checked(supabase.from("sale_contracts").select("id, total_amount_xof").eq("unit_id", unit.id).single(), "load 502 sale");
const salePayments = await checked(supabase.from("payments").select("amount").eq("source_id", sale.id).eq("source_type", "sale_contract"), "load 502 sale payments");
if (Number(sale.total_amount_xof) !== 80_000_000 || salePayments.reduce((sum, payment) => sum + Number(payment.amount), 0) !== 80_000_000) throw new Error("Unexpected 502 sale total");

const receivables = await checked(supabase.from("receivables").select("id").eq("source_id", lease.id).neq("status", "cancelled"), "verify 502 receivables");
if (receivables.length !== payments.length) throw new Error(`502: ${payments.length} income payments but ${receivables.length} receivables`);

await checked(supabase.from("units").update({ notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u4e70\u65b9\u674e\u4e50\u5168\uff0c\u623f\u6b3e8000\u4e07\u4e8e2026-06-20\u5df2\u7ed3\u6e05\uff1bKAILASH\u5f53\u524d\u4ecd\u5728\u79df\uff0c\u5df2\u7f34\u81f32026-08-30\u3002" }).eq("id", unit.id), "update 502 notes");
await checked(supabase.from("audit_logs").insert({ action: "rereview_unit_data", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI4", unit_no: "502", lease_active: true, paid_through: "2026-08-30", lease_income_xof: 21_260_000, sale_paid_xof: 80_000_000, receivables_rebuilt_per_payment: true } }), "write audit");

console.log(JSON.stringify({ ok: true, unit: "502", active_tenant: "KAILASH", paid_through: "2026-08-30", income_payments: payments.length, receivables: receivables.length, sale_paid_xof: 80_000_000 }));
