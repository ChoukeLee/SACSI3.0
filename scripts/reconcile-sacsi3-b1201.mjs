import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(query, label) { const { data, error } = await query; if (error) throw new Error(`${label}: ${error.message}`); return data; }

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI3").single(), "load building");
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "B1201").single(), "load B1201");
if (Number(unit.area_sqm) !== 173.51) throw new Error(`Unexpected B1201 area: ${unit.area_sqm}`);
const current = await checked(supabase.from("lease_contracts").select("id, customer_id, monthly_rent_xof").eq("unit_id", unit.id).eq("status", "active").single(), "load current B1201 lease");
if (Number(current.monthly_rent_xof) !== 1_800_000) throw new Error("Unexpected current B1201 rent");
const tenant = await checked(supabase.from("customers").select("id, name").eq("id", current.customer_id).single(), "load current tenant");
if (tenant.name !== "HAC WEST／周盼") throw new Error(`Unexpected current tenant: ${tenant.name}`);
const huaweiRows = await checked(supabase.from("customers").select("id").eq("name", "华为"), "load Huawei");
if (huaweiRows.length !== 1) throw new Error(`Unexpected Huawei customer count: ${huaweiRows.length}`);
const huaweiId = huaweiRows[0].id;

async function upsertPayment({ customerId, sourceId, sourceType, receiptNo, legacyReceiptNo, date, amount, direction, category, notes }) {
  let rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (!rows.length && legacyReceiptNo) rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", legacyReceiptNo), `find ${legacyReceiptNo}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const payload = { customer_id: customerId, unit_id: unit.id, source_type: sourceType, source_id: sourceId, payment_date: date, amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
  const paymentId = rows.length ? (await checked(supabase.from("payments").update(payload).eq("id", rows[0].id).select("id").single(), `update ${receiptNo}`)).id : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledger = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: date, direction, category, amount_xof: amount, amount_cny: null, description: notes };
  if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), `update ledger ${receiptNo}`); else await checked(supabase.from("ledger_entries").insert(ledger), `insert ledger ${receiptNo}`);
}

const huaweiContractNo = "WB-LEASE-SACSI3-B1201-20210515-HUAWEI";
const huaweiNotes = "来源：3号公寓.xlsx；B1201华为于2021-05-15入住，2024-09-20腾出；租金、押金及付款记录缺失；因数据库金额字段不能为空，月租0仅作待补占位，不代表免租；合同按已终止登记。";
let huaweiLeases = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id).eq("contract_no", huaweiContractNo), "find B1201 Huawei lease");
if (huaweiLeases.length > 1) throw new Error("Duplicate B1201 Huawei lease");
const huaweiPayload = { unit_id: unit.id, customer_id: huaweiId, contract_no: huaweiContractNo, start_date: "2021-05-15", expected_end_date: "2024-09-20", actual_end_date: "2024-09-20", payment_cycle: "monthly", payment_day: 15, monthly_rent_xof: 0, deposit_amount_xof: 0, deposit_received: false, rent_free_days: 0, signer_name: "华为", attachment_url: null, status: "terminated", expected_end_confirmed: true, paid_through_date: null };
const huaweiLeaseId = huaweiLeases.length ? (await checked(supabase.from("lease_contracts").update(huaweiPayload).eq("id", huaweiLeases[0].id).select("id").single(), "update B1201 Huawei lease")).id : (await checked(supabase.from("lease_contracts").insert(huaweiPayload).select("id").single(), "insert B1201 Huawei lease")).id;

const currentContractNo = "WB-LEASE-SACSI3-B1201-20250901-HACWEST";
const currentNotes = "来源：3号公寓.xlsx；B1201当前租户HAC WEST／周盼；合同期2025-09-01至2026-08-30，月租180万FCFA；押金360万；四笔租金各540万，合计2160万，覆盖12个月；已缴至2026-08-30，当前在租。";
await checked(supabase.from("lease_contracts").update({ contract_no: currentContractNo, start_date: "2025-09-01", expected_end_date: "2026-08-30", actual_end_date: null, payment_cycle: "quarterly", payment_day: 1, monthly_rent_xof: 1_800_000, deposit_amount_xof: 3_600_000, deposit_received: true, rent_free_days: 0, signer_name: "HAC WEST／周盼", status: "active", expected_end_confirmed: true, paid_through_date: "2026-08-30" }).eq("id", current.id), "update current B1201 lease");
await upsertPayment({ customerId: tenant.id, sourceId: current.id, sourceType: "lease_deposit", receiptNo: "WB3-LEASE-B1201-20250917-DEPOSIT-01", legacyReceiptNo: "S3-LEASE-B1201-DEP", date: "2025-09-17", amount: 3_600_000, direction: "liability_in", category: "lease_deposit", notes: currentNotes });
const rentPayments = [["2025-11-11", "2025-11-30"], ["2025-11-20", "2026-02-28"], ["2026-04-16", "2026-05-31"], ["2026-06-18", "2026-08-30"]];
for (let index = 0; index < rentPayments.length; index += 1) {
  const [date, paidThrough] = rentPayments[index];
  await upsertPayment({ customerId: tenant.id, sourceId: current.id, sourceType: "lease_rent", receiptNo: `WB3-LEASE-B1201-${date.replaceAll("-", "")}-RENT-${String(index + 1).padStart(2, "0")}`, legacyReceiptNo: index === rentPayments.length - 1 ? "S3-LEASE-B1201-RENT" : null, date, amount: 5_400_000, direction: "income", category: "lease_rent", notes: `${currentNotes} 本笔540万FCFA，缴至${paidThrough}。` });
}
const receivables = await checked(supabase.from("receivables").select("id, category").eq("source_id", current.id).neq("status", "cancelled"), "load current B1201 receivables");
const rentRows = receivables.filter((row) => row.category === "lease_rent"); const depositRows = receivables.filter((row) => row.category === "lease_deposit");
if (rentRows.length !== 1 || depositRows.length !== 1 || receivables.length !== 2) throw new Error("Unexpected current B1201 receivables");
await checked(supabase.from("receivables").update({ title: "3# B1201 HAC WEST／周盼十二个月租金", due_date: "2026-06-18", amount_xof: 21_600_000, paid_amount_xof: 21_600_000, status: "paid", currency: "XOF", notes: currentNotes }).eq("id", rentRows[0].id), "update B1201 rent receivable");
await checked(supabase.from("receivables").update({ title: "3# B1201 HAC WEST／周盼租赁押金", due_date: "2025-09-17", amount_xof: 3_600_000, paid_amount_xof: 3_600_000, status: "paid", currency: "XOF", notes: currentNotes }).eq("id", depositRows[0].id), "update B1201 deposit receivable");
await checked(supabase.from("units").update({ status: "leased", notes: `${currentNotes}\n历史：${huaweiNotes}` }).eq("id", unit.id), "update B1201 unit");

const [payments, leases] = await Promise.all([checked(supabase.from("payments").select("source_type, amount").eq("source_id", current.id), "verify current payments"), checked(supabase.from("lease_contracts").select("id, status, paid_through_date").in("id", [huaweiLeaseId, current.id]), "verify B1201 leases")]);
const sum = (type) => payments.filter((payment) => payment.source_type === type).reduce((total, payment) => total + Number(payment.amount), 0);
if (payments.length !== 5 || sum("lease_rent") !== 21_600_000 || sum("lease_deposit") !== 3_600_000) throw new Error("Unexpected B1201 payment totals");
if (leases.filter((lease) => lease.status === "terminated").length !== 1 || leases.filter((lease) => lease.status === "active" && lease.paid_through_date === "2026-08-30").length !== 1) throw new Error("Unexpected B1201 lease states");
await checked(supabase.from("audit_logs").insert({ action: "reconcile_sacsi3_b1201", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI3", unit_no: "B1201", huawei: { start: "2021-05-15", end: "2024-09-20", finance_pending: true, zero_rent_is_placeholder_not_free: true, status: "terminated" }, hac_west: { tenant: "HAC WEST／周盼", start: "2025-09-01", end: "2026-08-30", monthly_rent_xof: 1_800_000, deposit_xof: 3_600_000, rent_payment_count: 4, rent_xof: 21_600_000, paid_through: "2026-08-30", status: "active" } } }), "write B1201 audit");
console.log(JSON.stringify({ ok: true, unit: "B1201", huawei_finance_pending: true, current_tenant: "HAC WEST／周盼", rent_xof: 21_600_000, paid_through: "2026-08-30" }));
