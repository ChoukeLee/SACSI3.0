import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(query, label) { const { data, error } = await query; if (error) throw new Error(`${label}: ${error.message}`); return data; }

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI3").single(), "load building");
const units = await checked(supabase.from("units").select("id, unit_no, area_sqm").eq("building_id", building.id).in("unit_no", ["B1003", "B1004"]), "load units");
if (units.length !== 2) throw new Error("Missing B1003/B1004 unit");
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));
if (Number(unitByNo.B1003.area_sqm) !== 115.44 || Number(unitByNo.B1004.area_sqm) !== 173.51) throw new Error("Unexpected unit area");
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unitByNo.B1003.id).eq("status", "active").single(), "load B1003 sale");
if (Number(sale.total_amount_xof) !== 98_000_000) throw new Error(`Unexpected B1003 total: ${sale.total_amount_xof}`);
const buyer = await checked(supabase.from("customers").select("id, name").eq("id", sale.customer_id).single(), "load B1003 buyer");
if (buyer.name !== "余波") throw new Error(`Unexpected B1003 buyer: ${buyer.name}`);

async function upsertPayment({ receiptNo, legacyReceiptNo, date, amount, sourceType, category, notes }) {
  let rows = await checked(supabase.from("payments").select("id").eq("unit_id", unitByNo.B1003.id).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (!rows.length && legacyReceiptNo) rows = await checked(supabase.from("payments").select("id").eq("unit_id", unitByNo.B1003.id).eq("receipt_no", legacyReceiptNo), `find ${legacyReceiptNo}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const payload = { customer_id: buyer.id, unit_id: unitByNo.B1003.id, source_type: sourceType, source_id: sale.id, payment_date: date, amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
  const paymentId = rows.length ? (await checked(supabase.from("payments").update(payload).eq("id", rows[0].id).select("id").single(), `update ${receiptNo}`)).id : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledger = { building_id: building.id, unit_id: unitByNo.B1003.id, payment_id: paymentId, entry_date: date, direction: "income", category, amount_xof: amount, amount_cny: null, description: notes };
  if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), `update ledger ${receiptNo}`); else await checked(supabase.from("ledger_entries").insert(ledger), `insert ledger ${receiptNo}`);
}

const houseNotes = "来源：3号公寓.xlsx；B1003买方余波；合同总价9800万FCFA；2020-10-15现金支付4000万、支票支付5800万，合计9800万，已结清。";
const taxNotes = "来源：3号公寓.xlsx；B1003于2023-04-25实际收税款300万FCFA；按Excel实际金额登记，不计算差额，不计入合同总价。";
await checked(supabase.from("sale_contracts").update({ signed_date: "2020-10-15", payment_plan_type: "installment" }).eq("id", sale.id), "update B1003 sale");
await upsertPayment({ receiptNo: "WB3-SALE-1003-20201015-HOUSE-01", legacyReceiptNo: "S3-SALE-B1003-CONSOLIDATED", date: "2020-10-15", amount: 40_000_000, sourceType: "sale_contract", category: "sale", notes: `${houseNotes} 本笔支付方式：现金。` });
await upsertPayment({ receiptNo: "WB3-SALE-1003-20201015-HOUSE-02", date: "2020-10-15", amount: 58_000_000, sourceType: "sale_contract", category: "sale", notes: `${houseNotes} 本笔支付方式：支票。` });
await upsertPayment({ receiptNo: "WB3-SALE-1003-20230425-TRANSFER-TAX-01", date: "2023-04-25", amount: 3_000_000, sourceType: "sale_other_income", category: "sale_transfer_tax", notes: taxNotes });
const receivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).neq("status", "cancelled"), "load B1003 receivable");
if (receivables.length !== 1) throw new Error(`Unexpected B1003 receivable count: ${receivables.length}`);
await checked(supabase.from("receivables").update({ category: "sale_installment", title: "3# B1003购房款", due_date: "2020-10-15", amount_xof: 98_000_000, paid_amount_xof: 98_000_000, status: "paid", currency: "XOF", notes: houseNotes }).eq("id", receivables[0].id), "update B1003 receivable");
await checked(supabase.from("units").update({ status: "sold", notes: `${houseNotes}\n${taxNotes}\nExcel未记注册金、FULO提成或租赁记录；过户状态不推断。` }).eq("id", unitByNo.B1003.id), "update B1003 unit");

const b1004Notes = "来源：3号公寓.xlsx；B1004记载‘华为租’，2021-05-15入住；租金、押金、付款、退租日及当前占用状态均缺失。现仅登记原始线索并锁定待核实，不伪造合同金额或结束日期。";
await checked(supabase.from("units").update({ status: "locked", notes: b1004Notes }).eq("id", unitByNo.B1004.id), "register B1004 pending information");

const verified = await checked(supabase.from("payments").select("source_type, amount, currency").eq("source_id", sale.id), "verify B1003 payments");
const sum = (type) => verified.filter((row) => row.source_type === type).reduce((total, row) => total + Number(row.amount), 0);
if (verified.length !== 3 || sum("sale_contract") !== 98_000_000 || sum("sale_other_income") !== 3_000_000 || verified.some((row) => row.currency !== "XOF")) throw new Error("Unexpected B1003 payment state");
const b1004Leases = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unitByNo.B1004.id), "verify B1004 leases");
if (b1004Leases.length) throw new Error("B1004 should not have a fabricated lease contract");
await checked(supabase.from("audit_logs").insert({ action: "reconcile_sacsi3_b1003_b1004", entity_type: "building", entity_id: building.id, metadata: { B1003: { buyer: "余波", total_xof: 98_000_000, house_payments: [{ date: "2020-10-15", amount_xof: 40_000_000, method: "cash" }, { date: "2020-10-15", amount_xof: 58_000_000, method: "check" }], settled: true, actual_tax_xof: 3_000_000, tax_date: "2023-04-25" }, B1004: { tenant: "华为", start: "2021-05-15", finance_pending: true, end_pending: true, occupancy_pending: true, lease_contract_created: false } } }), "write B1003-B1004 audit");
console.log(JSON.stringify({ ok: true, B1003: { settled: true, house_xof: 98_000_000, actual_tax_xof: 3_000_000 }, B1004: "registered_pending" }));
