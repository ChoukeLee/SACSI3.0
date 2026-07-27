import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
  const i = line.indexOf("=");
  return [line.slice(0, i), line.slice(i + 1)];
}));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI4").single(), "load building");

let customerRows = await checked(supabase.from("customers").select("id").eq("name", "冯立力"), "find Feng Lili customer");
if (customerRows.length > 1) throw new Error("Duplicate Feng Lili customers");
let customerId;
const customerPayload = { name: "冯立力", notes: "来源：4号公寓.xlsx；4#大仓库当前租户。411历史租户登记为联合客户‘林志浩冯立力’，本合同仅记冯立力，故单独建立客户身份。" };
if (customerRows.length === 1) {
  customerId = customerRows[0].id;
  await checked(supabase.from("customers").update(customerPayload).eq("id", customerId), "update Feng Lili customer");
} else {
  customerId = (await checked(supabase.from("customers").insert(customerPayload).select("id").single(), "insert Feng Lili customer")).id;
}

const unitPayload = {
  building_id: building.id,
  code: "SACSI4-WAREHOUSE-LARGE",
  unit_no: "大仓库",
  floor_label: "G",
  kind: "office",
  status: "leased",
  layout: "大仓库",
  furnishing: null,
  notes: "来源：4号公寓.xlsx；系统无warehouse资产类型，按非住宅office归类。王瑞历史上同时使用一大一小，其中大仓库记载70万/月；因缺少完整租期、付款及退出日期，仅保留历史备注，不生成合同或财务流水。冯立力自2026-05-01承租，月租55万，2026-04-16押1付6共385万，已缴至2026-10-31，目前在租。",
};
let unitRows = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "大仓库"), "find large warehouse");
if (unitRows.length === 0) unitRows = await checked(supabase.from("units").select("id").eq("code", "SACSI4-WAREHOUSE-LARGE"), "find large warehouse by code");
if (unitRows.length > 1) throw new Error("Duplicate large warehouse units");
let unitId;
if (unitRows.length === 1) {
  unitId = unitRows[0].id;
  await checked(supabase.from("units").update(unitPayload).eq("id", unitId), "update large warehouse");
} else {
  unitId = (await checked(supabase.from("units").insert(unitPayload).select("id").single(), "insert large warehouse")).id;
}

const flagRows = await checked(supabase.from("unit_business_flags").select("unit_id").eq("unit_id", unitId).eq("business_type", "long_lease"), "find large warehouse lease flag");
if (flagRows.length > 1) throw new Error("Duplicate large warehouse lease flags");
const flagPayload = { unit_id: unitId, business_type: "long_lease", is_enabled: true, default_price_xof: 550_000 };
if (flagRows.length === 1) await checked(supabase.from("unit_business_flags").update(flagPayload).eq("unit_id", unitId).eq("business_type", "long_lease"), "update large warehouse flag");
else await checked(supabase.from("unit_business_flags").insert(flagPayload), "insert large warehouse flag");

const contractNo = "WB-LEASE-SACSI4-WAREHOUSE-LARGE-20260501";
let leaseRows = await checked(supabase.from("lease_contracts").select("id").eq("contract_no", contractNo), "find large warehouse lease");
if (leaseRows.length === 0) leaseRows = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unitId), "find large warehouse lease by unit");
if (leaseRows.length > 1) throw new Error("Duplicate large warehouse leases");
const leasePayload = {
  unit_id: unitId,
  customer_id: customerId,
  contract_no: contractNo,
  start_date: "2026-05-01",
  expected_end_date: "2026-10-31",
  actual_end_date: null,
  payment_cycle: "semiannual",
  payment_day: 1,
  monthly_rent_xof: 550_000,
  deposit_amount_xof: 550_000,
  deposit_received: true,
  rent_free_days: 0,
  signer_name: "冯立力",
  status: "active",
  expected_end_confirmed: true,
  paid_through_date: "2026-10-31",
};
let leaseId;
if (leaseRows.length === 1) {
  leaseId = leaseRows[0].id;
  await checked(supabase.from("lease_contracts").update(leasePayload).eq("id", leaseId), "update large warehouse lease");
} else {
  leaseId = (await checked(supabase.from("lease_contracts").insert(leasePayload).select("id").single(), "insert large warehouse lease")).id;
}

const entries = [
  { amount: 3_300_000, type: "lease_rent", code: "RENT-01", direction: "income", ledger: "lease_rent", category: "lease_rent", title: "4# 大仓库租金", notes: "4#大仓库冯立力租金330万，覆盖2026-05-01至2026-10-31（6个月），月租55万。" },
  { amount: 550_000, type: "lease_deposit", code: "DEP-01", direction: "liability_in", ledger: "lease_deposit", category: "lease_deposit", title: "4# 大仓库押金", notes: "4#大仓库冯立力押金55万；2026-04-16押1付6总收款385万中的押金部分，尚未退还。" },
];

for (const entry of entries) {
  const receiptNo = `WB4-LEASE-WAREHOUSE-LARGE-20260416-${entry.code}`;
  const paymentRows = await checked(supabase.from("payments").select("id").eq("source_id", leaseId).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (paymentRows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const paymentPayload = { customer_id: customerId, unit_id: unitId, source_type: entry.type, source_id: leaseId, payment_date: "2026-04-16", amount: entry.amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes: entry.notes };
  let paymentId;
  if (paymentRows.length === 1) {
    paymentId = paymentRows[0].id;
    await checked(supabase.from("payments").update(paymentPayload).eq("id", paymentId), `update ${receiptNo}`);
  } else {
    paymentId = (await checked(supabase.from("payments").insert(paymentPayload).select("id").single(), `insert ${receiptNo}`)).id;
  }
  const ledgerRows = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgerRows.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledgerPayload = { building_id: building.id, unit_id: unitId, payment_id: paymentId, entry_date: "2026-04-16", direction: entry.direction, category: entry.ledger, amount_xof: entry.amount, amount_cny: null, description: entry.notes };
  if (ledgerRows.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgerRows[0].id), `update ledger ${receiptNo}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${receiptNo}`);

  const receivableRows = await checked(supabase.from("receivables").select("id").eq("source_id", leaseId).eq("category", entry.category).eq("due_date", "2026-04-16").eq("amount_xof", entry.amount), `find receivable ${receiptNo}`);
  if (receivableRows.length > 1) throw new Error(`Duplicate receivable ${receiptNo}`);
  const receivablePayload = { building_id: building.id, unit_id: unitId, customer_id: customerId, source_type: "lease_contract", source_id: leaseId, category: entry.category, title: entry.title, due_date: "2026-04-16", amount_xof: entry.amount, paid_amount_xof: entry.amount, status: "paid", currency: "XOF", notes: `${entry.notes}\n收据号：${receiptNo}` };
  if (receivableRows.length === 1) await checked(supabase.from("receivables").update(receivablePayload).eq("id", receivableRows[0].id), `update receivable ${receiptNo}`);
  else await checked(supabase.from("receivables").insert(receivablePayload), `insert receivable ${receiptNo}`);
}

const payments = await checked(supabase.from("payments").select("source_type, amount").eq("source_id", leaseId), "verify large warehouse payments");
const receivables = await checked(supabase.from("receivables").select("category, amount_xof, paid_amount_xof, status").eq("source_id", leaseId).neq("status", "cancelled"), "verify large warehouse receivables");
const paymentTotal = payments.reduce((sum, row) => sum + Number(row.amount), 0);
const receivableTotal = receivables.reduce((sum, row) => sum + Number(row.amount_xof), 0);
if (payments.length !== 2 || receivables.length !== 2 || paymentTotal !== 3_850_000 || receivableTotal !== 3_850_000) throw new Error("Unexpected large warehouse financial records");
if (!payments.some((row) => row.source_type === "lease_rent" && Number(row.amount) === 3_300_000) || !payments.some((row) => row.source_type === "lease_deposit" && Number(row.amount) === 550_000)) throw new Error("Large warehouse payment split is incorrect");
if (receivables.some((row) => row.status !== "paid" || Number(row.paid_amount_xof) !== Number(row.amount_xof))) throw new Error("Large warehouse receivable is not fully paid");

await checked(supabase.from("audit_logs").insert({ action: "reconcile_auxiliary_asset", entity_type: "unit", entity_id: unitId, metadata: { building_code: "SACSI4", unit_no: "大仓库", asset_kind: "office", warehouse_classification: true, tenant: "冯立力", separate_customer_from_joint_411_customer: true, lease_start: "2026-05-01", expected_end: "2026-10-31", paid_through: "2026-10-31", status: "leased", rent_income_xof: 3_300_000, deposit_received_xof: 550_000, wang_rui_history_notes_only: true } }), "write large warehouse audit");
console.log(JSON.stringify({ ok: true, unit: "大仓库", tenant: "冯立力", status: "leased", lease_status: "active", paid_through: "2026-10-31", rent_income_xof: 3_300_000, deposit_received_xof: 550_000, payment_total_xof: paymentTotal, receivable_count: receivables.length }));
