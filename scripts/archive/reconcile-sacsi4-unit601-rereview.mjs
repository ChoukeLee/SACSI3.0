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
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "601").single(), "load 601");
const leases = await checked(supabase.from("lease_contracts").select("id, contract_no").eq("unit_id", unit.id), "load 601 leases");
if (leases.length !== 1 || leases[0].contract_no !== "WB-LEASE-SACSI4-601-20220317") throw new Error("Unexpected 601 leases");
const lease = leases[0];
await checked(supabase.from("lease_contracts").update({ status: "terminated", actual_end_date: "2022-08-16", expected_end_confirmed: true }).eq("id", lease.id), "confirm Li lease");
const leaseIncome = await checked(supabase.from("payments").select("amount").eq("source_id", lease.id).in("source_type", ["lease_deposit", "lease_rent", "property_fee"]), "load Li income");
const leaseReceivables = await checked(supabase.from("receivables").select("amount_xof").eq("source_id", lease.id).neq("status", "cancelled"), "load Li receivables");
if (leaseIncome.length !== 3 || leaseIncome.reduce((sum, payment) => sum + Number(payment.amount), 0) !== 4_210_000 || leaseReceivables.length !== 3) throw new Error("Unexpected Li income records");
const depositCloseout = await checked(supabase.from("payments").select("source_type, amount").eq("source_id", lease.id).in("source_type", ["lease_deposit_refund", "lease_deposit_deduction"]), "load Li deposit closeout");
if (depositCloseout.length !== 2 || depositCloseout.reduce((sum, payment) => sum + Number(payment.amount), 0) !== 1_000_000) throw new Error("Unexpected Li deposit closeout");

const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).single(), "load 601 sale");
if (Number(sale.total_amount_xof) !== 75_000_000) throw new Error("Unexpected 601 sale total");
const housePayments = await checked(supabase.from("payments").select("payment_date, amount, receipt_no, notes").eq("source_id", sale.id).eq("source_type", "sale_contract").order("payment_date"), "load 601 house payments");
if (housePayments.length !== 2 || housePayments.reduce((sum, payment) => sum + Number(payment.amount), 0) !== 75_000_000 || !housePayments.some((payment) => Number(payment.amount) === 55_000_000) || !housePayments.some((payment) => Number(payment.amount) === 20_000_000)) throw new Error("Unexpected 601 house payments");

const propertyReceipt = "WB4-SALE-601-20211211-PROP-03";
const propertyNotes = "601\u53f6\u743c2021-12-11\u652f\u4ed8\u7269\u4e1a\u8d3924\u4e07\uff0c\u4e0d\u8ba1\u51657500\u4e07\u623f\u4ef7\uff1b\u539f\u62bc\u91d1120\u4e07\u548c\u79df\u91d1360\u4e07\u4e8e2021-12-29\u79df\u8f6c\u4e70\u65f6\u8ba1\u5165\u9996\u7b14\u623f\u6b3e5500\u4e07\u3002";
const propertyRows = await checked(supabase.from("payments").select("id").eq("source_id", sale.id).eq("receipt_no", propertyReceipt), "find 601 property payment");
if (propertyRows.length > 1) throw new Error("Duplicate 601 property payment");
const propertyPayload = {
  customer_id: sale.customer_id,
  unit_id: unit.id,
  source_type: "property_fee",
  source_id: sale.id,
  payment_date: "2021-12-11",
  amount: 240_000,
  currency: "XOF",
  exchange_rate_to_xof: 1,
  receipt_no: propertyReceipt,
  notes: propertyNotes,
};
let propertyPaymentId;
if (propertyRows.length === 1) {
  propertyPaymentId = propertyRows[0].id;
  await checked(supabase.from("payments").update(propertyPayload).eq("id", propertyPaymentId), "update 601 property payment");
} else {
  propertyPaymentId = (await checked(supabase.from("payments").insert(propertyPayload).select("id").single(), "insert 601 property payment")).id;
}
const propertyLedger = {
  building_id: building.id,
  unit_id: unit.id,
  payment_id: propertyPaymentId,
  entry_date: "2021-12-11",
  direction: "income",
  category: "property_fee",
  amount_xof: 240_000,
  amount_cny: null,
  description: propertyNotes,
};
const propertyLedgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", propertyPaymentId), "find 601 property ledger");
if (propertyLedgers.length > 1) throw new Error("Duplicate 601 property ledger");
if (propertyLedgers.length === 1) await checked(supabase.from("ledger_entries").update(propertyLedger).eq("id", propertyLedgers[0].id), "update 601 property ledger");
else await checked(supabase.from("ledger_entries").insert(propertyLedger), "insert 601 property ledger");

const combined = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum").eq("amount_xof", 75_000_000), "find combined 601 house receivable");
if (combined.length > 1) throw new Error("Duplicate combined 601 house receivable");
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
    title: "4# 601\u8d2d\u623f\u6b3e",
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

const propertyReceivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "other").eq("due_date", "2021-12-11").eq("amount_xof", 240_000), "find 601 property receivable");
if (propertyReceivables.length > 1) throw new Error("Duplicate 601 property receivable");
const propertyReceivablePayload = {
  building_id: building.id,
  unit_id: unit.id,
  customer_id: sale.customer_id,
  source_type: "sale_contract",
  source_id: sale.id,
  category: "other",
  title: "601\u7269\u4e1a\u8d39",
  due_date: "2021-12-11",
  amount_xof: 240_000,
  paid_amount_xof: 240_000,
  status: "paid",
  currency: "XOF",
  notes: `${propertyNotes}\n\u6536\u636e\u53f7\uff1a${propertyReceipt}`,
};
if (propertyReceivables.length === 1) await checked(supabase.from("receivables").update(propertyReceivablePayload).eq("id", propertyReceivables[0].id), "update 601 property receivable");
else await checked(supabase.from("receivables").insert(propertyReceivablePayload), "insert 601 property receivable");

const saleReceivables = await checked(supabase.from("receivables").select("amount_xof").eq("source_id", sale.id).neq("status", "cancelled"), "verify 601 sale receivables");
if (saleReceivables.length !== 3 || saleReceivables.reduce((sum, row) => sum + Number(row.amount_xof), 0) !== 75_240_000) throw new Error("Unexpected 601 sale receivables");

await checked(supabase.from("units").update({ notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u4e70\u65b9\u53f6\u743c\uff0c\u623f\u6b3e7500\u4e07\u5206\u4e3a5500\u4e07\u548c2000\u4e07\u4e24\u7b14\u5df2\u7ed3\u6e05\uff1b\u9996\u7b145500\u4e07\u542b\u539f\u62bc\u91d1\u548c\u79df\u91d1480\u4e07\u7684\u79df\u8f6c\u4e70\u8f6c\u5165\uff0c\u4e0d\u91cd\u590d\u8ba1\u79df\u91d1\u548c\u62bc\u91d1\uff1b\u7269\u4e1a\u8d3924\u4e07\u5355\u5217\uff1b\u505c\u8f66\u4f4d\u4e3a\u8d60\u9001\uff0c\u65e0\u8f66\u4f4d\u6b3e\u6536\u5165\uff1b\u674e\u5170\u99a82022-08-16\u817e\u51fa\uff0c2022-09-01\u5df2\u6309\u62bc\u91d1\u3001\u5269\u4f59\u79df\u91d1\u3001\u7269\u4e1a\u8d39\u548c\u5237\u5899\u6263\u6b3e\u7ed3\u7b97\u3002" }).eq("id", unit.id), "update 601 notes");
await checked(supabase.from("audit_logs").insert({ action: "rereview_unit_data", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI4", unit_no: "601", sale_paid_xof: 75_000_000, sale_payment_count: 2, property_fee_xof: 240_000, rent_to_buy_transfer_xof: 4_800_000, rent_to_buy_not_duplicated: true, parking_gifted: true, parking_income_xof: 0, li_lanxin_settlement_xof: 1_365_000 } }), "write audit");

console.log(JSON.stringify({ ok: true, unit: "601", sale_paid_xof: 75_000_000, property_fee_xof: 240_000, sale_receivables: 3, parking_income_xof: 0 }));
