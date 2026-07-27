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
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "610").single(), "load 610");
const leases = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id), "load 610 leases");
if (leases.length !== 0) throw new Error(`Unexpected 610 lease count: ${leases.length}`);
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).single(), "load 610 sale");
if (Number(sale.total_amount_xof) !== 66_000_000) throw new Error("Unexpected 610 sale total");
const customer = await checked(supabase.from("customers").select("id, name").eq("id", sale.customer_id).single(), "load 610 buyer");
if (customer.name !== "COPTY") throw new Error(`Unexpected 610 buyer: ${customer.name}`);

const expectedHouse = [
  ["2020-08-14", 55_000_000],
  ["2020-12-09", 2_020_000],
  ["2021-01-21", 1_000_000],
  ["2021-03-29", 1_000_000],
  ["2021-04-19", 1_000_000],
  ["2021-07-05", 1_000_000],
  ["2021-08-25", 1_000_000],
];
const payments = await checked(supabase.from("payments").select("source_type, payment_date, amount, receipt_no, notes").eq("source_id", sale.id).order("payment_date"), "load 610 payments");
if (payments.length !== 8) throw new Error(`Unexpected 610 payment count: ${payments.length}`);
const housePayments = payments.filter((payment) => payment.source_type === "sale_contract");
const tax = payments.find((payment) => payment.source_type === "sale_other_income");
if (housePayments.length !== 7 || housePayments.reduce((sum, payment) => sum + Number(payment.amount), 0) !== 62_020_000) throw new Error("Unexpected 610 house payments");
for (const [date, amount] of expectedHouse) {
  if (!housePayments.some((payment) => payment.payment_date === date && Number(payment.amount) === amount)) throw new Error(`Missing 610 house payment ${date}/${amount}`);
}
if (!tax || tax.payment_date !== "2020-10-26" || Number(tax.amount) !== 1_980_000) throw new Error("Unexpected 610 transfer tax");
if (housePayments.reduce((sum, payment) => sum + Number(payment.amount), 0) + Number(tax.amount) !== 64_000_000) throw new Error("610 payments do not match Excel paid total");

const combined = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum").eq("amount_xof", 66_000_000), "find combined 610 receivable");
if (combined.length > 1) throw new Error("Duplicate combined 610 receivable");
for (let index = 0; index < housePayments.length; index += 1) {
  const payment = housePayments[index];
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
    title: "4# 610购房款",
    due_date: payment.payment_date,
    amount_xof: amount,
    paid_amount_xof: amount,
    status: "paid",
    currency: "XOF",
    notes: `${payment.notes}\n收据号：${payment.receipt_no}`,
  };
  if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update receivable ${payment.receipt_no}`);
  else if (index === 0 && combined.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", combined[0].id), "split combined 610 receivable");
  else await checked(supabase.from("receivables").insert(payload), `insert receivable ${payment.receipt_no}`);
}

const taxRows = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "other").eq("due_date", tax.payment_date).eq("amount_xof", 1_980_000), "find 610 tax receivable");
if (taxRows.length > 1) throw new Error("Duplicate 610 tax receivable");
const taxPayload = {
  building_id: building.id,
  unit_id: unit.id,
  customer_id: sale.customer_id,
  source_type: "sale_contract",
  source_id: sale.id,
  category: "other",
  title: "610过户税代收（计入合同结算）",
  due_date: tax.payment_date,
  amount_xof: 1_980_000,
  paid_amount_xof: 1_980_000,
  status: "paid",
  currency: "XOF",
  notes: `${tax.notes}\n该笔按Excel计入合同已付6400万，不作为6600万合同外新增应收。\n收据号：${tax.receipt_no}`,
};
if (taxRows.length === 1) await checked(supabase.from("receivables").update(taxPayload).eq("id", taxRows[0].id), "update 610 tax receivable");
else await checked(supabase.from("receivables").insert(taxPayload), "insert 610 tax receivable");

const balanceRows = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum").eq("amount_xof", 2_000_000).eq("paid_amount_xof", 0), "find 610 balance receivable");
if (balanceRows.length > 1) throw new Error("Duplicate 610 balance receivable");
const balancePayload = {
  building_id: building.id,
  unit_id: unit.id,
  customer_id: sale.customer_id,
  source_type: "sale_contract",
  source_id: sale.id,
  category: "sale_lump_sum",
  title: "610剩余购房款",
  due_date: "2020-08-14",
  amount_xof: 2_000_000,
  paid_amount_xof: 0,
  status: "overdue",
  currency: "XOF",
  notes: "来源：4号公寓.xlsx；合同6600万，已付6400万，仍欠200万。Excel未记载该余额具体到期日，沿用现有合同日期作为系统技术日期，实际到期日待核实。",
};
if (balanceRows.length === 1) await checked(supabase.from("receivables").update(balancePayload).eq("id", balanceRows[0].id), "update 610 balance receivable");
else await checked(supabase.from("receivables").insert(balancePayload), "insert 610 balance receivable");

const receivables = await checked(supabase.from("receivables").select("amount_xof, paid_amount_xof, status").eq("source_id", sale.id).neq("status", "cancelled"), "verify 610 receivables");
const total = receivables.reduce((sum, row) => sum + Number(row.amount_xof), 0);
const paid = receivables.reduce((sum, row) => sum + Number(row.paid_amount_xof), 0);
const overdue = receivables.filter((row) => row.status === "overdue").reduce((sum, row) => sum + Number(row.amount_xof) - Number(row.paid_amount_xof), 0);
if (receivables.length !== 9 || total !== 66_000_000 || paid !== 64_000_000 || overdue !== 2_000_000) throw new Error(`Unexpected 610 receivables: count=${receivables.length}, total=${total}, paid=${paid}, overdue=${overdue}`);

await checked(supabase.from("customers").update({ notes: "来源：4号公寓.xlsx；科特迪瓦籍；4号楼610购房人。" }).eq("id", customer.id), "update COPTY notes");
await checked(supabase.from("sale_contracts").update({ payment_plan_type: "来源：4号公寓.xlsx；合同6600万，7笔房款合计6202万，过户税198万按Excel计入合同结算，合计已付6400万，仍欠200万。" }).eq("id", sale.id), "update 610 sale notes");
await checked(supabase.from("units").update({ notes: "来源：4号公寓.xlsx；买方COPTY，科特迪瓦籍；合同总价6600万，7笔房款合计6202万，2020-10-26过户税代收198万按Excel计入合同结算，合计已付6400万，仍欠200万；过户税独立分类但不作为合同外新增金额；欠款具体到期日未记载，系统技术日期沿用合同日期，实际到期日待核实；无租赁或代租记录。" }).eq("id", unit.id), "update 610 notes");
await checked(supabase.from("audit_logs").insert({ action: "rereview_unit_data", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI4", unit_no: "610", buyer: "COPTY", nationality: "科特迪瓦", lease_count: 0, contract_total_xof: 66_000_000, house_paid_xof: 62_020_000, transfer_tax_xof: 1_980_000, transfer_tax_counted_toward_contract: true, settled_paid_xof: 64_000_000, outstanding_xof: 2_000_000, outstanding_due_date_pending_verification: true, receivables_rebuilt_per_payment: true } }), "write audit");

console.log(JSON.stringify({ ok: true, unit: "610", contract_total_xof: total, paid_xof: paid, outstanding_xof: overdue, receivables: receivables.length }));
