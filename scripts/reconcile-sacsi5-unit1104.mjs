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
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "1104").single(), "load unit");
if (Number(unit.area_sqm) !== 181.36) throw new Error(`Unexpected 1104 area: ${unit.area_sqm}`);
const leases = await checked(supabase.from("lease_contracts").select("id, customer_id, contract_no").eq("unit_id", unit.id), "load leases");
if (leases.length > 1 || (leases.length === 1 && leases[0].contract_no !== "LEGACY-LEASE-SACSI5-1104")) throw new Error("Unexpected 1104 lease");

let customerId;
if (leases.length === 1) {
  customerId = leases[0].customer_id;
  const [payments, receivables, ledgers] = await Promise.all([
    checked(supabase.from("payments").select("id").eq("source_id", leases[0].id), "check legacy payments"),
    checked(supabase.from("receivables").select("id").eq("source_id", leases[0].id), "check legacy receivables"),
    checked(supabase.from("ledger_entries").select("id").eq("unit_id", unit.id), "check legacy ledgers"),
  ]);
  if (payments.length || receivables.length || ledgers.length) throw new Error("Legacy 1104 lease unexpectedly has financial references");
  await checked(supabase.from("lease_contracts").delete().eq("id", leases[0].id), "delete legacy lease");
} else {
  const customers = await checked(supabase.from("customers").select("id").eq("name", "\u9648\u4f73\u4f1f"), "find customer");
  if (customers.length !== 1) throw new Error(`Unexpected customer count: ${customers.length}`);
  customerId = customers[0].id;
}
const customer = await checked(supabase.from("customers").select("name").eq("id", customerId).single(), "load customer");
if (customer.name !== "\u9648\u4f73\u4f1f") throw new Error(`Unexpected customer: ${customer.name}`);
await checked(supabase.from("customers").update({ notes: "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b\u4e2d\u56fd\u7c4d\uff1b5# 1104\u8d2d\u623f\u4eba\u3002" }).eq("id", customerId), "update customer");

const contractNo = "WB-SALE-SACSI5-1104-20230311-CHENJIAWEI";
const saleNotes = "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b\u4e70\u65b9\u9648\u4f73\u4f1f\uff0c\u4e2d\u56fd\u7c4d\uff1b\u5408\u540c\u603b\u4ef721200\u4e07FCFA\uff0c\u660e\u786e\u5230\u8d2620800\u4e07\uff0c\u4ecd\u6b20400\u4e07\uff1bExcel\u9ec4\u8272\u6807\u6ce8\u201c2025-01-24\u4ed8400\u4e07\u201d\u65e0\u7968\u636e\u4e14\u662f\u5426\u5230\u8d26\u5f85\u6838\u5b9e\uff0c\u4e0d\u8ba1\u5165\u5df2\u4ed8\u3001\u6536\u6b3e\u6216\u603b\u8d26\uff1b\u672a\u8bb0\u5408\u540c\u7b7e\u7f72\u65e5\uff0c\u4ee5\u9996\u7b14\u4ed8\u6b3e\u65e52023-03-11\u4f5c\u6280\u672f\u7b7e\u7ea6\u65e5\uff1b\u65e0\u8f66\u4f4d\u3001\u6ce8\u518c\u91d1\u3001\u79df\u8d41\u6216\u4ee3\u79df\u8bb0\u5f55\u3002";
let sales = await checked(supabase.from("sale_contracts").select("id").eq("unit_id", unit.id), "find sale");
if (sales.length > 1) throw new Error("Duplicate 1104 sales");
const salePayload = { unit_id: unit.id, customer_id: customerId, contract_no: contractNo, signed_date: "2023-03-11", transfer_status: "not_started", payment_plan_type: saleNotes, total_amount_xof: 212_000_000, status: "active" };
let saleId;
if (sales.length === 1) {
  saleId = sales[0].id;
  await checked(supabase.from("sale_contracts").update(salePayload).eq("id", saleId), "update sale");
} else {
  saleId = (await checked(supabase.from("sale_contracts").insert(salePayload).select("id").single(), "insert sale")).id;
}

const entries = [
  ["2023-03-11", 84_450_000, "HOUSE-ACCOUNT-01", "\u5b58\u9ad8\u603b\u8d26\u53f7"],
  ["2023-03-11", 17_550_000, "HOUSE-CHEQUE-02", "\u652f\u7968"],
  ...["2023-04-18", "2023-05-16", "2023-07-01", "2023-08-21", "2023-09-16", "2023-10-16", "2023-11-24", "2023-12-28", "2024-02-05", "2024-03-25", "2024-05-06", "2024-07-08", "2024-09-16", "2024-09-18", "2024-11-26", "2024-12-30", "2025-11-20"].map((date, index) => [date, 6_000_000, `HOUSE-${String(index + 3).padStart(2, "0")}`, ""]),
  ["2025-12-19", 4_000_000, "HOUSE-20", ""],
];

for (const [date, amount, suffix, detail] of entries) {
  const receiptNo = `WB5-SALE-1104-${date.replaceAll("-", "")}-${suffix}`;
  const notes = `1104\u9648\u4f73\u4f1f${detail ? `${detail}\uff0c` : ""}\u8d2d\u623f\u6b3e${amount / 10_000}\u4e07FCFA\uff1b\u660e\u786e\u5230\u8d26\u5408\u8ba120800\u4e07\uff0c\u4ecd\u6b20400\u4e07\u3002`;
  const paymentRows = await checked(supabase.from("payments").select("id").eq("source_id", saleId).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (paymentRows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const paymentPayload = { customer_id: customerId, unit_id: unit.id, source_type: "sale_contract", source_id: saleId, payment_date: date, amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
  let paymentId;
  if (paymentRows.length === 1) {
    paymentId = paymentRows[0].id;
    await checked(supabase.from("payments").update(paymentPayload).eq("id", paymentId), `update ${receiptNo}`);
  } else paymentId = (await checked(supabase.from("payments").insert(paymentPayload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgerRows = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgerRows.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledgerPayload = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: date, direction: "income", category: "sale", amount_xof: amount, amount_cny: null, description: notes };
  if (ledgerRows.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgerRows[0].id), `update ledger ${receiptNo}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${receiptNo}`);
  const recRows = await checked(supabase.from("receivables").select("id").eq("source_id", saleId).eq("category", "sale_lump_sum").eq("due_date", date).eq("amount_xof", amount), `find receivable ${receiptNo}`);
  if (recRows.length > 1) throw new Error(`Duplicate receivable ${receiptNo}`);
  const recPayload = { building_id: building.id, unit_id: unit.id, customer_id: customerId, source_type: "sale_contract", source_id: saleId, category: "sale_lump_sum", title: "5# 1104\u8d2d\u623f\u6b3e", due_date: date, amount_xof: amount, paid_amount_xof: amount, status: "paid", currency: "XOF", notes: `${notes}\n\u6536\u636e\u53f7\uff1a${receiptNo}` };
  if (recRows.length === 1) await checked(supabase.from("receivables").update(recPayload).eq("id", recRows[0].id), `update receivable ${receiptNo}`);
  else await checked(supabase.from("receivables").insert(recPayload), `insert receivable ${receiptNo}`);
}

const balanceRows = await checked(supabase.from("receivables").select("id").eq("source_id", saleId).eq("category", "sale_lump_sum").eq("amount_xof", 4_000_000).eq("paid_amount_xof", 0), "find balance");
if (balanceRows.length > 1) throw new Error("Duplicate 1104 balance");
const balancePayload = { building_id: building.id, unit_id: unit.id, customer_id: customerId, source_type: "sale_contract", source_id: saleId, category: "sale_lump_sum", title: "5# 1104\u5269\u4f59\u8d2d\u623f\u6b3e", due_date: "2023-03-11", amount_xof: 4_000_000, paid_amount_xof: 0, status: "overdue", currency: "XOF", notes: "1104\u5408\u540c\u603b\u4ef721200\u4e07FCFA\uff0c\u660e\u786e\u5230\u8d2620800\u4e07\uff0c\u4ecd\u6b20400\u4e07\uff1b\u5b9e\u9645\u5230\u671f\u65e5\u672a\u8bb0\u8f7d\uff0c\u4ee5\u6280\u672f\u7b7e\u7ea6\u65e5\u5f52\u8d26\uff1b2025-01-24\u9ec4\u8272\u6807\u6ce8400\u4e07\u65e0\u7968\u636e\uff0c\u5f85\u6838\u5b9e\uff0c\u4e0d\u8ba1\u5165\u5df2\u4ed8\u3002" };
if (balanceRows.length === 1) await checked(supabase.from("receivables").update(balancePayload).eq("id", balanceRows[0].id), "update balance");
else await checked(supabase.from("receivables").insert(balancePayload), "insert balance");
await checked(supabase.from("units").update({ status: "sold", notes: saleNotes }).eq("id", unit.id), "update unit");

const [verifiedLeases, verifiedSales, payments, receivables, ledgers] = await Promise.all([
  checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id), "verify leases"),
  checked(supabase.from("sale_contracts").select("total_amount_xof, status").eq("unit_id", unit.id), "verify sales"),
  checked(supabase.from("payments").select("amount, source_type").eq("source_id", saleId), "verify payments"),
  checked(supabase.from("receivables").select("amount_xof, paid_amount_xof, status").eq("source_id", saleId).neq("status", "cancelled"), "verify receivables"),
  checked(supabase.from("ledger_entries").select("amount_xof, direction, category").eq("unit_id", unit.id), "verify ledgers"),
]);
if (verifiedLeases.length || verifiedSales.length !== 1 || Number(verifiedSales[0].total_amount_xof) !== 212_000_000 || verifiedSales[0].status !== "active") throw new Error("Unexpected verified contracts");
if (payments.length !== 20 || payments.reduce((sum, row) => sum + Number(row.amount), 0) !== 208_000_000) throw new Error("Unexpected verified payments");
if (receivables.length !== 21 || receivables.reduce((sum, row) => sum + Number(row.amount_xof), 0) !== 212_000_000 || receivables.reduce((sum, row) => sum + Number(row.paid_amount_xof), 0) !== 208_000_000) throw new Error("Unexpected verified receivables");
if (ledgers.length !== 20 || ledgers.some((row) => row.direction !== "income" || row.category !== "sale") || ledgers.reduce((sum, row) => sum + Number(row.amount_xof), 0) !== 208_000_000) throw new Error("Unexpected verified ledgers");

await checked(supabase.from("audit_logs").insert({ action: "reconcile_unit_sale_data", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI5", unit_no: "1104", buyer: "\u9648\u4f73\u4f1f", nationality: "\u4e2d\u56fd", sale_total_xof: 212_000_000, confirmed_paid_xof: 208_000_000, outstanding_xof: 4_000_000, payment_count: 20, unverified_payment_xof: 4_000_000, unverified_payment_date: "2025-01-24", unverified_payment_recorded: false, signed_date_inferred_from_first_payment: true, erroneous_lease_deleted: true } }), "write audit log");
console.log(JSON.stringify({ ok: true, unit: "1104", total_xof: 212_000_000, paid_xof: 208_000_000, outstanding_xof: 4_000_000 }));
