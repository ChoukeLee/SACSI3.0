import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(query, label) { const { data, error } = await query; if (error) throw new Error(`${label}: ${error.message}`); return data; }

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI3").single(), "load building");
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "B901").single(), "load B901");
if (Number(unit.area_sqm) !== 173.51) throw new Error(`Unexpected B901 area: ${unit.area_sqm}`);
const current = await checked(supabase.from("lease_contracts").select("id, customer_id, monthly_rent_xof").eq("unit_id", unit.id).eq("status", "active").single(), "load current B901 lease");
if (Number(current.monthly_rent_xof) !== 1_800_000) throw new Error("Unexpected current B901 rent");
const fang = await checked(supabase.from("customers").select("id, name").eq("id", current.customer_id).single(), "load Fang Dan");
if (fang.name !== "房丹") throw new Error(`Unexpected current tenant: ${fang.name}`);

async function customerId(name, notes) {
  const rows = await checked(supabase.from("customers").select("id").eq("name", name), `find customer ${name}`);
  if (rows.length > 1) throw new Error(`Duplicate customer ${name}`);
  return rows[0]?.id ?? (await checked(supabase.from("customers").insert({ name, notes, is_blacklisted: false }).select("id").single(), `insert customer ${name}`)).id;
}
async function upsertLease({ contractNo, customerId: tenantId, start, end, monthlyRent, deposit, signer, endConfirmed, paidThrough }) {
  const rows = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id).eq("contract_no", contractNo), `find ${contractNo}`);
  if (rows.length > 1) throw new Error(`Duplicate lease ${contractNo}`);
  const payload = { unit_id: unit.id, customer_id: tenantId, contract_no: contractNo, start_date: start, expected_end_date: end, actual_end_date: end, payment_cycle: "semiannual", payment_day: Number(start.slice(-2)), monthly_rent_xof: monthlyRent, deposit_amount_xof: deposit, deposit_received: deposit > 0, rent_free_days: 0, signer_name: signer, attachment_url: null, status: "terminated", expected_end_confirmed: endConfirmed, paid_through_date: paidThrough };
  return rows.length ? (await checked(supabase.from("lease_contracts").update(payload).eq("id", rows[0].id).select("id").single(), `update ${contractNo}`)).id : (await checked(supabase.from("lease_contracts").insert(payload).select("id").single(), `insert ${contractNo}`)).id;
}
async function upsertPayment({ tenantId, sourceId, sourceType, date, amount, currency = "XOF", rate = 1, amountXof, receiptNo, direction, category, notes }) {
  const rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const payload = { customer_id: tenantId, unit_id: unit.id, source_type: sourceType, source_id: sourceId, payment_date: date, amount, currency, exchange_rate_to_xof: rate, receipt_no: receiptNo, notes };
  const paymentId = rows.length ? (await checked(supabase.from("payments").update(payload).eq("id", rows[0].id).select("id").single(), `update ${receiptNo}`)).id : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledger = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: date, direction, category, amount_xof: amountXof, amount_cny: currency === "CNY" ? amount : null, description: notes };
  if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), `update ledger ${receiptNo}`); else await checked(supabase.from("ledger_entries").insert(ledger), `insert ledger ${receiptNo}`);
}
async function upsertReceivable({ tenantId, sourceId, category, title, dueDate, amount, notes }) {
  const rows = await checked(supabase.from("receivables").select("id").eq("source_id", sourceId).eq("category", category).neq("status", "cancelled"), `find receivable ${title}`);
  if (rows.length > 1) throw new Error(`Duplicate receivable ${title}`);
  const payload = { building_id: building.id, unit_id: unit.id, customer_id: tenantId, source_type: "lease_contract", source_id: sourceId, category, title, due_date: dueDate, amount_xof: amount, paid_amount_xof: amount, status: "paid", currency: "XOF", notes };
  if (rows.length) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update receivable ${title}`); else await checked(supabase.from("receivables").insert(payload), `insert receivable ${title}`);
}

const huaweiId = await customerId("华为", "来源：3号公寓.xlsx；3#多间房历史租户。");
const huaweiNotes = "来源：3号公寓.xlsx；B901华为于2020-12-01入住，2024-09-20退房；租金、押金及付款记录缺失；因数据库金额字段不能为空，月租0仅作待补占位，不代表免租；合同按已终止登记。";
const huaweiLeaseId = await upsertLease({ contractNo: "WB-LEASE-SACSI3-B901-20201201-HUAWEI", customerId: huaweiId, start: "2020-12-01", end: "2024-09-20", monthlyRent: 0, deposit: 0, signer: "华为", endConfirmed: true, paidThrough: null });

const xiaoId = await customerId("肖勇", "来源：3号公寓.xlsx；3# B901历史租户。");
const xiaoNotes = "来源：3号公寓.xlsx；B901肖勇租期2024-09-22至2026-03-22，月租120万FCFA；三期各覆盖六个月；租金合计2160万、物业费合计97.4万；押金240万；Excel记‘退房已清’，按押金已退处理，实际退款日期未知，以合同结束日作账务日期。";
const xiaoLeaseId = await upsertLease({ contractNo: "WB-LEASE-SACSI3-B901-20240922-XIAOYONG", customerId: xiaoId, start: "2024-09-22", end: "2026-03-22", monthlyRent: 1_200_000, deposit: 2_400_000, signer: "肖勇", endConfirmed: true, paidThrough: "2026-03-22" });
const xiaoPayments = [
  ["2024-09-21", 2_400_000, "lease_deposit", "DEPOSIT-01", "liability_in", "lease_deposit", "押金240万FCFA。"],
  ["2024-09-21", 7_200_000, "lease_rent", "RENT-01", "income", "lease_rent", "六个月租金720万FCFA，已缴至2025-03-22。"],
  ["2024-09-21", 398_000, "property_fee", "PROPERTY-01", "income", "property_fee", "首期六个月物业费39.8万FCFA。"],
  ["2025-04-14", 7_200_000, "lease_rent", "RENT-02", "income", "lease_rent", "六个月租金720万FCFA，已缴至2025-09-22。"],
  ["2025-04-14", 288_000, "property_fee", "PROPERTY-02", "income", "property_fee", "六个月物业费28.8万FCFA。"],
  ["2025-09-30", 7_200_000, "lease_rent", "RENT-03", "income", "lease_rent", "六个月租金720万FCFA，已缴至2026-03-22。"],
  ["2025-09-30", 288_000, "property_fee", "PROPERTY-03", "income", "property_fee", "六个月物业费28.8万FCFA。"],
  ["2026-03-22", 2_400_000, "lease_deposit_refund", "DEPREF-01", "liability_out", "lease_deposit_refund", "押金240万FCFA已退；实际退款日期未知，以合同结束日作账务日期。"],
];
for (const [date, amount, sourceType, code, direction, category, detail] of xiaoPayments) await upsertPayment({ tenantId: xiaoId, sourceId: xiaoLeaseId, sourceType, date, amount, amountXof: amount, receiptNo: `WB3-LEASE-B901-${date.replaceAll("-", "")}-${code}`, direction, category, notes: `${xiaoNotes} ${detail}` });
await upsertReceivable({ tenantId: xiaoId, sourceId: xiaoLeaseId, category: "lease_rent", title: "3# B901肖勇历史租金", dueDate: "2026-03-22", amount: 21_600_000, notes: xiaoNotes });
await upsertReceivable({ tenantId: xiaoId, sourceId: xiaoLeaseId, category: "lease_deposit", title: "3# B901肖勇历史押金", dueDate: "2024-09-21", amount: 2_400_000, notes: `${xiaoNotes} 押金已全额退还。` });
await upsertReceivable({ tenantId: xiaoId, sourceId: xiaoLeaseId, category: "property_fee", title: "3# B901肖勇历史物业费", dueDate: "2026-03-22", amount: 974_000, notes: xiaoNotes });

const currentNo = "WB-LEASE-SACSI3-B901-20260401-FANGDAN";
const currentNotes = "来源：3号公寓.xlsx；B901当前租户房丹；2026-04-01至2026-09-30；月租180万FCFA；2026-03-26付押金人民币45000元，折合360万FCFA；2026-03-31付六个月租金人民币135000元，折合1080万FCFA；汇率1 CNY=80 FCFA；已缴至2026-09-30。";
await checked(supabase.from("lease_contracts").update({ contract_no: currentNo, start_date: "2026-04-01", expected_end_date: "2026-09-30", payment_cycle: "semiannual", payment_day: 1, monthly_rent_xof: 1_800_000, deposit_amount_xof: 3_600_000, deposit_received: true, status: "active", expected_end_confirmed: true, paid_through_date: "2026-09-30" }).eq("id", current.id), "update current B901 lease");
const currentPaymentSpecs = [
  ["S3-LEASE-B901-DEP", "WB3-LEASE-B901-20260326-DEPOSIT-01", "2026-03-26", 45_000, 3_600_000, "lease_deposit", "liability_in", "lease_deposit"],
  ["S3-LEASE-B901-RENT", "WB3-LEASE-B901-20260331-RENT-01", "2026-03-31", 135_000, 10_800_000, "lease_rent", "income", "lease_rent"],
];
for (const [legacyReceipt, receiptNo, date, amountCny, amountXof, sourceType, direction, category] of currentPaymentSpecs) {
  const rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).in("receipt_no", [legacyReceipt, receiptNo]), `find ${receiptNo}`);
  if (rows.length !== 1) throw new Error(`Unexpected current payment ${receiptNo}`);
  const paymentId = rows[0].id;
  await checked(supabase.from("payments").update({ customer_id: fang.id, source_type: sourceType, source_id: current.id, payment_date: date, amount: amountCny, currency: "CNY", exchange_rate_to_xof: 80, receipt_no: receiptNo, notes: currentNotes }).eq("id", paymentId), `update ${receiptNo}`);
  const ledgerRows = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgerRows.length !== 1) throw new Error(`Unexpected current ledger ${receiptNo}`);
  await checked(supabase.from("ledger_entries").update({ entry_date: date, direction, category, amount_xof: amountXof, amount_cny: amountCny, description: currentNotes }).eq("id", ledgerRows[0].id), `update ledger ${receiptNo}`);
}
await checked(supabase.from("receivables").update({ title: "3# B901房丹六个月租金", due_date: "2026-03-31", amount_xof: 10_800_000, paid_amount_xof: 10_800_000, status: "paid", currency: "XOF", notes: currentNotes }).eq("source_id", current.id).eq("category", "lease_rent").neq("status", "cancelled"), "update current rent receivable");
await checked(supabase.from("receivables").update({ title: "3# B901房丹租赁押金", due_date: "2026-03-26", amount_xof: 3_600_000, paid_amount_xof: 3_600_000, status: "paid", currency: "XOF", notes: currentNotes }).eq("source_id", current.id).eq("category", "lease_deposit").neq("status", "cancelled"), "update current deposit receivable");
await checked(supabase.from("units").update({ status: "leased", notes: `${currentNotes}\n历史：${huaweiNotes}\n历史：${xiaoNotes}` }).eq("id", unit.id), "update B901 unit");

const [xiaoVerified, currentVerified, leasesVerified] = await Promise.all([
  checked(supabase.from("payments").select("source_type, amount").eq("source_id", xiaoLeaseId), "verify Xiao payments"),
  checked(supabase.from("payments").select("source_type, amount, currency, exchange_rate_to_xof").eq("source_id", current.id), "verify current payments"),
  checked(supabase.from("lease_contracts").select("id, status").in("id", [huaweiLeaseId, xiaoLeaseId, current.id]), "verify B901 leases"),
]);
const sum = (rows, type) => rows.filter((row) => row.source_type === type).reduce((total, row) => total + Number(row.amount), 0);
if (xiaoVerified.length !== 8 || sum(xiaoVerified, "lease_rent") !== 21_600_000 || sum(xiaoVerified, "property_fee") !== 974_000 || sum(xiaoVerified, "lease_deposit") !== 2_400_000 || sum(xiaoVerified, "lease_deposit_refund") !== 2_400_000) throw new Error("Unexpected Xiao totals");
if (currentVerified.length !== 2 || currentVerified.some((row) => row.currency !== "CNY" || Number(row.exchange_rate_to_xof) !== 80) || currentVerified.reduce((total, row) => total + Number(row.amount), 0) !== 180_000) throw new Error("Unexpected Fang Dan totals");
if (leasesVerified.filter((lease) => lease.status === "terminated").length !== 2 || leasesVerified.filter((lease) => lease.status === "active").length !== 1) throw new Error("Unexpected B901 lease statuses");
await checked(supabase.from("audit_logs").insert({ action: "reconcile_sacsi3_b901", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI3", unit_no: "B901", huawei: { start: "2020-12-01", end: "2024-09-20", finance_pending: true, zero_rent_is_placeholder_not_free: true, status: "terminated" }, xiao_yong: { start: "2024-09-22", end: "2026-03-22", rent_xof: 21_600_000, property_fee_xof: 974_000, deposit_xof: 2_400_000, deposit_refund_xof: 2_400_000, refund_date_pending: true, accounting_date: "2026-03-22", settled: true, status: "terminated" }, fang_dan: { contract_no: currentNo, start: "2026-04-01", end: "2026-09-30", deposit_cny: 45_000, rent_cny: 135_000, exchange_rate_to_xof: 80, paid_through: "2026-09-30", status: "active" } } }), "write B901 audit log");
console.log(JSON.stringify({ ok: true, unit: "B901", huawei_finance_pending: true, xiao_settled: true, current_tenant: "房丹", current_paid_through: "2026-09-30" }));
