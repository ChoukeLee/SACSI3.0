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

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI5").single(), "load building");
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "1004").single(), "load unit");
if (Number(unit.area_sqm) !== 181.36) throw new Error(`Unexpected 1004 area: ${unit.area_sqm}`);
const leases = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id), "check leases");
if (leases.length !== 0) throw new Error(`Unexpected 1004 leases: ${leases.length}`);

let customerRows = await checked(supabase.from("customers").select("id").eq("name", "\u67f3\u5b9d\u8fea"), "find customer");
if (customerRows.length > 1) throw new Error("Duplicate customer");
let customerId;
if (customerRows.length === 1) customerId = customerRows[0].id;
else customerId = (await checked(supabase.from("customers").insert({ name: "\u67f3\u5b9d\u8fea", notes: "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b\u4e2d\u56fd\u7c4d\uff1b5# 1004\u5386\u53f2\u8d2d\u623f\u4eba\uff0c\u540e\u5df2\u5168\u989d\u9000\u6b3e\u3002", is_blacklisted: false }).select("id").single(), "insert customer")).id;
await checked(supabase.from("customers").update({ notes: "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b\u4e2d\u56fd\u7c4d\uff1b5# 1004\u5386\u53f2\u8d2d\u623f\u4eba\uff0c\u540e\u5df2\u5168\u989d\u9000\u6b3e\u3002" }).eq("id", customerId), "update customer");

const contractNo = "WB-SALE-SACSI5-1004-20230519-LIUBAODI";
const saleNotes = "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b\u4e70\u65b9\u67f3\u5b9d\u8fea\uff0c\u4e2d\u56fd\u7c4d\uff1b\u5408\u540c\u603b\u4ef719670\u4e07FCFA\uff1b2023-05-19\u6c47\u6b3e270300\u6b27\u5143\uff0c\u539f\u8868\u8bb0\u7ea6656\u6c47\u7387\u5e762023-05-31\u6536\u5230\u897f\u6cd5\u6b3e\uff0c\u6309\u5408\u540c\u7ed3\u7b97\u5f52\u5165\u623f\u6b3e17725\u4e07\uff1b2023-11-24\u518d\u4ed81945\u4e07\uff0c\u5408\u8ba119670\u4e07\u5df2\u7ed3\u6e05\uff1b\u6b27\u5143\u6309656\u539f\u59cb\u6362\u7b97\u4e0e\u5408\u540c\u5dee6.68\u4e07\uff0c\u6309\u7528\u6237\u786e\u8ba4\u4f5c\u6c47\u7387\u53d6\u6574\u5dee\uff0c\u4e0d\u53e6\u5217\u8d85\u6536\uff1b2025-09-19\u5df2\u9000\u623f\u6b3e19670\u4e07\uff0c\u5408\u540c\u7ec8\u6b62\uff0c\u623f\u95f4\u6062\u590d\u7a7a\u95f2\u3002";
let saleRows = await checked(supabase.from("sale_contracts").select("id").eq("unit_id", unit.id), "find sale");
if (saleRows.length > 1) throw new Error("Duplicate 1004 sales");
const salePayload = { unit_id: unit.id, customer_id: customerId, contract_no: contractNo, signed_date: "2023-05-19", transfer_status: "not_started", payment_plan_type: saleNotes, total_amount_xof: 196_700_000, status: "terminated" };
let saleId;
if (saleRows.length === 1) {
  saleId = saleRows[0].id;
  await checked(supabase.from("sale_contracts").update(salePayload).eq("id", saleId), "update sale");
} else {
  saleId = (await checked(supabase.from("sale_contracts").insert(salePayload).select("id").single(), "insert sale")).id;
}

async function upsertPayment({ date, amount, sourceType, suffix, direction, category, notes }) {
  const receiptNo = `WB5-SALE-1004-${date.replaceAll("-", "")}-${suffix}`;
  const rows = await checked(supabase.from("payments").select("id").eq("source_id", saleId).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const payload = { customer_id: customerId, unit_id: unit.id, source_type: sourceType, source_id: saleId, payment_date: date, amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
  let paymentId;
  if (rows.length === 1) {
    paymentId = rows[0].id;
    await checked(supabase.from("payments").update(payload).eq("id", paymentId), `update ${receiptNo}`);
  } else {
    paymentId = (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  }
  const ledgerRows = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgerRows.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledgerPayload = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: date, direction, category, amount_xof: amount, amount_cny: null, description: notes };
  if (ledgerRows.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgerRows[0].id), `update ledger ${receiptNo}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${receiptNo}`);
  return { paymentId, receiptNo };
}

const entries = [
  { date: "2023-05-19", amount: 177_250_000, suffix: "HOUSE-EUR-01", notes: "1004\u67f3\u5b9d\u8fea\u9996\u7b14\u623f\u6b3e\u6309\u5408\u540c\u7ed3\u7b97\u5f52\u516517725\u4e07FCFA\uff1b\u539f\u59cb\u6c47\u6b3e270300\u6b27\u5143\u3001\u8868\u8bb0\u7ea6656\u6c47\u7387\uff0c2023-05-31\u6536\u5230\u897f\u6cd5\u6b3e\uff1b6.68\u4e07\u539f\u59cb\u6362\u7b97\u5dee\u4f5c\u6c47\u7387\u53d6\u6574\u5dee\uff0c\u4e0d\u53e6\u5217\u3002" },
  { date: "2023-11-24", amount: 19_450_000, suffix: "HOUSE-02", notes: "1004\u67f3\u5b9d\u8fea\u7b2c\u4e8c\u7b14\u623f\u6b3e1945\u4e07FCFA\uff1b\u4e24\u7b14\u540819670\u4e07\u5df2\u7ed3\u6e05\u3002" },
];
for (const entry of entries) {
  const result = await upsertPayment({ ...entry, sourceType: "sale_contract", direction: "income", category: "sale" });
  const receivableRows = await checked(supabase.from("receivables").select("id").eq("source_id", saleId).eq("category", "sale_lump_sum").eq("due_date", entry.date).eq("amount_xof", entry.amount), `find receivable ${result.receiptNo}`);
  if (receivableRows.length > 1) throw new Error(`Duplicate receivable ${result.receiptNo}`);
  const payload = { building_id: building.id, unit_id: unit.id, customer_id: customerId, source_type: "sale_contract", source_id: saleId, category: "sale_lump_sum", title: "5# 1004\u5386\u53f2\u8d2d\u623f\u6b3e", due_date: entry.date, amount_xof: entry.amount, paid_amount_xof: entry.amount, status: "paid", currency: "XOF", notes: `${entry.notes}\n\u6536\u636e\u53f7\uff1a${result.receiptNo}` };
  if (receivableRows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", receivableRows[0].id), `update receivable ${result.receiptNo}`);
  else await checked(supabase.from("receivables").insert(payload), `insert receivable ${result.receiptNo}`);
}

await upsertPayment({ date: "2025-09-19", amount: 196_700_000, sourceType: "sale_other_expense", suffix: "HOUSE-REFUND-01", direction: "expense", category: "sale_purchase_refund", notes: "1004\u67f3\u5b9d\u8fea\u9000\u623f\u6b3e19670\u4e07FCFA\uff1b\u4e0e\u5408\u540c\u603b\u4ef7\u76f8\u540c\uff0c\u5df2\u5168\u989d\u9000\u6b3e\uff1b\u4e0d\u751f\u6210\u65b0\u7684\u5e94\u6536\u3002" });
await checked(supabase.from("units").update({ status: "available", notes: saleNotes }).eq("id", unit.id), "update unit");

const [sales, payments, receivables, ledgers] = await Promise.all([
  checked(supabase.from("sale_contracts").select("total_amount_xof, status").eq("unit_id", unit.id), "verify sales"),
  checked(supabase.from("payments").select("source_type, amount").eq("source_id", saleId), "verify payments"),
  checked(supabase.from("receivables").select("amount_xof, paid_amount_xof, status").eq("source_id", saleId).neq("status", "cancelled"), "verify receivables"),
  checked(supabase.from("ledger_entries").select("direction, category, amount_xof").eq("unit_id", unit.id), "verify ledgers"),
]);
const houseTotal = payments.filter((row) => row.source_type === "sale_contract").reduce((sum, row) => sum + Number(row.amount), 0);
const refundTotal = payments.filter((row) => row.source_type === "sale_other_expense").reduce((sum, row) => sum + Number(row.amount), 0);
if (sales.length !== 1 || Number(sales[0].total_amount_xof) !== 196_700_000 || sales[0].status !== "terminated") throw new Error("Unexpected verified sale");
if (payments.length !== 3 || houseTotal !== 196_700_000 || refundTotal !== 196_700_000) throw new Error("Unexpected verified payments");
if (receivables.length !== 2 || receivables.reduce((sum, row) => sum + Number(row.amount_xof), 0) !== 196_700_000 || receivables.some((row) => Number(row.amount_xof) !== Number(row.paid_amount_xof) || row.status !== "paid")) throw new Error("Unexpected verified receivables");
if (ledgers.length !== 3 || ledgers.filter((row) => row.direction === "income" && row.category === "sale").reduce((sum, row) => sum + Number(row.amount_xof), 0) !== 196_700_000 || ledgers.filter((row) => row.direction === "expense" && row.category === "sale_purchase_refund").reduce((sum, row) => sum + Number(row.amount_xof), 0) !== 196_700_000) throw new Error("Unexpected verified ledgers");

await checked(supabase.from("audit_logs").insert({ action: "reconcile_historical_refunded_sale", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI5", unit_no: "1004", buyer: "\u67f3\u5b9d\u8fea", nationality: "\u4e2d\u56fd", sale_total_xof: 196_700_000, house_received_xof: 196_700_000, refunded_xof: 196_700_000, net_xof: 0, refund_date: "2025-09-19", contract_status: "terminated", unit_status: "available", original_eur_payment: 270_300, workbook_exchange_rate: 656, raw_conversion_difference_xof: 66_800, difference_treatment: "exchange_rate_rounding_not_separately_recorded", refund_receivable_created: false } }), "write audit log");
console.log(JSON.stringify({ ok: true, unit: "1004", total_xof: 196_700_000, received_xof: houseTotal, refunded_xof: refundTotal, net_xof: houseTotal - refundTotal, status: "available" }));
