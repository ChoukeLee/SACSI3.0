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
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "1003").single(), "load unit");
const leases = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id), "check leases");
if (leases.length !== 0) throw new Error(`Unexpected 1003 leases: ${leases.length}`);
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).single(), "load sale");
if (Number(sale.total_amount_xof) !== 177_000_000) throw new Error(`Unexpected sale total: ${sale.total_amount_xof}`);
const customer = await checked(supabase.from("customers").select("name").eq("id", sale.customer_id).single(), "load buyer");
if (customer.name !== "KIKISSAGBE") throw new Error(`Unexpected buyer: ${customer.name}`);

const housePayments = await checked(supabase.from("payments").select("id, amount, source_type").eq("source_id", sale.id).eq("source_type", "sale_contract"), "load house payments");
if (housePayments.length !== 9 || housePayments.reduce((sum, row) => sum + Number(row.amount), 0) !== 177_004_000) throw new Error("Unexpected house payments");
const tax = await checked(supabase.from("payments").select("id, amount, payment_date").eq("source_id", sale.id).eq("receipt_no", "WB5-SALE-1003-20260610-TAX").single(), "load transfer tax");
if (Number(tax.amount) !== 8_000_000 || tax.payment_date !== "2026-06-10") throw new Error("Unexpected transfer tax");

const saleNotes = "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff0c\u539f7#606\u5168\u90e8\u8fc1\u51655#1003\uff1b\u4e70\u65b9KIKISSAGBE\uff0c\u5408\u540c\u603b\u4ef717700\u4e07FCFA\uff0c\u9010\u7b14\u623f\u6b3e\u5b9e\u653617700.4\u4e07\uff0c\u5176\u4e2d0.4\u4e07\u4e3a\u8d85\u6536\uff0c\u5408\u540c\u5df2\u7ed3\u6e05\uff1b2026-06-10\u4ee3\u6536\u623f\u4e1c\u8fc7\u6237\u7a0e800\u4e07\u5355\u5217\u4e3a\u8d1f\u503a\u6d41\u5165\uff0c\u4e0d\u8ba1\u5165\u623f\u6b3e\u6216\u666e\u901a\u6536\u5165\uff1b2026-07-07\u652f\u4ed8\u4e2d\u4ecb\u8d39200\u4e07\u5355\u5217\u652f\u51fa\u3002";
await checked(supabase.from("sale_contracts").update({
  contract_no: "WB-SALE-SACSI5-1003-20250717",
  signed_date: "2025-07-17",
  total_amount_xof: 177_000_000,
  agency_commission_amount_xof: 2_000_000,
  agency_commission_paid: true,
  payment_plan_type: saleNotes,
  status: "active",
}).eq("id", sale.id), "update sale");
await checked(supabase.from("customers").update({ notes: "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\u53ca7\u53f7\u516c\u5bd3.xlsx\uff1b\u539f7#606\u8d2d\u623f\u4eba\uff0c\u5408\u540c\u53ca\u5168\u90e8\u8d22\u52a1\u5df2\u8fc1\u51655#1003\u3002" }).eq("id", sale.customer_id), "update buyer");

await checked(supabase.from("payments").update({ source_type: "sale_other_income", notes: "1003\u4ee3\u6536\u623f\u4e1c\u8fc7\u6237\u7a0e800\u4e07FCFA\uff1b\u539f7#606\u8fc1\u5165\uff1b\u5355\u5217\u4e3a\u8d1f\u503a\u4ee3\u6536\uff0c\u4e0d\u8ba1\u516517700\u4e07\u623f\u4ef7\u6216\u666e\u901a\u6536\u5165\u3002" }).eq("id", tax.id), "update tax payment");
const taxLedger = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", tax.id), "find tax ledger");
if (taxLedger.length !== 1) throw new Error(`Unexpected tax ledgers: ${taxLedger.length}`);
await checked(supabase.from("ledger_entries").update({ building_id: building.id, unit_id: unit.id, entry_date: "2026-06-10", direction: "liability_in", category: "sale_transfer_tax", amount_xof: 8_000_000, amount_cny: null, description: "1003\u4ee3\u6536\u623f\u4e1c\u8fc7\u6237\u7a0e800\u4e07FCFA\uff0c\u5355\u5217\u4e3a\u8d1f\u503a\u6d41\u5165\u3002" }).eq("id", taxLedger[0].id), "update tax ledger");

const taxReceivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "other").eq("due_date", "2026-06-10").eq("amount_xof", 8_000_000), "find tax receivable");
if (taxReceivables.length > 1) throw new Error("Duplicate tax receivables");
const taxReceivablePayload = { building_id: building.id, unit_id: unit.id, customer_id: sale.customer_id, source_type: "sale_contract", source_id: sale.id, category: "other", title: "5# 1003\u8fc7\u6237\u7a0e\u4ee3\u6536", due_date: "2026-06-10", amount_xof: 8_000_000, paid_amount_xof: 8_000_000, status: "paid", currency: "XOF", notes: "1003\u4ee3\u6536\u623f\u4e1c\u8fc7\u6237\u7a0e800\u4e07FCFA\uff0c\u539f7#606\u8fc1\u5165\uff1b\u4e0d\u8ba1\u5165\u5408\u540c\u603b\u4ef7\u3002\n\u6536\u636e\u53f7\uff1aWB5-SALE-1003-20260610-TAX" };
if (taxReceivables.length === 1) await checked(supabase.from("receivables").update(taxReceivablePayload).eq("id", taxReceivables[0].id), "update tax receivable");
else await checked(supabase.from("receivables").insert(taxReceivablePayload), "insert tax receivable");

const agencyReceipt = "WB5-SALE-1003-20260707-AGENCY-01";
const agencyNotes = "1003 2026-07-07\u652f\u4ed8\u9500\u552e\u4e2d\u4ecb\u8d39200\u4e07FCFA\uff1b\u5355\u5217\u652f\u51fa\uff0c\u4e0d\u51b2\u51cf\u623f\u6b3e\u6536\u5165\u3002";
const agencyRows = await checked(supabase.from("payments").select("id").eq("source_id", sale.id).eq("receipt_no", agencyReceipt), "find agency payment");
if (agencyRows.length > 1) throw new Error("Duplicate agency payments");
const agencyPayload = { customer_id: sale.customer_id, unit_id: unit.id, source_type: "sale_agency_expense", source_id: sale.id, payment_date: "2026-07-07", amount: 2_000_000, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: agencyReceipt, notes: agencyNotes };
let agencyId;
if (agencyRows.length === 1) {
  agencyId = agencyRows[0].id;
  await checked(supabase.from("payments").update(agencyPayload).eq("id", agencyId), "update agency payment");
} else {
  agencyId = (await checked(supabase.from("payments").insert(agencyPayload).select("id").single(), "insert agency payment")).id;
}
const agencyLedgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", agencyId), "find agency ledger");
if (agencyLedgers.length > 1) throw new Error("Duplicate agency ledgers");
const agencyLedgerPayload = { building_id: building.id, unit_id: unit.id, payment_id: agencyId, entry_date: "2026-07-07", direction: "expense", category: "sale_agency_expense", amount_xof: 2_000_000, amount_cny: null, description: agencyNotes };
if (agencyLedgers.length === 1) await checked(supabase.from("ledger_entries").update(agencyLedgerPayload).eq("id", agencyLedgers[0].id), "update agency ledger");
else await checked(supabase.from("ledger_entries").insert(agencyLedgerPayload), "insert agency ledger");

const saleReceivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum").neq("status", "cancelled"), "load sale receivable");
if (saleReceivables.length !== 1) throw new Error(`Unexpected sale receivables: ${saleReceivables.length}`);
await checked(supabase.from("receivables").update({ title: "5# 1003\u8d2d\u623f\u6b3e", amount_xof: 177_000_000, paid_amount_xof: 177_000_000, status: "paid", notes: "\u539f7#606\u8fc1\u51655#1003\uff1b\u5408\u540c\u623f\u4ef717700\u4e07FCFA\u5df2\u7ed3\u6e05\uff1b\u9010\u7b14\u5b9e\u653617700.4\u4e07\uff0c\u8d85\u65360.4\u4e07\u53e6\u5728\u4ed8\u6b3e\u6d41\u6c34\u4e2d\u4f53\u73b0\uff1b\u8fc7\u6237\u7a0e800\u4e07\u53e6\u5217\u3002" }).eq("id", saleReceivables[0].id), "update sale receivable");
await checked(supabase.from("units").update({ status: "sold", notes: saleNotes }).eq("id", unit.id), "update unit");

const [payments, receivables, ledgers] = await Promise.all([
  checked(supabase.from("payments").select("source_type, amount").eq("source_id", sale.id), "verify payments"),
  checked(supabase.from("receivables").select("category, amount_xof, paid_amount_xof, status, title").eq("source_id", sale.id).neq("status", "cancelled"), "verify receivables"),
  checked(supabase.from("ledger_entries").select("direction, category, amount_xof").eq("unit_id", unit.id), "verify ledgers"),
]);
const houseTotal = payments.filter((row) => row.source_type === "sale_contract").reduce((sum, row) => sum + Number(row.amount), 0);
const taxPayment = payments.filter((row) => row.source_type === "sale_other_income");
const agencyPayment = payments.filter((row) => row.source_type === "sale_agency_expense");
if (payments.length !== 11 || houseTotal !== 177_004_000 || taxPayment.length !== 1 || Number(taxPayment[0].amount) !== 8_000_000 || agencyPayment.length !== 1 || Number(agencyPayment[0].amount) !== 2_000_000) throw new Error("Unexpected verified payments");
if (receivables.length !== 2 || !receivables.some((row) => row.category === "sale_lump_sum" && row.title === "5# 1003\u8d2d\u623f\u6b3e" && Number(row.amount_xof) === 177_000_000 && Number(row.paid_amount_xof) === 177_000_000 && row.status === "paid") || !receivables.some((row) => row.category === "other" && Number(row.amount_xof) === 8_000_000 && Number(row.paid_amount_xof) === 8_000_000 && row.status === "paid")) throw new Error("Unexpected verified receivables");
if (!ledgers.some((row) => row.direction === "liability_in" && row.category === "sale_transfer_tax" && Number(row.amount_xof) === 8_000_000) || !ledgers.some((row) => row.direction === "expense" && row.category === "sale_agency_expense" && Number(row.amount_xof) === 2_000_000)) throw new Error("Unexpected verified ledgers");

await checked(supabase.from("audit_logs").insert({ action: "rereview_unit_data", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI5", unit_no: "1003", buyer: "KIKISSAGBE", migrated_from: "SACSI7-606", sale_total_xof: 177_000_000, house_received_xof: 177_004_000, overpayment_xof: 4_000, settled: true, transfer_tax_xof: 8_000_000, transfer_tax_classification: "liability_in", agency_expense_xof: 2_000_000, agency_paid: true, receivable_title_repaired: true } }), "write audit log");
console.log(JSON.stringify({ ok: true, unit: "1003", total_xof: 177_000_000, house_received_xof: houseTotal, overpayment_xof: 4_000, transfer_tax_xof: 8_000_000, agency_expense_xof: 2_000_000, settled: true }));
