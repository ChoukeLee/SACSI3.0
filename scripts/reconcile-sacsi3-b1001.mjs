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
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "B1001").single(), "load B1001");
if (Number(unit.area_sqm) !== 173.51) throw new Error(`Unexpected B1001 area: ${unit.area_sqm}`);
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).eq("status", "active").single(), "load B1001 sale");
if (Number(sale.total_amount_xof) !== 160_000_000) throw new Error(`Unexpected B1001 total: ${sale.total_amount_xof}`);
const buyer = await checked(supabase.from("customers").select("id, name").eq("id", sale.customer_id).single(), "load B1001 buyer");
if (buyer.name !== "林新生") throw new Error(`Unexpected B1001 buyer: ${buyer.name}`);
const huaweiRows = await checked(supabase.from("customers").select("id, name").eq("name", "华为"), "load Huawei");
if (huaweiRows.length !== 1) throw new Error(`Unexpected Huawei customer count: ${huaweiRows.length}`);
const huawei = huaweiRows[0];

async function upsertPayment({ customerId, sourceId, sourceType, receiptNo, legacyReceiptNo, date, amount, direction, category, notes }) {
  let rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (!rows.length && legacyReceiptNo) rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", legacyReceiptNo), `find ${legacyReceiptNo}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const payload = { customer_id: customerId, unit_id: unit.id, source_type: sourceType, source_id: sourceId, payment_date: date, amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
  const paymentId = rows.length
    ? (await checked(supabase.from("payments").update(payload).eq("id", rows[0].id).select("id").single(), `update ${receiptNo}`)).id
    : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledger = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: date, direction, category, amount_xof: amount, amount_cny: null, description: notes };
  if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), `update ledger ${receiptNo}`);
  else await checked(supabase.from("ledger_entries").insert(ledger), `insert ledger ${receiptNo}`);
}

const saleNotes = "来源：3号公寓.xlsx；B1001买方林新生，2021-01-01入住、后续购买；合同总价16000万FCFA。Excel列出五笔房款合计15700万，但同时记已付16000万、余额0；用户确认已结清，剩余300万按付款明细缺失登记，不视为欠款。";
await checked(supabase.from("sale_contracts").update({ signed_date: "2021-05-14", payment_plan_type: "installment" }).eq("id", sale.id), "update B1001 sale");
const housePayments = [
  ["2021-05-14", 100_000_000, "HOUSE-01", "首笔房款10000万FCFA。"],
  ["2021-09-13", 15_000_000, "HOUSE-02", "房款1500万FCFA。"],
  ["2021-12-11", 10_000_000, "HOUSE-03", "房款1000万FCFA，Excel记‘转高’。"],
  ["2021-12-20", 20_000_000, "HOUSE-04", "房款2000万FCFA，Excel记‘转高’。"],
  ["2021-12-28", 12_000_000, "HOUSE-05", "房款1200万FCFA，Excel记‘转高’。"],
  ["2021-12-28", 3_000_000, "HOUSE-06", "结清差额300万FCFA；原始付款日期和方式缺失，以最后一笔明确房款日2021-12-28作占位账务日期。"],
];
for (let index = 0; index < housePayments.length; index += 1) {
  const [date, amount, code, detail] = housePayments[index];
  await upsertPayment({ customerId: buyer.id, sourceId: sale.id, sourceType: "sale_contract", receiptNo: `WB3-SALE-1001-${date.replaceAll("-", "")}-${code}`, legacyReceiptNo: index === 0 ? "S3-SALE-B1001-CONSOLIDATED" : null, date, amount, direction: "income", category: "sale", notes: `${saleNotes} ${detail}` });
}
const saleReceivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).neq("status", "cancelled"), "load B1001 sale receivable");
if (saleReceivables.length !== 1) throw new Error(`Unexpected B1001 sale receivable count: ${saleReceivables.length}`);
await checked(supabase.from("receivables").update({ category: "sale_installment", title: "3# B1001购房款", due_date: "2021-12-28", amount_xof: 160_000_000, paid_amount_xof: 160_000_000, status: "paid", currency: "XOF", notes: saleNotes }).eq("id", saleReceivables[0].id), "update B1001 sale receivable");

const contractNo = "WB-LEASE-SACSI3-B1001-20220101-HUAWEI";
const leaseNotes = "来源：3号公寓.xlsx；B1001华为租赁按连续缴费覆盖期登记为2022-01-01至2025-09-30，月租100万FCFA；九笔租金合计4500万FCFA；Excel记‘华为已退’，合同按已终止登记；未记押金或押金退款。‘租赁税15.25%，收10%’缺少实际金额和日期，仅保留原文，不生成税款收入。";
let leases = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id).eq("contract_no", contractNo), "find B1001 Huawei lease");
if (leases.length > 1) throw new Error("Duplicate B1001 Huawei lease");
const leasePayload = { unit_id: unit.id, customer_id: huawei.id, contract_no: contractNo, start_date: "2022-01-01", expected_end_date: "2025-09-30", actual_end_date: "2025-09-30", payment_cycle: "quarterly", payment_day: 1, monthly_rent_xof: 1_000_000, deposit_amount_xof: 0, deposit_received: false, rent_free_days: 0, signer_name: "华为", attachment_url: null, status: "terminated", expected_end_confirmed: true, paid_through_date: "2025-09-30" };
const leaseId = leases.length
  ? (await checked(supabase.from("lease_contracts").update(leasePayload).eq("id", leases[0].id).select("id").single(), "update B1001 Huawei lease")).id
  : (await checked(supabase.from("lease_contracts").insert(leasePayload).select("id").single(), "insert B1001 Huawei lease")).id;
const rentPayments = [
  ["2022-01-01", 3_000_000, "2022-03-31"],
  ["2022-04-26", 3_000_000, "2022-06-30"],
  ["2022-07-08", 3_000_000, "2022-09-30"],
  ["2023-01-07", 6_000_000, "2023-03-31"],
  ["2023-06-07", 3_000_000, "2023-06-30"],
  ["2024-01-04", 6_000_000, "2023-12-31"],
  ["2024-08-28", 6_000_000, "2024-06-30"],
  ["2025-01-15", 9_000_000, "2025-03-31"],
  ["2025-07-28", 6_000_000, "2025-09-30"],
];
for (let index = 0; index < rentPayments.length; index += 1) {
  const [date, amount, paidThrough] = rentPayments[index];
  await upsertPayment({ customerId: huawei.id, sourceId: leaseId, sourceType: "lease_rent", receiptNo: `WB3-LEASE-B1001-${date.replaceAll("-", "")}-RENT-${String(index + 1).padStart(2, "0")}`, date, amount, direction: "income", category: "lease_rent", notes: `${leaseNotes} 本笔${amount / 10_000}万FCFA，缴至${paidThrough}。` });
}
let rentReceivables = await checked(supabase.from("receivables").select("id").eq("source_id", leaseId).eq("category", "lease_rent").neq("status", "cancelled"), "find B1001 rent receivable");
if (rentReceivables.length > 1) throw new Error("Duplicate B1001 rent receivable");
const rentReceivable = { building_id: building.id, unit_id: unit.id, customer_id: huawei.id, source_type: "lease_contract", source_id: leaseId, category: "lease_rent", title: "3# B1001华为历史租金", due_date: "2025-09-30", amount_xof: 45_000_000, paid_amount_xof: 45_000_000, status: "paid", currency: "XOF", notes: leaseNotes };
if (rentReceivables.length) await checked(supabase.from("receivables").update(rentReceivable).eq("id", rentReceivables[0].id), "update B1001 rent receivable");
else await checked(supabase.from("receivables").insert(rentReceivable), "insert B1001 rent receivable");
await checked(supabase.from("units").update({ status: "sold", notes: `${saleNotes}\n${leaseNotes}\nExcel未记注册金、实际税款或FULO提成；过户状态不推断。` }).eq("id", unit.id), "update B1001 unit");

const [saleVerified, rentVerified, leaseVerified] = await Promise.all([
  checked(supabase.from("payments").select("source_type, amount").eq("source_id", sale.id), "verify B1001 sale payments"),
  checked(supabase.from("payments").select("source_type, amount").eq("source_id", leaseId), "verify B1001 rent payments"),
  checked(supabase.from("lease_contracts").select("status, paid_through_date").eq("id", leaseId).single(), "verify B1001 lease"),
]);
if (saleVerified.length !== 6 || saleVerified.some((row) => row.source_type !== "sale_contract") || saleVerified.reduce((sum, row) => sum + Number(row.amount), 0) !== 160_000_000) throw new Error("Unexpected B1001 sale total");
if (rentVerified.length !== 9 || rentVerified.some((row) => row.source_type !== "lease_rent") || rentVerified.reduce((sum, row) => sum + Number(row.amount), 0) !== 45_000_000) throw new Error("Unexpected B1001 rent total");
if (leaseVerified.status !== "terminated" || leaseVerified.paid_through_date !== "2025-09-30") throw new Error("Unexpected B1001 lease state");
await checked(supabase.from("audit_logs").insert({ action: "reconcile_sacsi3_b1001", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI3", unit_no: "B1001", sale: { buyer: "林新生", total_xof: 160_000_000, listed_payments_xof: 157_000_000, settlement_detail_missing_xof: 3_000_000, settlement_confirmed_by_user: true, accounting_date_placeholder: "2021-12-28", settled: true }, lease: { tenant: "华为", start: "2022-01-01", end: "2025-09-30", monthly_rent_xof: 1_000_000, rent_xof: 45_000_000, payment_count: 9, deposit_recorded: false, status: "terminated" }, lease_tax: { raw: "租赁税15.25%，收10%", actual_amount_pending: true, payment_not_created: true } } }), "write B1001 audit log");

console.log(JSON.stringify({ ok: true, unit: "B1001", sale_settled: true, sale_xof: 160_000_000, missing_detail_xof: 3_000_000, huawei_rent_xof: 45_000_000, lease_status: "terminated" }));
