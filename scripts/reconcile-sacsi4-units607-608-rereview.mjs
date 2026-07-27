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
const units = await checked(supabase.from("units").select("id, unit_no").eq("building_id", building.id).in("unit_no", ["607", "608"]), "load 607/608");
if (units.length !== 2) throw new Error(`Expected two units, got ${units.length}`);
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));
if (!unitByNo["607"] || !unitByNo["608"]) throw new Error("Missing 607 or 608");
const leases = await checked(supabase.from("lease_contracts").select("id").in("unit_id", units.map((unit) => unit.id)), "load 607/608 leases");
if (leases.length !== 0) throw new Error(`Unexpected 607/608 lease count: ${leases.length}`);

const sales = await checked(supabase.from("sale_contracts").select("id, unit_id, customer_id, total_amount_xof").in("unit_id", units.map((unit) => unit.id)), "load 607/608 sales");
if (sales.length !== 2) throw new Error(`Expected two sales, got ${sales.length}`);
const saleByNo = Object.fromEntries(sales.map((sale) => [units.find((unit) => unit.id === sale.unit_id).unit_no, sale]));
if (Number(saleByNo["607"].total_amount_xof) !== 60_000_000 || Number(saleByNo["608"].total_amount_xof) !== 75_000_000) throw new Error("Unexpected 607/608 sale totals");
if (saleByNo["607"].customer_id !== saleByNo["608"].customer_id) throw new Error("607/608 must share one buyer");
const customer = await checked(supabase.from("customers").select("id, name").eq("id", saleByNo["607"].customer_id).single(), "load 607/608 buyer");
if (customer.name !== "廖俊生") throw new Error(`Unexpected 607/608 buyer: ${customer.name}`);

for (const [unitNo, expectedAmount] of [["607", 60_000_000], ["608", 75_000_000]]) {
  const sale = saleByNo[unitNo];
  const payments = await checked(supabase.from("payments").select("source_type, payment_date, amount, receipt_no, notes").eq("source_id", sale.id).eq("source_type", "sale_contract"), `load ${unitNo} house payments`);
  if (payments.length !== 1 || payments[0].payment_date !== "2021-07-22" || Number(payments[0].amount) !== expectedAmount) throw new Error(`Unexpected ${unitNo} house payment`);
  const payment = payments[0];
  const receivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum").eq("amount_xof", expectedAmount), `find ${unitNo} house receivable`);
  if (receivables.length !== 1) throw new Error(`Expected one ${unitNo} house receivable, got ${receivables.length}`);
  await checked(supabase.from("receivables").update({
    building_id: building.id,
    unit_id: unitByNo[unitNo].id,
    customer_id: customer.id,
    source_type: "sale_contract",
    source_id: sale.id,
    category: "sale_lump_sum",
    title: `4# ${unitNo}购房款`,
    due_date: payment.payment_date,
    amount_xof: expectedAmount,
    paid_amount_xof: expectedAmount,
    status: "paid",
    currency: "XOF",
    notes: `${payment.notes}\n收据号：${payment.receipt_no}`,
  }).eq("id", receivables[0].id), `update ${unitNo} house receivable`);
  await checked(supabase.from("sale_contracts").update({ payment_plan_type: `来源：4号公寓.xlsx；607/608同一买方于2021-07-22打包付款13500万，${unitNo}按Excel标价分摊${expectedAmount / 10_000}万并已结清。` }).eq("id", sale.id), `update ${unitNo} sale notes`);
}

const parkingPayments = await checked(supabase.from("payments").select("id, source_type, payment_date, amount, receipt_no").eq("source_id", saleByNo["607"].id).eq("source_type", "sale_other_income"), "load 607 parking payment");
if (parkingPayments.length !== 1 || parkingPayments[0].payment_date !== "2022-05-28" || Number(parkingPayments[0].amount) !== 5_000_000) throw new Error("Unexpected 607 parking payment");
const parking = parkingPayments[0];
const parkingNotes = "607另购1个车位，车位款500万，不计入607/608房价；按P52登记，Excel原文另记‘17#、1#车位、P52’，不据此推断为多个车位。";
await checked(supabase.from("payments").update({ notes: parkingNotes }).eq("id", parking.id), "update 607 parking payment notes");
await checked(supabase.from("ledger_entries").update({ description: parkingNotes }).eq("payment_id", parking.id), "update 607 parking ledger notes");
const parkingRows = await checked(supabase.from("receivables").select("id").eq("source_id", saleByNo["607"].id).eq("category", "other").eq("due_date", parking.payment_date).eq("amount_xof", 5_000_000), "find 607 parking receivable");
if (parkingRows.length > 1) throw new Error("Duplicate 607 parking receivable");
const parkingPayload = {
  building_id: building.id,
  unit_id: unitByNo["607"].id,
  customer_id: customer.id,
  source_type: "sale_contract",
  source_id: saleByNo["607"].id,
  category: "other",
  title: "607车位款",
  due_date: parking.payment_date,
  amount_xof: 5_000_000,
  paid_amount_xof: 5_000_000,
  status: "paid",
  currency: "XOF",
  notes: `${parkingNotes}\n收据号：${parking.receipt_no}`,
};
if (parkingRows.length === 1) await checked(supabase.from("receivables").update(parkingPayload).eq("id", parkingRows[0].id), "update 607 parking receivable");
else await checked(supabase.from("receivables").insert(parkingPayload), "insert 607 parking receivable");

const receivables607 = await checked(supabase.from("receivables").select("amount_xof").eq("source_id", saleByNo["607"].id).neq("status", "cancelled"), "verify 607 receivables");
const receivables608 = await checked(supabase.from("receivables").select("amount_xof").eq("source_id", saleByNo["608"].id).neq("status", "cancelled"), "verify 608 receivables");
if (receivables607.length !== 2 || receivables607.reduce((sum, row) => sum + Number(row.amount_xof), 0) !== 65_000_000) throw new Error("Unexpected 607 receivables");
if (receivables608.length !== 1 || receivables608.reduce((sum, row) => sum + Number(row.amount_xof), 0) !== 75_000_000) throw new Error("Unexpected 608 receivables");

await checked(supabase.from("customers").update({ notes: "来源：4号公寓.xlsx；中国籍；4号楼607、608同一购房人。" }).eq("id", customer.id), "update Liao notes");
await checked(supabase.from("units").update({ notes: "来源：4号公寓.xlsx；607/608同一买方廖俊生，2021-07-22打包付款13500万，607按Excel标价分摊6000万并已结清；2022-05-28另购1个车位，车位款500万单列，不计入房价；按P52登记，保留原文‘17#、1#车位、P52’，不推断为多个车位；无租赁或代租记录。" }).eq("id", unitByNo["607"].id), "update 607 notes");
await checked(supabase.from("units").update({ notes: "来源：4号公寓.xlsx；607/608同一买方廖俊生，2021-07-22打包付款13500万，608按Excel标价分摊7500万并已结清；无租赁或代租记录。" }).eq("id", unitByNo["608"].id), "update 608 notes");
await checked(supabase.from("audit_logs").insert([
  { action: "rereview_unit_data", entity_type: "unit", entity_id: unitByNo["607"].id, metadata: { building_code: "SACSI4", unit_no: "607", buyer: "廖俊生", paired_unit: "608", package_paid_xof: 135_000_000, allocated_house_xof: 60_000_000, parking_income_xof: 5_000_000, parking_count: 1, parking_reference: "P52", lease_count: 0 } },
  { action: "rereview_unit_data", entity_type: "unit", entity_id: unitByNo["608"].id, metadata: { building_code: "SACSI4", unit_no: "608", buyer: "廖俊生", paired_unit: "607", package_paid_xof: 135_000_000, allocated_house_xof: 75_000_000, lease_count: 0 } },
]), "write 607/608 audits");

console.log(JSON.stringify({ ok: true, units: ["607", "608"], buyer: "廖俊生", house_paid_xof: 135_000_000, parking_income_xof: 5_000_000, receivables_607: receivables607.length, receivables_608: receivables608.length }));
