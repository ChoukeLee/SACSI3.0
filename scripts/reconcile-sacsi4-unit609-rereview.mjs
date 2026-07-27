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
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "609").single(), "load 609");
const leases = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id), "load 609 leases");
if (leases.length !== 0) throw new Error(`Unexpected 609 lease count: ${leases.length}`);
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).single(), "load 609 sale");
if (Number(sale.total_amount_xof) !== 75_000_000) throw new Error("Unexpected 609 sale total");
const buyer = await checked(supabase.from("customers").select("name").eq("id", sale.customer_id).single(), "load 609 buyer");
if (buyer.name !== "葛亮") throw new Error(`Unexpected 609 buyer: ${buyer.name}`);

const expected = [
  ["2021-06-23", 10_000_000],
  ["2021-06-26", 20_000_000],
  ["2021-07-05", 10_000_000],
  ["2021-07-12", 20_000_000],
  ["2021-07-17", 15_000_000],
];
const payments = await checked(supabase.from("payments").select("source_type, payment_date, amount, receipt_no, notes").eq("source_id", sale.id).order("payment_date"), "load 609 payments");
if (payments.length !== expected.length || payments.some((payment) => payment.source_type !== "sale_contract") || payments.reduce((sum, payment) => sum + Number(payment.amount), 0) !== 75_000_000) throw new Error("Unexpected 609 payments");
for (const [date, amount] of expected) {
  if (!payments.some((payment) => payment.payment_date === date && Number(payment.amount) === amount)) throw new Error(`Missing 609 payment ${date}/${amount}`);
}

const combined = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum").eq("amount_xof", 75_000_000), "find combined 609 receivable");
if (combined.length > 1) throw new Error("Duplicate combined 609 receivable");
for (let index = 0; index < payments.length; index += 1) {
  const payment = payments[index];
  const amount = Number(payment.amount);
  const rows = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum").eq("due_date", payment.payment_date).eq("amount_xof", amount), `find receivable ${payment.receipt_no}`);
  if (rows.length > 1) throw new Error(`Duplicate receivable ${payment.receipt_no}`);
  const payload = {
    building_id: building.id,
    unit_id: unit.id,
    customer_id: sale.customer_id,
    source_type: "sale_contract",
    source_id: sale.id,
    category: "sale_lump_sum",
    title: "4# 609购房款",
    due_date: payment.payment_date,
    amount_xof: amount,
    paid_amount_xof: amount,
    status: "paid",
    currency: "XOF",
    notes: `${payment.notes}\n收据号：${payment.receipt_no}`,
  };
  if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update receivable ${payment.receipt_no}`);
  else if (index === 0 && combined.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", combined[0].id), "split combined 609 receivable");
  else await checked(supabase.from("receivables").insert(payload), `insert receivable ${payment.receipt_no}`);
}

const receivables = await checked(supabase.from("receivables").select("amount_xof, due_date").eq("source_id", sale.id).neq("status", "cancelled").order("due_date"), "verify 609 receivables");
if (receivables.length !== 5 || receivables.reduce((sum, row) => sum + Number(row.amount_xof), 0) !== 75_000_000) throw new Error("Unexpected 609 receivables");
await checked(supabase.from("sale_contracts").update({ payment_plan_type: "来源：4号公寓.xlsx；房款7500万分五笔支付，2021-07-17已结清。" }).eq("id", sale.id), "update 609 sale notes");
await checked(supabase.from("units").update({ notes: "来源：4号公寓.xlsx；买方葛亮，房款7500万分五笔支付：2021-06-23付1000万、2021-06-26付2000万、2021-07-05付1000万、2021-07-12付2000万、2021-07-17付1500万，已结清；无租赁或代租记录。" }).eq("id", unit.id), "update 609 notes");
await checked(supabase.from("audit_logs").insert({ action: "rereview_unit_data", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI4", unit_no: "609", buyer: "葛亮", lease_count: 0, sale_paid_xof: 75_000_000, sale_payment_count: 5, receivables_rebuilt_per_payment: true } }), "write audit");

console.log(JSON.stringify({ ok: true, unit: "609", buyer: "葛亮", sale_paid_xof: 75_000_000, sale_payments: payments.length, receivables: receivables.length }));
