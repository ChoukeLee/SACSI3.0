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
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "B701").single(), "load B701");
if (Number(unit.area_sqm) !== 173.51) throw new Error(`Unexpected B701 area: ${unit.area_sqm}`);
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).eq("status", "active").single(), "load B701 sale");
if (Number(sale.total_amount_xof) !== 160_000_000) throw new Error(`Unexpected B701 total: ${sale.total_amount_xof}`);
const customer = await checked(supabase.from("customers").select("id, name").eq("id", sale.customer_id).single(), "load B701 customer");
if (customer.name !== "意大利人（姓名待补）") throw new Error(`Unexpected B701 customer: ${customer.name}`);

const leaseNo = "WB-LEASE-SACSI3-B701-20210501-ITALIAN";
const leaseNotes = "来源：3号公寓.xlsx；B701意大利租户姓名待补；月租100万FCFA；13笔租金合计1900万；根据月租、总月数及末笔注明已缴至2022-11-30，租期反推为2021-05-01至2022-11-30，共19个月；Excel未记押金；合同按已终止登记。";
let leaseRows = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id).eq("contract_no", leaseNo), "find B701 lease");
if (leaseRows.length > 1) throw new Error("Duplicate B701 lease");
const leasePayload = { unit_id: unit.id, customer_id: customer.id, contract_no: leaseNo, start_date: "2021-05-01", expected_end_date: "2022-11-30", actual_end_date: "2022-11-30", payment_cycle: "monthly", payment_day: 1, monthly_rent_xof: 1_000_000, deposit_amount_xof: 0, deposit_received: false, rent_free_days: 0, signer_name: "意大利人（姓名待补）", attachment_url: null, status: "terminated", expected_end_confirmed: false, paid_through_date: "2022-11-30" };
const leaseId = leaseRows.length
  ? (await checked(supabase.from("lease_contracts").update(leasePayload).eq("id", leaseRows[0].id).select("id").single(), "update B701 lease")).id
  : (await checked(supabase.from("lease_contracts").insert(leasePayload).select("id").single(), "insert B701 lease")).id;

async function upsertPayment({ sourceId, sourceType, date, amount, receiptNo, legacyReceiptNo, direction, category, notes, createLedger = true }) {
  let rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (!rows.length && legacyReceiptNo) rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", legacyReceiptNo), `find ${legacyReceiptNo}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const payload = { customer_id: customer.id, unit_id: unit.id, source_type: sourceType, source_id: sourceId, payment_date: date, amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
  const paymentId = rows.length
    ? (await checked(supabase.from("payments").update(payload).eq("id", rows[0].id).select("id").single(), `update ${receiptNo}`)).id
    : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  if (!createLedger) {
    if (ledgers.length) await checked(supabase.from("ledger_entries").delete().eq("id", ledgers[0].id), `remove internal ledger ${receiptNo}`);
    return paymentId;
  }
  const ledger = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: date, direction, category, amount_xof: amount, amount_cny: null, description: notes };
  if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), `update ledger ${receiptNo}`);
  else await checked(supabase.from("ledger_entries").insert(ledger), `insert ledger ${receiptNo}`);
  return paymentId;
}

const rentPayments = [
  ["2021-05-27", 3_000_000], ["2021-07-28", 1_000_000], ["2021-10-05", 2_000_000], ["2021-10-22", 2_000_000], ["2021-12-03", 1_000_000],
  ["2022-02-03", 1_000_000], ["2022-03-08", 1_000_000], ["2022-04-15", 1_000_000], ["2022-05-09", 1_000_000], ["2022-06-02", 1_000_000],
  ["2022-07-06", 1_000_000], ["2022-09-08", 2_000_000], ["2022-12-20", 2_000_000],
];
for (let index = 0; index < rentPayments.length; index += 1) {
  const [date, amount] = rentPayments[index];
  await upsertPayment({ sourceId: leaseId, sourceType: "lease_rent", date, amount, receiptNo: `WB3-LEASE-B701-${date.replaceAll("-", "")}-RENT-${String(index + 1).padStart(2, "0")}`, direction: "income", category: "lease_rent", notes: `${leaseNotes} ${date}收租金${amount / 10_000}万FCFA。` });
}
let rentReceivables = await checked(supabase.from("receivables").select("id").eq("source_id", leaseId).eq("category", "lease_rent").neq("status", "cancelled"), "find B701 rent receivable");
if (rentReceivables.length > 1) throw new Error("Duplicate B701 rent receivable");
const rentReceivable = { building_id: building.id, unit_id: unit.id, customer_id: customer.id, source_type: "lease_contract", source_id: leaseId, category: "lease_rent", title: "3# B701意大利租户历史租金", due_date: "2022-11-30", amount_xof: 19_000_000, paid_amount_xof: 19_000_000, status: "paid", currency: "XOF", notes: leaseNotes };
if (rentReceivables.length) await checked(supabase.from("receivables").update(rentReceivable).eq("id", rentReceivables[0].id), "update B701 rent receivable");
else await checked(supabase.from("receivables").insert(rentReceivable), "insert B701 rent receivable");

const saleNotes = "来源：3号公寓.xlsx；B701意大利买方姓名待补；合同总价16000万FCFA；2022-12-20至2023-12-04分期支付，合计16000万，已结清；其中2023-04-20从7#905内部转入1380万，仅用于结清房款，不作为B701新增现金收入。";
await checked(supabase.from("sale_contracts").update({ signed_date: "2022-12-20", payment_plan_type: "installment", agency_company: "FULO", agency_commission_amount_xof: null, agency_commission_paid: true }).eq("id", sale.id), "update B701 sale");
const housePayments = [
  ["2022-12-20", 35_000_000, "支票", false], ["2022-12-20", 15_000_000, "现金", false],
  ["2023-03-03", 10_000_000, "现金", false], ["2023-03-03", 10_000_000, "支票", false],
  ["2023-04-20", 13_800_000, "7#905内部转入", true], ["2023-05-17", 20_000_000, "支票/现金混合，具体拆分待补", false],
  ["2023-07-27", 5_000_000, "支票", false], ["2023-07-27", 5_000_000, "现金", false],
  ["2023-10-17", 10_000_000, "现金", false], ["2023-10-17", 6_200_000, "支票", false],
  ["2023-12-04", 20_000_000, "现金", false], ["2023-12-04", 10_000_000, "支票", false],
];
let internalPaymentId;
for (let index = 0; index < housePayments.length; index += 1) {
  const [date, amount, method, internal] = housePayments[index];
  const paymentId = await upsertPayment({ sourceId: sale.id, sourceType: "sale_contract", date, amount, receiptNo: `WB3-SALE-701-${date.replaceAll("-", "")}-HOUSE-${String(index + 1).padStart(2, "0")}`, legacyReceiptNo: index === 0 ? "S3-SALE-B701-CONSOLIDATED" : null, direction: "income", category: "sale", notes: `${saleNotes} 本笔${amount / 10_000}万FCFA，方式：${method}。`, createLedger: !internal });
  if (internal) internalPaymentId = paymentId;
}
const saleReceivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).neq("status", "cancelled"), "load B701 sale receivable");
if (saleReceivables.length !== 1) throw new Error("Unexpected B701 sale receivable count");
await checked(supabase.from("receivables").update({ category: "sale_installment", title: "3# B701购房款", due_date: "2023-12-04", amount_xof: 160_000_000, paid_amount_xof: 160_000_000, status: "paid", currency: "XOF", notes: saleNotes }).eq("id", saleReceivables[0].id), "update B701 sale receivable");
await checked(supabase.from("units").update({ status: "sold", notes: `${saleNotes}\nFULO提成于2024-12-06支付，金额待补；Excel未记税款；过户状态不推断。\n历史：${leaseNotes}` }).eq("id", unit.id), "update B701 unit");

const [verifiedRent, verifiedHouse, internalLedgers] = await Promise.all([
  checked(supabase.from("payments").select("source_type, amount").eq("source_id", leaseId), "verify B701 rent"),
  checked(supabase.from("payments").select("source_type, amount").eq("source_id", sale.id), "verify B701 house payments"),
  checked(supabase.from("ledger_entries").select("id").eq("payment_id", internalPaymentId), "verify B701 internal transfer ledger"),
]);
if (verifiedRent.length !== 13 || verifiedRent.reduce((sum, row) => sum + Number(row.amount), 0) !== 19_000_000) throw new Error("Unexpected B701 rent total");
if (verifiedHouse.length !== 12 || verifiedHouse.some((row) => row.source_type !== "sale_contract") || verifiedHouse.reduce((sum, row) => sum + Number(row.amount), 0) !== 160_000_000) throw new Error("Unexpected B701 sale total");
if (internalLedgers.length) throw new Error("B701 internal transfer must not create an income ledger");
await checked(supabase.from("audit_logs").insert({ action: "reconcile_sacsi3_b701", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI3", unit_no: "B701", customer_name_pending: true, lease: { inferred_start: "2021-05-01", end: "2022-11-30", monthly_rent_xof: 1_000_000, rent_payment_count: 13, rent_received_xof: 19_000_000, deposit_recorded: false, status: "terminated" }, sale: { total_xof: 160_000_000, payment_count: 12, external_cash_and_checks_xof: 146_200_000, internal_transfer_xof: 13_800_000, internal_source: "SACSI7-905", internal_transfer_counted_as_new_income: false, settled: true, tax_missing: true, agency: { company: "FULO", paid_date: "2024-12-06", amount_pending: true }, transfer_status_inferred: false } } }), "write B701 audit log");

console.log(JSON.stringify({ ok: true, unit: "B701", rent_xof: 19_000_000, sale_xof: 160_000_000, internal_transfer_xof: 13_800_000, settled: true }));
