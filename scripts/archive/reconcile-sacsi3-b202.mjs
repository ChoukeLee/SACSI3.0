import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
  const index = line.indexOf("=");
  return [line.slice(0, index), line.slice(index + 1)];
}));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function checked(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI3").single(), "load building");
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "B202").single(), "load B202");
if (Number(unit.area_sqm) !== 54.99) throw new Error(`Unexpected B202 area: ${unit.area_sqm}`);
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).eq("status", "active").single(), "load B202 sale");
if (Number(sale.total_amount_xof) !== 50_000_000) throw new Error(`Unexpected B202 total: ${sale.total_amount_xof}`);
const customer = await checked(supabase.from("customers").select("id, name").eq("id", sale.customer_id).single(), "load B202 buyer");
if (customer.name !== "HENRY") throw new Error(`Unexpected B202 buyer: ${customer.name}`);

const houseNotes = "\u6765\u6e90\uff1a3\u53f7\u516c\u5bd3.xlsx\uff1bB202\u4e70\u65b9HENRY\uff1b\u5408\u540c\u603b\u4ef75000\u4e07FCFA\uff1b2021-02-04\u73b0\u91d1\u4ed82500\u4e07\uff0c2021-02-09\u73b0\u91d1\u4ed82500\u4e07\uff0c\u5df2\u7ed3\u6e05\u3002";
const taxNotes = "\u6765\u6e90\uff1a3\u53f7\u516c\u5bd3.xlsx\uff1bB202\u4e8e2021-03-02\u65363%\u8fc7\u6237\u7a0e150\u4e07FCFA\uff1b\u7a0e\u8d39\u5355\u72ec\u5217\u793a\uff0c\u4e0d\u8ba1\u5165\u5408\u540c\u603b\u4ef7\u3002";

await checked(supabase.from("sale_contracts").update({
  signed_date: "2021-02-04",
  payment_plan_type: "lump_sum",
  agency_company: "FULO",
  agency_commission_amount_xof: null,
  agency_commission_paid: true,
}).eq("id", sale.id), "update B202 sale");
await checked(supabase.from("units").update({ status: "sold", notes: `${houseNotes}\n${taxNotes}\nFULO\u63d0\u6210\u4e8e2021-04-07\u652f\u4ed8\uff0c\u91d1\u989d\u5f85\u8865\u3002` }).eq("id", unit.id), "update B202 unit");

async function upsertPayment({ receiptNo, legacyReceiptNo, date, amount, sourceType, notes, category }) {
  let rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (rows.length === 0 && legacyReceiptNo) rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", legacyReceiptNo), `find ${legacyReceiptNo}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const payload = { customer_id: customer.id, unit_id: unit.id, source_type: sourceType, source_id: sale.id, payment_date: date, amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
  const paymentId = rows.length === 1
    ? (await checked(supabase.from("payments").update(payload).eq("id", rows[0].id).select("id").single(), `update ${receiptNo}`)).id
    : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledgerPayload = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: date, direction: "income", category, amount_xof: amount, amount_cny: null, description: notes };
  if (ledgers.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgers[0].id), `update ledger ${receiptNo}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${receiptNo}`);
}

await upsertPayment({ receiptNo: "WB3-SALE-B202-20210204-HOUSE-01", legacyReceiptNo: "S3-SALE-B202-CONSOLIDATED", date: "2021-02-04", amount: 25_000_000, sourceType: "sale_contract", notes: `${houseNotes}\n\u7b2c\u4e00\u7b14\u73b0\u91d1\u623f\u6b3e\u3002`, category: "sale" });
await upsertPayment({ receiptNo: "WB3-SALE-B202-20210209-HOUSE-02", date: "2021-02-09", amount: 25_000_000, sourceType: "sale_contract", notes: `${houseNotes}\n\u7b2c\u4e8c\u7b14\u73b0\u91d1\u623f\u6b3e\u3002`, category: "sale" });
await upsertPayment({ receiptNo: "WB3-SALE-B202-20210302-TRANSFER-TAX-01", date: "2021-03-02", amount: 1_500_000, sourceType: "sale_other_income", notes: taxNotes, category: "sale_transfer_tax" });

const receivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).neq("status", "cancelled"), "find B202 receivable");
if (receivables.length !== 1) throw new Error(`Unexpected B202 receivables: ${receivables.length}`);
await checked(supabase.from("receivables").update({
  category: "sale_lump_sum",
  title: "3# B202\u8d2d\u623f\u6b3e",
  due_date: "2021-02-04",
  amount_xof: 50_000_000,
  paid_amount_xof: 50_000_000,
  status: "paid",
  currency: "XOF",
  notes: houseNotes,
}).eq("id", receivables[0].id), "update B202 receivable");

const verifiedPayments = await checked(supabase.from("payments").select("source_type, amount").eq("source_id", sale.id), "verify B202 payments");
const houseTotal = verifiedPayments.filter((row) => row.source_type === "sale_contract").reduce((sum, row) => sum + Number(row.amount), 0);
const taxTotal = verifiedPayments.filter((row) => row.source_type === "sale_other_income").reduce((sum, row) => sum + Number(row.amount), 0);
if (verifiedPayments.length !== 3 || houseTotal !== 50_000_000 || taxTotal !== 1_500_000) throw new Error("Unexpected verified B202 payments");

await checked(supabase.from("audit_logs").insert({
  action: "reconcile_sacsi3_b202_sale",
  entity_type: "sale_contract",
  entity_id: sale.id,
  metadata: { building_code: "SACSI3", unit_no: "B202", buyer: customer.name, total_xof: 50_000_000, house_payments: [{ date: "2021-02-04", amount_xof: 25_000_000, method: "cash" }, { date: "2021-02-09", amount_xof: 25_000_000, method: "cash" }], settled: true, transfer_tax: { date: "2021-03-02", amount_xof: 1_500_000, included_in_contract_total: false }, agency: { company: "FULO", paid_date: "2021-04-07", amount_pending: true } },
}), "write B202 audit log");

console.log(JSON.stringify({ ok: true, unit: "B202", buyer: customer.name, house_total_xof: 50_000_000, transfer_tax_xof: 1_500_000, settled: true, fulo_amount_pending: true }));
