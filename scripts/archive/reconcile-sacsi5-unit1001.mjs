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
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "1001").single(), "load unit");
if (Number(unit.area_sqm) !== 175.95) throw new Error(`Unexpected 1001 area: ${unit.area_sqm}`);
const leases = await checked(supabase.from("lease_contracts").select("id, customer_id, contract_no").eq("unit_id", unit.id), "load leases");
if (leases.length > 1 || (leases.length === 1 && leases[0].contract_no !== "LEGACY-LEASE-SACSI5-1001")) throw new Error("Unexpected 1001 lease");

let customerId;
if (leases.length === 1) {
  customerId = leases[0].customer_id;
  const [payments, receivables, ledgers] = await Promise.all([
    checked(supabase.from("payments").select("id").eq("source_id", leases[0].id), "check legacy payments"),
    checked(supabase.from("receivables").select("id").eq("source_id", leases[0].id), "check legacy receivables"),
    checked(supabase.from("ledger_entries").select("id").eq("unit_id", unit.id), "check legacy ledgers"),
  ]);
  if (payments.length || receivables.length || ledgers.length) throw new Error("Legacy 1001 lease unexpectedly has financial references");
  await checked(supabase.from("lease_contracts").delete().eq("id", leases[0].id), "delete legacy lease");
} else {
  const customers = await checked(supabase.from("customers").select("id").eq("name", "\u516c\u53f8\u5bbf\u820d"), "find customer");
  if (customers.length !== 1) throw new Error(`Unexpected company dorm customer count: ${customers.length}`);
  customerId = customers[0].id;
}
const customer = await checked(supabase.from("customers").select("id, name").eq("id", customerId).single(), "load customer");
if (customer.name !== "\u516c\u53f8\u5bbf\u820d") throw new Error(`Unexpected customer: ${customer.name}`);
await checked(supabase.from("customers").update({ notes: "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b5# 1001\u516c\u53f8\u81ea\u7528\u5bbf\u820d\u8d2d\u7f6e\u4e3b\u4f53\u3002" }).eq("id", customerId), "update customer");

const contractNo = "WB-SALE-SACSI5-1001-20260422-COMPANY";
let sales = await checked(supabase.from("sale_contracts").select("id").eq("unit_id", unit.id), "find sale");
if (sales.length > 1) throw new Error("Duplicate 1001 sales");
const saleNotes = "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b\u516c\u53f8\u81ea\u7528\u5bbf\u820d\uff0c\u9762\u79ef175.95\u33a1\uff0c\u630980\u4e07FCFA/\u33a1\u8ba1\u4ef7\uff0c\u5408\u540c\u603b\u4ef714076\u4e07FCFA\uff1b2026-04-22\u4e00\u6b21\u4ed8\u6e05\uff1b\u672a\u8bb0\u5408\u540c\u7b7e\u7f72\u65e5\u671f\uff0c\u4ee5\u4ed8\u6b3e\u65e5\u4f5c\u6280\u672f\u7b7e\u7ea6\u65e5\uff1b\u65e0\u8f66\u4f4d\u3001\u6ce8\u518c\u91d1\u3001\u79df\u8d41\u6216\u4ee3\u79df\u8bb0\u5f55\u3002";
const salePayload = { unit_id: unit.id, customer_id: customerId, contract_no: contractNo, signed_date: "2026-04-22", transfer_status: "not_started", payment_plan_type: saleNotes, total_amount_xof: 140_760_000, status: "active" };
let saleId;
if (sales.length === 1) {
  saleId = sales[0].id;
  await checked(supabase.from("sale_contracts").update(salePayload).eq("id", saleId), "update sale");
} else {
  saleId = (await checked(supabase.from("sale_contracts").insert(salePayload).select("id").single(), "insert sale")).id;
}

const receiptNo = "WB5-SALE-1001-20260422-HOUSE-01";
const paymentRows = await checked(supabase.from("payments").select("id").eq("source_id", saleId), "find payment");
if (paymentRows.length > 1) throw new Error("Unexpected 1001 payments");
const paymentPayload = { customer_id: customerId, unit_id: unit.id, source_type: "sale_contract", source_id: saleId, payment_date: "2026-04-22", amount: 140_760_000, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes: saleNotes };
let paymentId;
if (paymentRows.length === 1) {
  paymentId = paymentRows[0].id;
  await checked(supabase.from("payments").update(paymentPayload).eq("id", paymentId), "update payment");
} else {
  paymentId = (await checked(supabase.from("payments").insert(paymentPayload).select("id").single(), "insert payment")).id;
}

const ledgerRows = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), "find ledger");
if (ledgerRows.length > 1) throw new Error("Duplicate 1001 ledgers");
const ledgerPayload = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: "2026-04-22", direction: "income", category: "sale", amount_xof: 140_760_000, amount_cny: null, description: saleNotes };
if (ledgerRows.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgerRows[0].id), "update ledger");
else await checked(supabase.from("ledger_entries").insert(ledgerPayload), "insert ledger");

const receivableRows = await checked(supabase.from("receivables").select("id").eq("source_id", saleId).neq("status", "cancelled"), "find receivable");
if (receivableRows.length > 1) throw new Error("Unexpected 1001 receivables");
const receivablePayload = { building_id: building.id, unit_id: unit.id, customer_id: customerId, source_type: "sale_contract", source_id: saleId, category: "sale_lump_sum", title: "5# 1001\u8d2d\u7f6e\u6b3e", due_date: "2026-04-22", amount_xof: 140_760_000, paid_amount_xof: 140_760_000, status: "paid", currency: "XOF", notes: `${saleNotes}\n\u6536\u636e\u53f7\uff1a${receiptNo}` };
if (receivableRows.length === 1) await checked(supabase.from("receivables").update(receivablePayload).eq("id", receivableRows[0].id), "update receivable");
else await checked(supabase.from("receivables").insert(receivablePayload), "insert receivable");
await checked(supabase.from("units").update({ status: "sold", notes: saleNotes }).eq("id", unit.id), "update unit");

const [verifiedLeases, verifiedSales, verifiedPayments, verifiedReceivables, verifiedLedgers] = await Promise.all([
  checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id), "verify leases"),
  checked(supabase.from("sale_contracts").select("customer_id, total_amount_xof, status").eq("unit_id", unit.id), "verify sales"),
  checked(supabase.from("payments").select("source_type, amount, currency").eq("source_id", saleId), "verify payments"),
  checked(supabase.from("receivables").select("amount_xof, paid_amount_xof, status").eq("source_id", saleId).neq("status", "cancelled"), "verify receivables"),
  checked(supabase.from("ledger_entries").select("amount_xof, direction, category").eq("payment_id", paymentId), "verify ledgers"),
]);
if (verifiedLeases.length !== 0 || verifiedSales.length !== 1 || verifiedSales[0].customer_id !== customerId || Number(verifiedSales[0].total_amount_xof) !== 140_760_000 || verifiedSales[0].status !== "active") throw new Error("Unexpected verified contracts");
if (verifiedPayments.length !== 1 || verifiedPayments[0].source_type !== "sale_contract" || Number(verifiedPayments[0].amount) !== 140_760_000 || verifiedPayments[0].currency !== "XOF") throw new Error("Unexpected verified payment");
if (verifiedReceivables.length !== 1 || Number(verifiedReceivables[0].amount_xof) !== 140_760_000 || Number(verifiedReceivables[0].paid_amount_xof) !== 140_760_000 || verifiedReceivables[0].status !== "paid") throw new Error("Unexpected verified receivable");
if (verifiedLedgers.length !== 1 || Number(verifiedLedgers[0].amount_xof) !== 140_760_000 || verifiedLedgers[0].direction !== "income" || verifiedLedgers[0].category !== "sale") throw new Error("Unexpected verified ledger");

await checked(supabase.from("audit_logs").insert({ action: "reconcile_unit_sale_data", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI5", unit_no: "1001", usage: "company_dormitory", area_sqm: 175.95, unit_price_xof_per_sqm: 800_000, sale_total_xof: 140_760_000, paid_xof: 140_760_000, settled: true, payment_date: "2026-04-22", signed_date_inferred_from_payment: true, erroneous_lease_deleted: true, parking_recorded: false, registration_fee_recorded: false, agency_recorded: false } }), "write audit log");
console.log(JSON.stringify({ ok: true, unit: "1001", usage: "company_dormitory", total_xof: 140_760_000, paid_xof: 140_760_000, settled: true }));
