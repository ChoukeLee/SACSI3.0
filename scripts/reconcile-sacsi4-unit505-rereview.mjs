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
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "505").single(), "load 505");
const leases = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id), "load 505 leases");
if (leases.length !== 0) throw new Error(`Unexpected 505 lease count: ${leases.length}`);

const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).single(), "load 505 sale");
if (Number(sale.total_amount_xof) !== 66_600_000) throw new Error("Unexpected 505 sale total");
const payments = await checked(supabase.from("payments").select("source_type, payment_date, amount, receipt_no, notes").eq("source_id", sale.id).order("payment_date"), "load 505 payments");
const housePayment = payments.find((payment) => payment.source_type === "sale_contract");
const furniturePayment = payments.find((payment) => payment.source_type === "sale_other_income");
if (!housePayment || Number(housePayment.amount) !== 66_600_000) throw new Error("Unexpected 505 house payment");
if (!furniturePayment || Number(furniturePayment.amount) !== 190_000) throw new Error("Unexpected 505 furniture payment");

const rows = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "other").eq("due_date", furniturePayment.payment_date).eq("amount_xof", 190_000), "find furniture receivable");
if (rows.length > 1) throw new Error("Duplicate 505 furniture receivable");
const payload = {
  building_id: building.id,
  unit_id: unit.id,
  customer_id: sale.customer_id,
  source_type: "sale_contract",
  source_id: sale.id,
  category: "other",
  title: "505\u8863\u67dc\u6b3e",
  due_date: furniturePayment.payment_date,
  amount_xof: 190_000,
  paid_amount_xof: 190_000,
  status: "paid",
  currency: "XOF",
  notes: `${furniturePayment.notes}\n\u6536\u636e\u53f7\uff1a${furniturePayment.receipt_no}`,
};
if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), "update furniture receivable");
else await checked(supabase.from("receivables").insert(payload), "insert furniture receivable");

const receivables = await checked(supabase.from("receivables").select("category, amount_xof").eq("source_id", sale.id).neq("status", "cancelled"), "verify 505 receivables");
if (receivables.length !== 2 || receivables.reduce((sum, row) => sum + Number(row.amount_xof), 0) !== 66_790_000) throw new Error("Unexpected 505 receivables");

await checked(supabase.from("units").update({ notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u4e70\u65b9DLAKITE\uff0c\u623f\u6b3e6660\u4e07\u4e8e2022-02-09\u5df2\u7ed3\u6e05\uff1b\u8863\u67dc\u6b3e19\u4e07\u5355\u5217\u5e76\u5df2\u7ed3\u6e05\uff0cExcel\u672a\u8bb0\u5177\u4f53\u65e5\u671f\uff0c\u6682\u4ee5\u623f\u6b3e\u65e5\u5f52\u8d26\uff1b\u65e0\u79df\u8d41\u6216\u4ee3\u79df\u8bb0\u5f55\u3002" }).eq("id", unit.id), "update 505 notes");
await checked(supabase.from("audit_logs").insert({ action: "rereview_unit_data", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI4", unit_no: "505", lease_count: 0, sale_paid_xof: 66_600_000, furniture_income_xof: 190_000, furniture_date_inferred: true } }), "write audit");

console.log(JSON.stringify({ ok: true, unit: "505", lease_count: 0, sale_paid_xof: 66_600_000, furniture_income_xof: 190_000, receivables: 2 }));
