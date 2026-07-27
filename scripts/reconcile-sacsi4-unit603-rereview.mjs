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
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "603").single(), "load 603");
const leases = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id), "load 603 leases");
if (leases.length !== 0) throw new Error(`Unexpected 603 lease count: ${leases.length}`);

const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).single(), "load 603 sale");
if (Number(sale.total_amount_xof) !== 66_600_000) throw new Error("Unexpected 603 sale total");
const customer = await checked(supabase.from("customers").select("id, name").eq("id", sale.customer_id).single(), "load 603 buyer");
if (customer.name !== "KAORE") throw new Error(`Unexpected 603 buyer: ${customer.name}`);

const payments = await checked(supabase.from("payments").select("source_type, payment_date, amount, receipt_no, notes").eq("source_id", sale.id).order("payment_date"), "load 603 payments");
if (payments.length !== 3) throw new Error(`Unexpected 603 payment count: ${payments.length}`);
const registration = payments.find((payment) => payment.source_type === "sale_registration_fee");
const house = payments.find((payment) => payment.source_type === "sale_contract");
const furniture = payments.find((payment) => payment.source_type === "sale_other_income");
if (!registration || registration.payment_date !== "2021-09-08" || Number(registration.amount) !== 250_000) throw new Error("Unexpected 603 registration payment");
if (!house || house.payment_date !== "2022-06-26" || Number(house.amount) !== 66_600_000) throw new Error("Unexpected 603 house payment");
if (!furniture || furniture.payment_date !== "2022-06-26" || Number(furniture.amount) !== 190_000) throw new Error("Unexpected 603 furniture payment");

const houseRows = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum").eq("amount_xof", 66_600_000), "find 603 house receivable");
if (houseRows.length !== 1) throw new Error(`Expected one 603 house receivable, got ${houseRows.length}`);
await checked(supabase.from("receivables").update({
  building_id: building.id,
  unit_id: unit.id,
  customer_id: sale.customer_id,
  source_type: "sale_contract",
  source_id: sale.id,
  category: "sale_lump_sum",
  title: "4# 603购房款",
  due_date: house.payment_date,
  amount_xof: 66_600_000,
  paid_amount_xof: 66_600_000,
  status: "paid",
  currency: "XOF",
  notes: `${house.notes}\n收据号：${house.receipt_no}`,
}).eq("id", houseRows[0].id), "update 603 house receivable");

for (const spec of [
  { payment: registration, title: "603注册金" },
  { payment: furniture, title: "603衣柜款" },
]) {
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
    notes: `${spec.payment.notes}\n收据号：${spec.payment.receipt_no}`,
  };
  if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update receivable ${spec.payment.receipt_no}`);
  else await checked(supabase.from("receivables").insert(payload), `insert receivable ${spec.payment.receipt_no}`);
}

const receivables = await checked(supabase.from("receivables").select("category, amount_xof, due_date").eq("source_id", sale.id).neq("status", "cancelled").order("due_date"), "verify 603 receivables");
if (receivables.length !== 3 || receivables.reduce((sum, row) => sum + Number(row.amount_xof), 0) !== 67_040_000) throw new Error("Unexpected 603 receivables");

await checked(supabase.from("customers").update({ notes: "来源：4号公寓.xlsx；4号楼603购房人；出生日期：1975-05-23。" }).eq("id", customer.id), "update KAORE notes");
await checked(supabase.from("units").update({ notes: "来源：4号公寓.xlsx；买方KAORE，出生日期1975-05-23；房款6660万于2022-06-26已结清；注册金25万于2021-09-08单列；衣柜款19万单列，Excel未记具体日期，暂以房款日2022-06-26归账；无租赁或代租记录。" }).eq("id", unit.id), "update 603 notes");
await checked(supabase.from("audit_logs").insert({ action: "rereview_unit_data", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI4", unit_no: "603", buyer: "KAORE", buyer_birth_date: "1975-05-23", lease_count: 0, sale_paid_xof: 66_600_000, registration_xof: 250_000, furniture_income_xof: 190_000, furniture_date_inferred: true, receivables_rebuilt_per_payment: true } }), "write audit");

console.log(JSON.stringify({ ok: true, unit: "603", lease_count: 0, sale_paid_xof: 66_600_000, registration_xof: 250_000, furniture_income_xof: 190_000, receivables: receivables.length }));
