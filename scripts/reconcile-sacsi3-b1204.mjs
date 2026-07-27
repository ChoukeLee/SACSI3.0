import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(query, label) { const { data, error } = await query; if (error) throw new Error(`${label}: ${error.message}`); return data; }

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI3").single(), "load building");
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "B1204").single(), "load B1204");
if (Number(unit.area_sqm) !== 173.51) throw new Error(`Unexpected B1204 area: ${unit.area_sqm}`);

async function customerId(name, notes) {
  const rows = await checked(supabase.from("customers").select("id").eq("name", name), `find customer ${name}`);
  if (rows.length > 1) throw new Error(`Duplicate customer ${name}`);
  return rows[0]?.id ?? (await checked(supabase.from("customers").insert({ name, notes, is_blacklisted: false }).select("id").single(), `insert customer ${name}`)).id;
}
async function upsertLease({ customerId: tenantId, contractNo, start, end, monthlyRent, deposit, signer, status, endConfirmed, paidThrough }) {
  const rows = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id).eq("contract_no", contractNo), `find ${contractNo}`);
  if (rows.length > 1) throw new Error(`Duplicate lease ${contractNo}`);
  const payload = { unit_id: unit.id, customer_id: tenantId, contract_no: contractNo, start_date: start, expected_end_date: end, actual_end_date: status === "terminated" ? end : null, payment_cycle: "quarterly", payment_day: Number(start.slice(-2)), monthly_rent_xof: monthlyRent, deposit_amount_xof: deposit, deposit_received: deposit > 0, rent_free_days: 0, signer_name: signer, attachment_url: null, status, expected_end_confirmed: endConfirmed, paid_through_date: paidThrough };
  return rows.length ? (await checked(supabase.from("lease_contracts").update(payload).eq("id", rows[0].id).select("id").single(), `update ${contractNo}`)).id : (await checked(supabase.from("lease_contracts").insert(payload).select("id").single(), `insert ${contractNo}`)).id;
}
async function upsertPayment({ customerId: tenantId, sourceId, sourceType, receiptNo, date, amount, direction, category, notes }) {
  const rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const payload = { customer_id: tenantId, unit_id: unit.id, source_type: sourceType, source_id: sourceId, payment_date: date, amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
  const paymentId = rows.length ? (await checked(supabase.from("payments").update(payload).eq("id", rows[0].id).select("id").single(), `update ${receiptNo}`)).id : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledger = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: date, direction, category, amount_xof: amount, amount_cny: null, description: notes };
  if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), `update ledger ${receiptNo}`); else await checked(supabase.from("ledger_entries").insert(ledger), `insert ledger ${receiptNo}`);
}
async function upsertReceivable({ customerId: tenantId, sourceId, category, title, dueDate, amount, paid, status, notes }) {
  const rows = await checked(supabase.from("receivables").select("id").eq("source_id", sourceId).eq("category", category).neq("status", "cancelled"), `find receivable ${title}`);
  if (rows.length > 1) throw new Error(`Duplicate receivable ${title}`);
  const payload = { building_id: building.id, unit_id: unit.id, customer_id: tenantId, source_type: "lease_contract", source_id: sourceId, category, title, due_date: dueDate, amount_xof: amount, paid_amount_xof: paid, status, currency: "XOF", notes };
  if (rows.length) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update receivable ${title}`); else await checked(supabase.from("receivables").insert(payload), `insert receivable ${title}`);
}

const obrouId = await customerId("OBROU", "来源：3号公寓.xlsx；3# B1204历史租户。");
const obrouNotes = "来源：3号公寓.xlsx；B1204 OBROU历史租约，2021-04-29至2022-04-30，月租120万FCFA；2021-04-24收押金240万和三个月租金360万；2022-02-22记‘368万、5706欧’，经用户确认为同一笔款，按Excel结构化金额368万FCFA登记，5706 EUR仅保留作原币说明，不重复相加；2022-03-11收租金500万；Excel明确仍欠220万，保留欠款；押金240万未退。";
const obrouLeaseId = await upsertLease({ customerId: obrouId, contractNo: "WB-LEASE-SACSI3-B1204-20210429-OBROU", start: "2021-04-29", end: "2022-04-30", monthlyRent: 1_200_000, deposit: 2_400_000, signer: "OBROU", status: "terminated", endConfirmed: true, paidThrough: null });
const obrouPayments = [["2021-04-24", 2_400_000, "lease_deposit", "DEPOSIT-01", "liability_in", "lease_deposit"], ["2021-04-24", 3_600_000, "lease_rent", "RENT-01", "income", "lease_rent"], ["2022-02-22", 3_680_000, "lease_rent", "RENT-02", "income", "lease_rent"], ["2022-03-11", 5_000_000, "lease_rent", "RENT-03", "income", "lease_rent"]];
for (const [date, amount, type, code, direction, category] of obrouPayments) await upsertPayment({ customerId: obrouId, sourceId: obrouLeaseId, sourceType: type, receiptNo: `WB3-LEASE-B1204-OBROU-${date.replaceAll("-", "")}-${code}`, date, amount, direction, category, notes: obrouNotes });
await upsertReceivable({ customerId: obrouId, sourceId: obrouLeaseId, category: "lease_rent", title: "3# B1204 OBROU历史租金及欠款", dueDate: "2022-04-30", amount: 14_480_000, paid: 12_280_000, status: "partial", notes: `${obrouNotes} 应收按三笔实收1228万加Excel明确欠款220万合计1448万登记。` });
await upsertReceivable({ customerId: obrouId, sourceId: obrouLeaseId, category: "lease_deposit", title: "3# B1204 OBROU历史押金", dueDate: "2021-04-24", amount: 2_400_000, paid: 2_400_000, status: "paid", notes: `${obrouNotes} 押金处置待核实。` });

const huaweiId = await customerId("华为", "来源：3号公寓.xlsx；3#多间房历史租户。");
const huaweiNotes = "来源：3号公寓.xlsx；B1204华为于2022-09-22入住，2026-06-16退租；租金、押金及付款记录缺失；因数据库金额字段不能为空，月租0仅作待补占位，不代表免租；合同按已终止登记。";
const huaweiLeaseId = await upsertLease({ customerId: huaweiId, contractNo: "WB-LEASE-SACSI3-B1204-20220922-HUAWEI", start: "2022-09-22", end: "2026-06-16", monthlyRent: 0, deposit: 0, signer: "华为", status: "terminated", endConfirmed: true, paidThrough: null });

const fuqiId = await customerId("福气", "来源：3号公寓.xlsx；3# B1204当前租户。");
const fuqiNotes = "来源：3号公寓.xlsx；B1204当前租户福气，月租130万FCFA；2026-07-13付定金200万、2026-07-20付余款450万，合计650万；经用户确认按押二付三拆为押金260万、三个月租金390万；Excel未记正式起止日，以余款日2026-07-20推算合同开始，暂登记至2026-10-19，日期为推断。";
const fuqiLeaseId = await upsertLease({ customerId: fuqiId, contractNo: "WB-LEASE-SACSI3-B1204-20260720-FUQI", start: "2026-07-20", end: "2026-10-19", monthlyRent: 1_300_000, deposit: 2_600_000, signer: "福气", status: "active", endConfirmed: false, paidThrough: "2026-10-19" });
await upsertPayment({ customerId: fuqiId, sourceId: fuqiLeaseId, sourceType: "lease_deposit", receiptNo: "WB3-LEASE-B1204-FUQI-20260713-DEPOSIT-01", date: "2026-07-13", amount: 2_000_000, direction: "liability_in", category: "lease_deposit", notes: `${fuqiNotes} 本笔作为押金首付款。` });
await upsertPayment({ customerId: fuqiId, sourceId: fuqiLeaseId, sourceType: "lease_deposit", receiptNo: "WB3-LEASE-B1204-FUQI-20260720-DEPOSIT-02", date: "2026-07-20", amount: 600_000, direction: "liability_in", category: "lease_deposit", notes: `${fuqiNotes} 本笔由450万余款中拆出押金尾款60万。` });
await upsertPayment({ customerId: fuqiId, sourceId: fuqiLeaseId, sourceType: "lease_rent", receiptNo: "WB3-LEASE-B1204-FUQI-20260720-RENT-01", date: "2026-07-20", amount: 3_900_000, direction: "income", category: "lease_rent", notes: `${fuqiNotes} 本笔由450万余款中拆出三个月租金390万，缴至2026-10-19。` });
await upsertReceivable({ customerId: fuqiId, sourceId: fuqiLeaseId, category: "lease_deposit", title: "3# B1204福气租赁押金", dueDate: "2026-07-20", amount: 2_600_000, paid: 2_600_000, status: "paid", notes: fuqiNotes });
await upsertReceivable({ customerId: fuqiId, sourceId: fuqiLeaseId, category: "lease_rent", title: "3# B1204福气三个月租金", dueDate: "2026-07-20", amount: 3_900_000, paid: 3_900_000, status: "paid", notes: fuqiNotes });
await checked(supabase.from("units").update({ status: "leased", notes: `当前：${fuqiNotes}\n历史：${huaweiNotes}\n历史：${obrouNotes}` }).eq("id", unit.id), "update B1204 unit");

const [obrouPaymentsVerified, obrouReceivable, fuqiPayments, leases] = await Promise.all([checked(supabase.from("payments").select("source_type, amount").eq("source_id", obrouLeaseId), "verify OBROU payments"), checked(supabase.from("receivables").select("amount_xof, paid_amount_xof, status").eq("source_id", obrouLeaseId).eq("category", "lease_rent").single(), "verify OBROU receivable"), checked(supabase.from("payments").select("source_type, amount").eq("source_id", fuqiLeaseId), "verify Fuqi payments"), checked(supabase.from("lease_contracts").select("id, status, paid_through_date").in("id", [obrouLeaseId, huaweiLeaseId, fuqiLeaseId]), "verify B1204 leases")]);
const sum = (rows, type) => rows.filter((row) => row.source_type === type).reduce((total, row) => total + Number(row.amount), 0);
if (obrouPaymentsVerified.length !== 4 || sum(obrouPaymentsVerified, "lease_rent") !== 12_280_000 || sum(obrouPaymentsVerified, "lease_deposit") !== 2_400_000 || Number(obrouReceivable.amount_xof) - Number(obrouReceivable.paid_amount_xof) !== 2_200_000 || obrouReceivable.status !== "partial") throw new Error("Unexpected OBROU state");
if (fuqiPayments.length !== 3 || sum(fuqiPayments, "lease_deposit") !== 2_600_000 || sum(fuqiPayments, "lease_rent") !== 3_900_000) throw new Error("Unexpected Fuqi totals");
if (leases.filter((lease) => lease.status === "terminated").length !== 2 || leases.filter((lease) => lease.status === "active" && lease.paid_through_date === "2026-10-19").length !== 1) throw new Error("Unexpected B1204 lease states");
await checked(supabase.from("audit_logs").insert({ action: "reconcile_sacsi3_b1204", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI3", unit_no: "B1204", obrou: { start: "2021-04-29", end: "2022-04-30", monthly_rent_xof: 1_200_000, rent_paid_xof: 12_280_000, outstanding_xof: 2_200_000, deposit_xof: 2_400_000, deposit_disposition: "pending", eur_5706_is_same_payment_as_xof_3_680_000_not_additional: true, status: "terminated" }, huawei: { start: "2022-09-22", end: "2026-06-16", finance_pending: true, zero_rent_is_placeholder_not_free: true, status: "terminated" }, fuqi: { inferred_start: "2026-07-20", inferred_end: "2026-10-19", date_inferred: true, monthly_rent_xof: 1_300_000, deposit_xof: 2_600_000, rent_xof: 3_900_000, paid_through: "2026-10-19", status: "active" } } }), "write B1204 audit");
console.log(JSON.stringify({ ok: true, unit: "B1204", obrou_outstanding_xof: 2_200_000, obrou_deposit_pending_xof: 2_400_000, huawei_status: "terminated", current_tenant: "福气", paid_through: "2026-10-19" }));
