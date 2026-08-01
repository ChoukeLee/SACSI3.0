import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(query, label) { const { data, error } = await query; if (error) throw new Error(`${label}: ${error.message}`); return data; }

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI3").single(), "load building");
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "B304").single(), "load B304");
if (Number(unit.area_sqm) !== 173.51) throw new Error(`Unexpected B304 area: ${unit.area_sqm}`);
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).eq("status", "active").single(), "load B304 sale");
if (Number(sale.total_amount_xof) !== 160_000_000) throw new Error(`Unexpected B304 total: ${sale.total_amount_xof}`);
const customer = await checked(supabase.from("customers").select("id, name").eq("id", sale.customer_id).single(), "load B304 buyer");
if (customer.name !== "SAFER") throw new Error(`Unexpected B304 buyer: ${customer.name}`);
const houseNotes = "\u6765\u6e90\uff1a3\u53f7\u516c\u5bd3.xlsx\uff1bB304\u4e70\u65b9SAFER\uff1b\u5408\u540c\u603b\u4ef716000\u4e07FCFA\uff1b2021-03-16\u652f\u7968\u4e00\u6b21\u6027\u4ed816000\u4e07\uff0c\u5df2\u7ed3\u6e05\u3002";
const regNotes = "\u6765\u6e90\uff1a3\u53f7\u516c\u5bd3.xlsx\uff1bB304\u5b9e\u9645\u6536\u6ce8\u518c\u91d130\u4e07FCFA\uff1bExcel\u672a\u8bb0\u65e5\u671f\uff0c2021-03-16\u4e3a\u7cfb\u7edf\u5360\u4f4d\u65e5\uff1b\u4e0d\u8ba1\u5165\u5408\u540c\u603b\u4ef7\u3002";
const taxNotes = "\u6765\u6e90\uff1a3\u53f7\u516c\u5bd3.xlsx\uff1bB304\u4e8e2021-04-20\u5b9e\u9645\u6536\u7a0e\u6b3e300\u4e07FCFA\uff1b\u6309Excel\u5b9e\u9645\u91d1\u989d\u767b\u8bb0\uff0c\u4e0d\u53e6\u884c\u8ba1\u7b97\u5dee\u989d\uff0c\u4e0d\u8ba1\u5165\u5408\u540c\u603b\u4ef7\u3002";
await checked(supabase.from("sale_contracts").update({ signed_date: "2021-03-16", payment_plan_type: "lump_sum", agency_company: "FULO", agency_commission_amount_xof: null, agency_commission_paid: true }).eq("id", sale.id), "update B304 sale");
await checked(supabase.from("units").update({ status: "sold", notes: `${houseNotes}\n${regNotes}\n${taxNotes}\nFULO\u63d0\u6210\u4e8e2021-04-07\u652f\u4ed8\uff0c\u91d1\u989d\u5f85\u8865\u3002` }).eq("id", unit.id), "update B304 unit");

async function upsertPayment({ receiptNo, legacyReceiptNo, date, amount, sourceType, notes, category }) {
  let rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (!rows.length && legacyReceiptNo) rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", legacyReceiptNo), `find ${legacyReceiptNo}`);
  if (rows.length > 1) throw new Error(`Duplicate ${receiptNo}`);
  const payload = { customer_id: customer.id, unit_id: unit.id, source_type: sourceType, source_id: sale.id, payment_date: date, amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
  const paymentId = rows.length ? (await checked(supabase.from("payments").update(payload).eq("id", rows[0].id).select("id").single(), `update ${receiptNo}`)).id : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  const ledgerPayload = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: date, direction: "income", category, amount_xof: amount, amount_cny: null, description: notes };
  if (ledgers.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgers[0].id), `update ledger ${receiptNo}`); else if (!ledgers.length) await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${receiptNo}`); else throw new Error(`Duplicate ledger ${receiptNo}`);
}
await upsertPayment({ receiptNo: "WB3-SALE-B304-20210316-HOUSE-01", legacyReceiptNo: "S3-SALE-B304-CONSOLIDATED", date: "2021-03-16", amount: 160_000_000, sourceType: "sale_contract", notes: houseNotes, category: "sale" });
await upsertPayment({ receiptNo: "WB3-SALE-B304-20210316-REGISTRATION-01", date: "2021-03-16", amount: 300_000, sourceType: "sale_registration_fee", notes: regNotes, category: "sale_registration_fee" });
await upsertPayment({ receiptNo: "WB3-SALE-B304-20210420-TRANSFER-TAX-01", date: "2021-04-20", amount: 3_000_000, sourceType: "sale_other_income", notes: taxNotes, category: "sale_transfer_tax" });
const receivable = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).neq("status", "cancelled").single(), "load B304 receivable");
await checked(supabase.from("receivables").update({ category: "sale_lump_sum", title: "3# B304\u8d2d\u623f\u6b3e", due_date: "2021-03-16", amount_xof: 160_000_000, paid_amount_xof: 160_000_000, status: "paid", currency: "XOF", notes: houseNotes }).eq("id", receivable.id), "update B304 receivable");
const verified = await checked(supabase.from("payments").select("source_type, amount").eq("source_id", sale.id), "verify B304 payments");
if (verified.length !== 3 || verified.filter((row) => row.source_type === "sale_contract").reduce((sum, row) => sum + Number(row.amount), 0) !== 160_000_000 || verified.filter((row) => row.source_type === "sale_registration_fee").reduce((sum, row) => sum + Number(row.amount), 0) !== 300_000 || verified.filter((row) => row.source_type === "sale_other_income").reduce((sum, row) => sum + Number(row.amount), 0) !== 3_000_000) throw new Error("Unexpected verified B304 payments");
await checked(supabase.from("audit_logs").insert({ action: "reconcile_sacsi3_b304_actual_amounts", entity_type: "sale_contract", entity_id: sale.id, metadata: { building_code: "SACSI3", unit_no: "B304", buyer: customer.name, total_xof: 160_000_000, house_payment: { date: "2021-03-16", amount_xof: 160_000_000, method: "check" }, settled: true, registration_fee: { actual_amount_xof: 300_000, date_pending: true, placeholder_date: "2021-03-16" }, transfer_tax: { date: "2021-04-20", actual_amount_xof: 3_000_000, difference_tracking: false }, agency: { company: "FULO", paid_date: "2021-04-07", amount_pending: true } } }), "write B304 audit log");
console.log(JSON.stringify({ ok: true, unit: "B304", house_total_xof: 160_000_000, registration_xof: 300_000, actual_transfer_tax_xof: 3_000_000, settled: true }));
