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
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "512").single(), "load 512");
const lease = await checked(supabase.from("lease_contracts").select("id, contract_no, customer_id").eq("unit_id", unit.id).single(), "load 512 lease");
if (lease.contract_no !== "WB-LEASE-SACSI4-512-20230310") throw new Error(`Unexpected 512 lease: ${lease.contract_no}`);
await checked(supabase.from("lease_contracts").update({ status: "active", actual_end_date: null, expected_end_date: "2026-09-09", expected_end_confirmed: true, paid_through_date: "2026-09-09" }).eq("id", lease.id), "confirm 512 lease");

function categoryFor(sourceType) {
  if (sourceType === "lease_rent") return "lease_rent";
  if (sourceType === "lease_deposit") return "lease_deposit";
  return "other";
}
function titleFor(sourceType) {
  if (sourceType === "lease_rent") return "512\u79df\u91d1";
  if (sourceType === "lease_deposit") return "512\u62bc\u91d1";
  return "512\u7269\u4e1a\u8d39";
}

const payments = await checked(supabase.from("payments").select("source_type, payment_date, amount, receipt_no, notes").eq("source_id", lease.id).in("source_type", ["lease_rent", "lease_deposit", "property_fee"]).order("payment_date"), "load 512 income payments");
if (payments.length !== 15 || payments.reduce((sum, payment) => sum + Number(payment.amount), 0) !== 28_080_000) throw new Error("Unexpected 512 income payments");
for (const payment of payments) {
  const category = categoryFor(payment.source_type);
  const rows = await checked(supabase.from("receivables").select("id").eq("source_id", lease.id).eq("category", category).eq("due_date", payment.payment_date).eq("amount_xof", Number(payment.amount)), `find receivable ${payment.receipt_no}`);
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
    amount_xof: Number(payment.amount),
    paid_amount_xof: Number(payment.amount),
    status: "paid",
    currency: "XOF",
    notes: `${payment.notes}\n\u6536\u636e\u53f7\uff1a${payment.receipt_no}`,
  };
  if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update receivable ${payment.receipt_no}`);
  else await checked(supabase.from("receivables").insert(payload), `insert receivable ${payment.receipt_no}`);
}
const leaseReceivables = await checked(supabase.from("receivables").select("id").eq("source_id", lease.id).neq("status", "cancelled"), "verify 512 lease receivables");
if (leaseReceivables.length !== payments.length) throw new Error(`512: ${payments.length} income payments but ${leaseReceivables.length} receivables`);

const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).single(), "load 512 sale");
if (Number(sale.total_amount_xof) !== 80_000_000) throw new Error("Unexpected 512 sale total");
const housePayments = await checked(supabase.from("payments").select("payment_date, amount, receipt_no, notes").eq("source_id", sale.id).eq("source_type", "sale_contract").order("amount", { ascending: false }), "load 512 house payments");
if (housePayments.length !== 2 || housePayments.reduce((sum, payment) => sum + Number(payment.amount), 0) !== 80_000_000 || !housePayments.some((payment) => Number(payment.amount) === 63_000_000) || !housePayments.some((payment) => Number(payment.amount) === 17_000_000)) throw new Error("Unexpected 512 house payments");

const combined = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum").eq("amount_xof", 80_000_000), "find combined 512 house receivable");
if (combined.length > 1) throw new Error("Duplicate combined 512 house receivable");
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
    title: "4# 512\u8d2d\u623f\u6b3e",
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
const saleReceivables = await checked(supabase.from("receivables").select("amount_xof").eq("source_id", sale.id).neq("status", "cancelled"), "verify 512 sale receivables");
if (saleReceivables.length !== 2 || saleReceivables.reduce((sum, row) => sum + Number(row.amount_xof), 0) !== 80_000_000) throw new Error("Unexpected 512 sale receivables");

await checked(supabase.from("units").update({ notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u623f\u6b3e8000\u4e07\u4e8e2026-06-13\u5206\u4e3a6300\u4e07\u548c1700\u4e07\u4e24\u7b14\u5df2\u7ed3\u6e05\uff0c\u4e70\u65b9\u59d3\u540dExcel\u672a\u8bb0\u8f7d\uff0c\u5f85\u8865\uff1b\u5b8b\u6631\u9716\u5f53\u524d\u5728\u79df\u5e76\u5df2\u7f34\u81f32026-09-09\uff0c\u4e0d\u5c06\u79df\u5ba2\u63a8\u65ad\u4e3a\u4e70\u65b9\u3002" }).eq("id", unit.id), "update 512 notes");
await checked(supabase.from("audit_logs").insert({ action: "rereview_unit_data", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI4", unit_no: "512", active_tenant: "Song Yulin", paid_through: "2026-09-09", lease_income_payment_count: 15, sale_paid_xof: 80_000_000, sale_payment_count: 2, buyer_name_missing: true, receivables_rebuilt_per_payment: true } }), "write audit");

console.log(JSON.stringify({ ok: true, unit: "512", active_tenant: "\u5b8b\u6631\u9716", paid_through: "2026-09-09", lease_receivables: 15, sale_receivables: 2, buyer_name_missing: true }));
