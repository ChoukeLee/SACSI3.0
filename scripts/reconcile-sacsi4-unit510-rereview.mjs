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
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "510").single(), "load 510");
const leases = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id), "load 510 leases");
if (leases.length !== 0) throw new Error(`Unexpected 510 lease count: ${leases.length}`);

const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).single(), "load 510 sale");
if (Number(sale.total_amount_xof) !== 95_000_000) throw new Error("Unexpected 510 sale total");
const payments = await checked(supabase.from("payments").select("source_type, payment_date, amount, receipt_no, notes").eq("source_id", sale.id).order("payment_date"), "load 510 payments");
const house = payments.find((payment) => payment.source_type === "sale_contract");
const registration = payments.find((payment) => payment.source_type === "sale_registration_fee");
const transferTax = payments.find((payment) => payment.source_type === "sale_other_income");
if (!house || Number(house.amount) !== 95_000_000) throw new Error("Unexpected 510 house payment");
if (!registration || Number(registration.amount) !== 250_000) throw new Error("Unexpected 510 registration payment");
if (!transferTax || Number(transferTax.amount) !== 2_850_000) throw new Error("Unexpected 510 transfer tax payment");

for (const spec of [{ payment: registration, title: "510\u6ce8\u518c\u91d1" }, { payment: transferTax, title: "510\u8fc7\u6237\u7a0e\u4ee3\u6536" }]) {
  const rows = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "other").eq("due_date", spec.payment.payment_date).eq("amount_xof", Number(spec.payment.amount)), `find receivable ${spec.payment.receipt_no}`);
  if (rows.length > 1) throw new Error(`Duplicate receivable ${spec.payment.receipt_no}`);
  const payload = {
    building_id: building.id,
    unit_id: unit.id,
    customer_id: sale.customer_id,
    source_type: "sale_contract",
    source_id: sale.id,
    category: "other",
    title: spec.title,
    due_date: spec.payment.payment_date,
    amount_xof: Number(spec.payment.amount),
    paid_amount_xof: Number(spec.payment.amount),
    status: "paid",
    currency: "XOF",
    notes: `${spec.payment.notes}\n\u6536\u636e\u53f7\uff1a${spec.payment.receipt_no}`,
  };
  if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update receivable ${spec.payment.receipt_no}`);
  else await checked(supabase.from("receivables").insert(payload), `insert receivable ${spec.payment.receipt_no}`);
}

const receivables = await checked(supabase.from("receivables").select("amount_xof").eq("source_id", sale.id).neq("status", "cancelled"), "verify 510 receivables");
if (receivables.length !== 3 || receivables.reduce((sum, row) => sum + Number(row.amount_xof), 0) !== 98_100_000) throw new Error("Unexpected 510 receivables");

await checked(supabase.from("units").update({ notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u4e70\u65b9ESPECE\uff0c\u623f\u6b3e9500\u4e07\u4e8e2021-12-30\u5df2\u7ed3\u6e05\uff0cExcel\u6ce8\u8bb0\u672a\u505a\u51fa\u5165\u8d260001118\uff1b\u6ce8\u518c\u91d125\u4e07\u5355\u5217\uff1b\u8fc7\u6237\u7a0e\u4ee3\u6536285\u4e07\u63092021-12-31\u6536\u6b3e\u767b\u8bb0\uff0c2022-01-05\u5165\u8d26\uff1b\u65e0\u79df\u8d41\u6216\u4ee3\u79df\u8bb0\u5f55\u3002" }).eq("id", unit.id), "update 510 notes");
await checked(supabase.from("audit_logs").insert({ action: "rereview_unit_data", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI4", unit_no: "510", lease_count: 0, sale_paid_xof: 95_000_000, registration_xof: 250_000, transfer_tax_xof: 2_850_000, external_entry_reference: "0001118", transfer_tax_posted_date: "2022-01-05" } }), "write audit");

console.log(JSON.stringify({ ok: true, unit: "510", lease_count: 0, sale_paid_xof: 95_000_000, registration_xof: 250_000, transfer_tax_xof: 2_850_000, receivables: 3 }));
