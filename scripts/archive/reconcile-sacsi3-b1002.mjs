import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(query, label) { const { data, error } = await query; if (error) throw new Error(`${label}: ${error.message}`); return data; }

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI3").single(), "load building");
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "B1002").single(), "load B1002");
if (Number(unit.area_sqm) !== 54.99) throw new Error(`Unexpected B1002 area: ${unit.area_sqm}`);
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).eq("status", "active").single(), "load B1002 sale");
if (Number(sale.total_amount_xof) !== 66_000_000) throw new Error(`Unexpected B1002 sale total: ${sale.total_amount_xof}`);
const henry = await checked(supabase.from("customers").select("id, name").eq("id", sale.customer_id).single(), "load HENRY");
if (henry.name !== "HENRY") throw new Error(`Unexpected B1002 buyer: ${henry.name}`);

async function customerId(name) {
  const rows = await checked(supabase.from("customers").select("id").eq("name", name), `find customer ${name}`);
  if (rows.length > 1) throw new Error(`Duplicate customer ${name}`);
  return rows[0]?.id ?? (await checked(supabase.from("customers").insert({ name, notes: "来源：3号公寓.xlsx；3# B1002历史租户。", is_blacklisted: false }).select("id").single(), `insert customer ${name}`)).id;
}
async function upsertLease({ customerId: tenantId, contractNo, start, end, deposit, signer, paidThrough }) {
  const rows = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id).eq("contract_no", contractNo), `find ${contractNo}`);
  if (rows.length > 1) throw new Error(`Duplicate lease ${contractNo}`);
  const payload = { unit_id: unit.id, customer_id: tenantId, contract_no: contractNo, start_date: start, expected_end_date: end, actual_end_date: end, payment_cycle: "semiannual", payment_day: Number(start.slice(-2)), monthly_rent_xof: 500_000, deposit_amount_xof: deposit, deposit_received: true, rent_free_days: 0, signer_name: signer, attachment_url: null, status: "terminated", expected_end_confirmed: true, paid_through_date: paidThrough };
  return rows.length ? (await checked(supabase.from("lease_contracts").update(payload).eq("id", rows[0].id).select("id").single(), `update ${contractNo}`)).id : (await checked(supabase.from("lease_contracts").insert(payload).select("id").single(), `insert ${contractNo}`)).id;
}
async function upsertPayment({ customerId: payerId, sourceId, sourceType, receiptNo, legacyReceiptNo, date, amount, direction, category, notes }) {
  let rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (!rows.length && legacyReceiptNo) rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", legacyReceiptNo), `find ${legacyReceiptNo}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const payload = { customer_id: payerId, unit_id: unit.id, source_type: sourceType, source_id: sourceId, payment_date: date, amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
  const paymentId = rows.length ? (await checked(supabase.from("payments").update(payload).eq("id", rows[0].id).select("id").single(), `update ${receiptNo}`)).id : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledger = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: date, direction, category, amount_xof: amount, amount_cny: null, description: notes };
  if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), `update ledger ${receiptNo}`); else await checked(supabase.from("ledger_entries").insert(ledger), `insert ledger ${receiptNo}`);
}
async function upsertReceivable({ customerId: tenantId, sourceId, category, title, dueDate, amount, notes }) {
  const rows = await checked(supabase.from("receivables").select("id").eq("source_id", sourceId).eq("category", category).neq("status", "cancelled"), `find receivable ${title}`);
  if (rows.length > 1) throw new Error(`Duplicate receivable ${title}`);
  const payload = { building_id: building.id, unit_id: unit.id, customer_id: tenantId, source_type: category.startsWith("sale_") || category === "other" ? "sale_contract" : "lease_contract", source_id: sourceId, category, title, due_date: dueDate, amount_xof: amount, paid_amount_xof: amount, status: "paid", currency: "XOF", notes };
  if (rows.length) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update receivable ${title}`); else await checked(supabase.from("receivables").insert(payload), `insert receivable ${title}`);
}

const tangId = await customerId("唐威");
const tangNotes = "来源：3号公寓.xlsx；B1002唐威历史租约，2021-01-15至2022-04-14，月租50万FCFA；租金合计750万、物业费35万、押金100万；用户确认押金已退，实际退款日期未知，以退租日2022-04-14作账务日期；已清。";
const tangLeaseId = await upsertLease({ customerId: tangId, contractNo: "WB-LEASE-SACSI3-B1002-20210115-TANGWEI", start: "2021-01-15", end: "2022-04-14", deposit: 1_000_000, signer: "唐威", paidThrough: "2022-04-14" });
const tangPayments = [
  ["2021-01-15", 1_000_000, "lease_deposit", "DEPOSIT-01", "liability_in", "lease_deposit"], ["2021-01-15", 3_000_000, "lease_rent", "RENT-01", "income", "lease_rent"],
  ["2021-07-23", 1_000_000, "lease_rent", "RENT-02", "income", "lease_rent"], ["2021-10-21", 3_000_000, "lease_rent", "RENT-03", "income", "lease_rent"],
  ["2021-10-30", 300_000, "property_fee", "PROPERTY-01", "income", "property_fee"], ["2022-04-02", 500_000, "lease_rent", "RENT-04", "income", "lease_rent"],
  ["2022-04-02", 50_000, "property_fee", "PROPERTY-02", "income", "property_fee"], ["2022-04-14", 1_000_000, "lease_deposit_refund", "DEPREF-01", "liability_out", "lease_deposit_refund"],
];
for (const [date, amount, type, code, direction, category] of tangPayments) await upsertPayment({ customerId: tangId, sourceId: tangLeaseId, sourceType: type, receiptNo: `WB3-LEASE-B1002-TANG-${date.replaceAll("-", "")}-${code}`, date, amount, direction, category, notes: tangNotes });
await upsertReceivable({ customerId: tangId, sourceId: tangLeaseId, category: "lease_rent", title: "3# B1002唐威历史租金", dueDate: "2022-04-14", amount: 7_500_000, notes: tangNotes });
await upsertReceivable({ customerId: tangId, sourceId: tangLeaseId, category: "lease_deposit", title: "3# B1002唐威历史押金", dueDate: "2021-01-15", amount: 1_000_000, notes: `${tangNotes} 押金已全额退还。` });
await upsertReceivable({ customerId: tangId, sourceId: tangLeaseId, category: "property_fee", title: "3# B1002唐威历史物业费", dueDate: "2022-04-14", amount: 350_000, notes: tangNotes });

const zhongId = await customerId("中轻淡真健");
const zhongNotes = "来源：3号公寓.xlsx；B1002租户名称按Excel原文登记为‘中轻淡真健’；租期按连续缴费覆盖期登记为2022-04-17至2024-12-16，月租50万FCFA；租金合计1600万、物业费80万、押金100万；2025-01-16押金已退、已清。";
const zhongLeaseId = await upsertLease({ customerId: zhongId, contractNo: "WB-LEASE-SACSI3-B1002-20220417-ZHONGQING", start: "2022-04-17", end: "2024-12-16", deposit: 1_000_000, signer: "中轻淡真健", paidThrough: "2024-12-16" });
const zhongBatches = [["2022-04-19", 3_000_000, 150_000], ["2022-09-29", 3_000_000, 150_000], ["2023-04-07", 3_000_000, 150_000], ["2023-10-28", 3_000_000, 150_000], ["2024-05-18", 3_000_000, 150_000], ["2024-10-17", 1_000_000, 50_000]];
await upsertPayment({ customerId: zhongId, sourceId: zhongLeaseId, sourceType: "lease_deposit", receiptNo: "WB3-LEASE-B1002-ZHONG-20220419-DEPOSIT-01", date: "2022-04-19", amount: 1_000_000, direction: "liability_in", category: "lease_deposit", notes: zhongNotes });
for (let index = 0; index < zhongBatches.length; index += 1) {
  const [date, rent, property] = zhongBatches[index]; const suffix = String(index + 1).padStart(2, "0");
  await upsertPayment({ customerId: zhongId, sourceId: zhongLeaseId, sourceType: "lease_rent", receiptNo: `WB3-LEASE-B1002-ZHONG-${date.replaceAll("-", "")}-RENT-${suffix}`, date, amount: rent, direction: "income", category: "lease_rent", notes: zhongNotes });
  await upsertPayment({ customerId: zhongId, sourceId: zhongLeaseId, sourceType: "property_fee", receiptNo: `WB3-LEASE-B1002-ZHONG-${date.replaceAll("-", "")}-PROPERTY-${suffix}`, date, amount: property, direction: "income", category: "property_fee", notes: zhongNotes });
}
await upsertPayment({ customerId: zhongId, sourceId: zhongLeaseId, sourceType: "lease_deposit_refund", receiptNo: "WB3-LEASE-B1002-ZHONG-20250116-DEPREF-01", date: "2025-01-16", amount: 1_000_000, direction: "liability_out", category: "lease_deposit_refund", notes: zhongNotes });
await upsertReceivable({ customerId: zhongId, sourceId: zhongLeaseId, category: "lease_rent", title: "3# B1002中轻淡真健历史租金", dueDate: "2024-12-16", amount: 16_000_000, notes: zhongNotes });
await upsertReceivable({ customerId: zhongId, sourceId: zhongLeaseId, category: "lease_deposit", title: "3# B1002中轻淡真健历史押金", dueDate: "2022-04-19", amount: 1_000_000, notes: `${zhongNotes} 押金已全额退还。` });
await upsertReceivable({ customerId: zhongId, sourceId: zhongLeaseId, category: "property_fee", title: "3# B1002中轻淡真健历史物业费", dueDate: "2024-12-16", amount: 800_000, notes: zhongNotes });

const saleNotes = "来源：3号公寓.xlsx；B1002买方HENRY；合同总价6600万FCFA；2022-10-18支票支付600万、另付6000万，已结清。";
const taxNotes = "来源：3号公寓.xlsx；B1002于2022-10-18实际收税款150万FCFA，Excel记‘本税已报当月’；按实际金额登记，不计入合同总价。";
await checked(supabase.from("sale_contracts").update({ signed_date: "2022-10-18", payment_plan_type: "installment" }).eq("id", sale.id), "update B1002 sale");
await upsertPayment({ customerId: henry.id, sourceId: sale.id, sourceType: "sale_contract", receiptNo: "WB3-SALE-1002-20221018-HOUSE-01", legacyReceiptNo: "S3-SALE-B1002-CONSOLIDATED", date: "2022-10-18", amount: 6_000_000, direction: "income", category: "sale", notes: `${saleNotes} 本笔支付方式：支票。` });
await upsertPayment({ customerId: henry.id, sourceId: sale.id, sourceType: "sale_contract", receiptNo: "WB3-SALE-1002-20221018-HOUSE-02", date: "2022-10-18", amount: 60_000_000, direction: "income", category: "sale", notes: saleNotes });
await upsertPayment({ customerId: henry.id, sourceId: sale.id, sourceType: "sale_other_income", receiptNo: "WB3-SALE-1002-20221018-TRANSFER-TAX-01", date: "2022-10-18", amount: 1_500_000, direction: "income", category: "sale_transfer_tax", notes: taxNotes });
await upsertReceivable({ customerId: henry.id, sourceId: sale.id, category: "sale_installment", title: "3# B1002购房款", dueDate: "2022-10-18", amount: 66_000_000, notes: saleNotes });
await upsertReceivable({ customerId: henry.id, sourceId: sale.id, category: "other", title: "3# B1002实际税款", dueDate: "2022-10-18", amount: 1_500_000, notes: taxNotes });

const payoutNotes = "来源：3号公寓.xlsx；B1002出售给HENRY后，房东领取代租租金；作为房东取款支出单列，不冲减租金收入，也不并入购房款。";
const payouts = [["2022-11-07", 1_350_000], ["2023-02-17", 1_350_000], ["2023-05-13", 1_350_000], ["2023-08-09", 1_500_000], ["2023-11-09", 1_500_000], ["2024-02-13", 1_500_000], ["2024-05-22", 1_500_000], ["2024-08-21", 1_500_000], ["2024-11-13", 1_000_000]];
for (let index = 0; index < payouts.length; index += 1) { const [date, amount] = payouts[index]; await upsertPayment({ customerId: henry.id, sourceId: zhongLeaseId, sourceType: "lease_other_expense", receiptNo: `WB3-LEASE-B1002-${date.replaceAll("-", "")}-OWNER-PAYOUT-${String(index + 1).padStart(2, "0")}`, date, amount, direction: "expense", category: "lease_other_expense", notes: payoutNotes }); }

const unitNotes = "来源：3号公寓.xlsx；B1002买方HENRY，2022-10-18两笔房款合计6600万FCFA已结清，实际税款150万单列。唐威历史租金750万、物业费35万、押金100万已退；中轻淡真健历史租金1600万、物业费80万、押金100万已退；两份租约均已终止。出售后房东取租9笔合计1255万作为支出单列。详细日期见合同、付款及审计记录；注册金、FULO提成和过户状态未记。";
await checked(supabase.from("units").update({ status: "sold", notes: unitNotes }).eq("id", unit.id), "update B1002 unit");
const [tangVerified, zhongVerified, saleVerified] = await Promise.all([checked(supabase.from("payments").select("source_type, amount").eq("source_id", tangLeaseId), "verify Tang"), checked(supabase.from("payments").select("source_type, amount").eq("source_id", zhongLeaseId), "verify Zhong"), checked(supabase.from("payments").select("source_type, amount").eq("source_id", sale.id), "verify sale")]);
const total = (rows, type) => rows.filter((row) => row.source_type === type).reduce((sum, row) => sum + Number(row.amount), 0);
if (tangVerified.length !== 8 || total(tangVerified, "lease_rent") !== 7_500_000 || total(tangVerified, "property_fee") !== 350_000 || total(tangVerified, "lease_deposit_refund") !== 1_000_000) throw new Error("Unexpected Tang totals");
if (zhongVerified.length !== 23 || total(zhongVerified, "lease_rent") !== 16_000_000 || total(zhongVerified, "property_fee") !== 800_000 || total(zhongVerified, "lease_deposit_refund") !== 1_000_000 || total(zhongVerified, "lease_other_expense") !== 12_550_000) throw new Error("Unexpected Zhong totals");
if (saleVerified.length !== 3 || total(saleVerified, "sale_contract") !== 66_000_000 || total(saleVerified, "sale_other_income") !== 1_500_000) throw new Error("Unexpected sale totals");
await checked(supabase.from("audit_logs").insert({ action: "reconcile_sacsi3_b1002", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI3", unit_no: "B1002", tang_wei: { rent_xof: 7_500_000, property_fee_xof: 350_000, deposit_xof: 1_000_000, deposit_refunded: true, refund_date_pending: true, accounting_date: "2022-04-14", status: "terminated" }, zhongqing: { raw_name: "中轻淡真健", rent_xof: 16_000_000, property_fee_xof: 800_000, deposit_xof: 1_000_000, deposit_refund_date: "2025-01-16", status: "terminated" }, sale: { buyer: "HENRY", total_xof: 66_000_000, settled: true, actual_tax_xof: 1_500_000 }, owner_payout: { count: 9, amount_xof: 12_550_000 } } }), "write B1002 audit");
console.log(JSON.stringify({ ok: true, unit: "B1002", tang_deposit_refunded: true, sale_settled: true, owner_payout_xof: 12_550_000 }));
