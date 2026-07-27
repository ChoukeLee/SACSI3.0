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
const unitNos = ["B902", "B903", "B904"];
const units = await checked(supabase.from("units").select("id, unit_no, area_sqm").eq("building_id", building.id).in("unit_no", unitNos), "load units");
if (units.length !== unitNos.length) throw new Error("Missing B902-B904 unit");
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));
if (Number(unitByNo.B902.area_sqm) !== 54.99 || Number(unitByNo.B903.area_sqm) !== 115.44 || Number(unitByNo.B904.area_sqm) !== 173.51) throw new Error("Unexpected unit area");

const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unitByNo.B902.id).eq("status", "active").single(), "load B902 sale");
if (Number(sale.total_amount_xof) !== 55_000_000) throw new Error(`Unexpected B902 total: ${sale.total_amount_xof}`);
const scmanRows = await checked(supabase.from("customers").select("id, name").eq("name", "SCMAN"), "load SCMAN");
if (scmanRows.length !== 1) throw new Error(`Unexpected SCMAN customer count: ${scmanRows.length}`);
const scman = scmanRows[0];

const houseNotes = "来源：3号公寓.xlsx；B902与B503为同一买方SCMAN；合同总价5500万FCFA；2021-03-03支票支付5500万，房款已结清。";
const registrationNotes = "来源：3号公寓.xlsx；B902注册金30万FCFA；Excel未记收款日期，以房款支付日2021-03-03作为占位账务日期；不计入合同总价。";
const taxNotes = "来源：3号公寓.xlsx；B902于2021-03-09实际收税款165万FCFA；按Excel实际金额登记，不计算差额；不计入合同总价。";
await checked(supabase.from("sale_contracts").update({ customer_id: scman.id, signed_date: "2021-03-03", payment_plan_type: "lump_sum", agency_company: "FULO", agency_commission_amount_xof: null, agency_commission_paid: true }).eq("id", sale.id), "update B902 sale");

async function upsertPayment({ receiptNo, legacyReceiptNo, date, amount, sourceType, category, notes }) {
  let rows = await checked(supabase.from("payments").select("id").eq("unit_id", unitByNo.B902.id).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (!rows.length && legacyReceiptNo) rows = await checked(supabase.from("payments").select("id").eq("unit_id", unitByNo.B902.id).eq("receipt_no", legacyReceiptNo), `find ${legacyReceiptNo}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const payload = { customer_id: scman.id, unit_id: unitByNo.B902.id, source_type: sourceType, source_id: sale.id, payment_date: date, amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
  const paymentId = rows.length
    ? (await checked(supabase.from("payments").update(payload).eq("id", rows[0].id).select("id").single(), `update ${receiptNo}`)).id
    : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledger = { building_id: building.id, unit_id: unitByNo.B902.id, payment_id: paymentId, entry_date: date, direction: "income", category, amount_xof: amount, amount_cny: null, description: notes };
  if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), `update ledger ${receiptNo}`);
  else await checked(supabase.from("ledger_entries").insert(ledger), `insert ledger ${receiptNo}`);
}

await upsertPayment({ receiptNo: "WB3-SALE-902-20210303-HOUSE-01", legacyReceiptNo: "S3-SALE-B902-CONSOLIDATED", date: "2021-03-03", amount: 55_000_000, sourceType: "sale_contract", category: "sale", notes: `${houseNotes} 本笔支付方式：支票。` });
await upsertPayment({ receiptNo: "WB3-SALE-902-20210303-REGISTRATION-01", date: "2021-03-03", amount: 300_000, sourceType: "sale_registration_fee", category: "sale_registration_fee", notes: registrationNotes });
await upsertPayment({ receiptNo: "WB3-SALE-902-20210309-TRANSFER-TAX-01", date: "2021-03-09", amount: 1_650_000, sourceType: "sale_other_income", category: "sale_transfer_tax", notes: taxNotes });

const receivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).neq("status", "cancelled"), "load B902 receivable");
if (receivables.length !== 1) throw new Error(`Unexpected B902 receivable count: ${receivables.length}`);
await checked(supabase.from("receivables").update({ customer_id: scman.id, category: "sale_lump_sum", title: "3# B902购房款", due_date: "2021-03-03", amount_xof: 55_000_000, paid_amount_xof: 55_000_000, status: "paid", currency: "XOF", notes: houseNotes }).eq("id", receivables[0].id), "update B902 receivable");
await checked(supabase.from("units").update({ status: "sold", notes: `${houseNotes}\n${registrationNotes}\n${taxNotes}\nFULO提成于2021-12-14支付，金额待补；过户状态不推断；Excel无租赁记录。` }).eq("id", unitByNo.B902.id), "update B902 unit");

const b903Notes = "来源：3号公寓.xlsx；B903记载租户/经办信息‘华为谢幕蓉’，‘11月13日入’；年份、租金、押金、付款、退租日及当前占用状态均缺失。现仅登记原始线索并锁定待核实，不生成金额或日期不完整的租赁合同。";
const b904Notes = "来源：3号公寓.xlsx；B904记载‘华为租’，2020-12-01入住；租金、押金、付款、退租日及当前占用状态均缺失。现仅登记原始线索并锁定待核实，不伪造合同金额或结束日期。";
await checked(supabase.from("units").update({ status: "locked", notes: b903Notes }).eq("id", unitByNo.B903.id), "register B903 pending information");
await checked(supabase.from("units").update({ status: "locked", notes: b904Notes }).eq("id", unitByNo.B904.id), "register B904 pending information");

const verified = await checked(supabase.from("payments").select("source_type, amount, currency, exchange_rate_to_xof").eq("source_id", sale.id), "verify B902 payments");
const sum = (type) => verified.filter((row) => row.source_type === type).reduce((total, row) => total + Number(row.amount) * Number(row.exchange_rate_to_xof), 0);
if (verified.length !== 3 || sum("sale_contract") !== 55_000_000 || sum("sale_registration_fee") !== 300_000 || sum("sale_other_income") !== 1_650_000 || verified.some((row) => row.currency !== "XOF")) throw new Error("Unexpected B902 payment state");
const leases = await checked(supabase.from("lease_contracts").select("id, unit_id").in("unit_id", [unitByNo.B903.id, unitByNo.B904.id]), "verify pending leases");
if (leases.length) throw new Error("B903/B904 should not have fabricated lease contracts");

await checked(supabase.from("audit_logs").insert({ action: "reconcile_sacsi3_b902_b904", entity_type: "building", entity_id: building.id, metadata: { B902: { buyer: "SCMAN", same_buyer_as: "B503", total_xof: 55_000_000, payment_method: "check", registration_xof: 300_000, registration_date_placeholder: "2021-03-03", actual_tax_xof: 1_650_000, tax_date: "2021-03-09", settled: true, agency: { company: "FULO", paid_date: "2021-12-14", amount_pending: true }, lease_recorded: false }, B903: { raw_tenant: "华为谢幕蓉", raw_start: "11月13日入", year_pending: true, finance_pending: true, occupancy_pending: true, lease_contract_created: false }, B904: { tenant: "华为", start: "2020-12-01", finance_pending: true, end_pending: true, occupancy_pending: true, lease_contract_created: false } } }), "write B902-B904 audit log");

console.log(JSON.stringify({ ok: true, B902: { buyer: "SCMAN", settled: true, house_xof: 55_000_000, registration_xof: 300_000, actual_tax_xof: 1_650_000 }, B903: "registered_pending", B904: "registered_pending" }));
