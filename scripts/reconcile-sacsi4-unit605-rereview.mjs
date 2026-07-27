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
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "605").single(), "load 605");
const leases = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id), "load 605 leases");
if (leases.length !== 0) throw new Error(`Unexpected 605 lease count: ${leases.length}`);

const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).single(), "load 605 sale");
if (Number(sale.total_amount_xof) !== 66_600_000) throw new Error("Unexpected 605 sale total");
const customer = await checked(supabase.from("customers").select("id, name").eq("id", sale.customer_id).single(), "load 605 buyer");
if (customer.name !== "COMOE") throw new Error(`Unexpected 605 buyer: ${customer.name}`);

const payments = await checked(supabase.from("payments").select("source_type, payment_date, amount, receipt_no, notes").eq("source_id", sale.id).order("payment_date"), "load 605 payments");
if (payments.length !== 2) throw new Error(`Unexpected 605 payment count: ${payments.length}`);
const registration = payments.find((payment) => payment.source_type === "sale_registration_fee");
const house = payments.find((payment) => payment.source_type === "sale_contract");
if (!registration || registration.payment_date !== "2020-12-09" || Number(registration.amount) !== 250_000) throw new Error("Unexpected 605 registration payment");
if (!house || house.payment_date !== "2022-07-18" || Number(house.amount) !== 66_600_000) throw new Error("Unexpected 605 house payment");

const houseRows = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum").eq("amount_xof", 66_600_000), "find 605 house receivable");
if (houseRows.length !== 1) throw new Error(`Expected one 605 house receivable, got ${houseRows.length}`);
await checked(supabase.from("receivables").update({
  building_id: building.id,
  unit_id: unit.id,
  customer_id: sale.customer_id,
  source_type: "sale_contract",
  source_id: sale.id,
  category: "sale_lump_sum",
  title: "4# 605购房款",
  due_date: house.payment_date,
  amount_xof: 66_600_000,
  paid_amount_xof: 66_600_000,
  status: "paid",
  currency: "XOF",
  notes: `${house.notes}\n收据号：${house.receipt_no}`,
}).eq("id", houseRows[0].id), "update 605 house receivable");

const registrationRows = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "other").eq("due_date", registration.payment_date).eq("amount_xof", 250_000), "find 605 registration receivable");
if (registrationRows.length > 1) throw new Error("Duplicate 605 registration receivable");
const registrationPayload = {
  building_id: building.id,
  unit_id: unit.id,
  customer_id: sale.customer_id,
  source_type: "sale_contract",
  source_id: sale.id,
  category: "other",
  title: "605注册金",
  due_date: registration.payment_date,
  amount_xof: 250_000,
  paid_amount_xof: 250_000,
  status: "paid",
  currency: "XOF",
  notes: `${registration.notes}\n收据号：${registration.receipt_no}`,
};
if (registrationRows.length === 1) await checked(supabase.from("receivables").update(registrationPayload).eq("id", registrationRows[0].id), "update 605 registration receivable");
else await checked(supabase.from("receivables").insert(registrationPayload), "insert 605 registration receivable");

const receivables = await checked(supabase.from("receivables").select("category, amount_xof, due_date").eq("source_id", sale.id).neq("status", "cancelled").order("due_date"), "verify 605 receivables");
if (receivables.length !== 2 || receivables.reduce((sum, row) => sum + Number(row.amount_xof), 0) !== 66_850_000) throw new Error("Unexpected 605 receivables");

await checked(supabase.from("customers").update({ notes: "来源：4号公寓.xlsx；4号楼605购房人；原表另记‘唐显明’，身份关系待核实。" }).eq("id", customer.id), "update COMOE notes");
await checked(supabase.from("sale_contracts").update({ payment_plan_type: "来源：4号公寓.xlsx；房款6660万已结清，注册金25万单列；原表另记‘报2025年1月’，含义待核实，不据此推断过户日期或状态。" }).eq("id", sale.id), "update 605 sale notes");
await checked(supabase.from("units").update({ notes: "来源：4号公寓.xlsx；买方COMOE，原表另记‘唐显明’，身份关系待核实；房款6660万于2022-07-18已结清，注册金25万于2020-12-09单列；原表另记‘报2025年1月’，含义待核实，不据此推断过户日期或状态；无租赁或代租记录。" }).eq("id", unit.id), "update 605 notes");
await checked(supabase.from("audit_logs").insert({ action: "rereview_unit_data", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI4", unit_no: "605", buyer: "COMOE", related_name_pending_verification: "唐显明", source_note_pending_verification: "报2025年1月", lease_count: 0, sale_paid_xof: 66_600_000, registration_xof: 250_000, receivables_rebuilt_per_payment: true } }), "write audit");

console.log(JSON.stringify({ ok: true, unit: "605", lease_count: 0, sale_paid_xof: 66_600_000, registration_xof: 250_000, receivables: receivables.length }));
