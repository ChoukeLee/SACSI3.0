import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(query, label) { const { data, error } = await query; if (error) throw new Error(`${label}: ${error.message}`); return data; }

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI3").single(), "load building");
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "B1203").single(), "load B1203");
if (Number(unit.area_sqm) !== 115.44) throw new Error(`Unexpected B1203 area: ${unit.area_sqm}`);
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).eq("status", "active").single(), "load B1203 sale");
if (Number(sale.total_amount_xof) !== 115_000_000) throw new Error(`Unexpected B1203 total: ${sale.total_amount_xof}`);
const buyer = await checked(supabase.from("customers").select("id, name").eq("id", sale.customer_id).single(), "load B1203 buyer");
if (buyer.name !== "DINNEWETH") throw new Error(`Unexpected B1203 buyer: ${buyer.name}`);

async function upsertPayment({ receiptNo, legacyReceiptNo, amount, sourceType, category, notes }) {
  let rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (!rows.length && legacyReceiptNo) rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", legacyReceiptNo), `find ${legacyReceiptNo}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const payload = { customer_id: buyer.id, unit_id: unit.id, source_type: sourceType, source_id: sale.id, payment_date: "2021-03-02", amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
  const paymentId = rows.length ? (await checked(supabase.from("payments").update(payload).eq("id", rows[0].id).select("id").single(), `update ${receiptNo}`)).id : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledger = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: "2021-03-02", direction: "income", category, amount_xof: amount, amount_cny: null, description: notes };
  if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), `update ledger ${receiptNo}`); else await checked(supabase.from("ledger_entries").insert(ledger), `insert ledger ${receiptNo}`);
}

const houseNotes = "来源：3号公寓.xlsx；B1203买方DINNEWETH；合同总价11500万FCFA；Excel仅记‘款已付高总，已签字’，未记房款日期和方式；经用户确认按已结清登记，并以实际税款日2021-03-02作为房款及签约占位日期，该日期不代表原始房款日期。";
const taxNotes = "来源：3号公寓.xlsx；B1203于2021-03-02实际收税款345万FCFA；按Excel实际金额登记，不计算差额，不计入合同总价。";
await checked(supabase.from("sale_contracts").update({ signed_date: "2021-03-02", payment_plan_type: "lump_sum", agency_company: "FULO", agency_commission_amount_xof: null, agency_commission_paid: true }).eq("id", sale.id), "update B1203 sale");
await upsertPayment({ receiptNo: "WB3-SALE-1203-20210302-HOUSE-01", legacyReceiptNo: "S3-SALE-B1203-CONSOLIDATED", amount: 115_000_000, sourceType: "sale_contract", category: "sale", notes: houseNotes });
await upsertPayment({ receiptNo: "WB3-SALE-1203-20210302-TRANSFER-TAX-01", amount: 3_450_000, sourceType: "sale_other_income", category: "sale_transfer_tax", notes: taxNotes });
const receivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).neq("status", "cancelled"), "load B1203 receivable");
if (receivables.length !== 1) throw new Error(`Unexpected B1203 receivable count: ${receivables.length}`);
await checked(supabase.from("receivables").update({ category: "sale_lump_sum", title: "3# B1203购房款", due_date: "2021-03-02", amount_xof: 115_000_000, paid_amount_xof: 115_000_000, status: "paid", currency: "XOF", notes: houseNotes }).eq("id", receivables[0].id), "update B1203 receivable");
await checked(supabase.from("units").update({ status: "sold", notes: `${houseNotes}\n${taxNotes}\nFULO提成于2021-02-10支付，金额待补；Excel未记注册金或租赁记录；过户状态不推断。` }).eq("id", unit.id), "update B1203 unit");
const verified = await checked(supabase.from("payments").select("source_type, amount").eq("source_id", sale.id), "verify B1203 payments");
const sum = (type) => verified.filter((row) => row.source_type === type).reduce((total, row) => total + Number(row.amount), 0);
if (verified.length !== 2 || sum("sale_contract") !== 115_000_000 || sum("sale_other_income") !== 3_450_000) throw new Error("Unexpected B1203 totals");
await checked(supabase.from("audit_logs").insert({ action: "reconcile_sacsi3_b1203", entity_type: "sale_contract", entity_id: sale.id, metadata: { building_code: "SACSI3", unit_no: "B1203", buyer: "DINNEWETH", total_xof: 115_000_000, settled: true, original_house_payment_date_pending: true, accounting_date_placeholder: "2021-03-02", actual_tax_xof: 3_450_000, tax_date: "2021-03-02", agency: { company: "FULO", paid_date: "2021-02-10", amount_pending: true }, registration_missing: true, transfer_status_inferred: false } }), "write B1203 audit");
console.log(JSON.stringify({ ok: true, unit: "B1203", settled: true, house_xof: 115_000_000, actual_tax_xof: 3_450_000, house_payment_date_pending: true }));
