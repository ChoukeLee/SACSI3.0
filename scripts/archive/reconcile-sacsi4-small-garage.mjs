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
const unit501 = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "501").single(), "load 501");
const huLease = await checked(supabase.from("lease_contracts").select("customer_id, signer_name").eq("unit_id", unit501.id).eq("contract_no", "WB-LEASE-SACSI4-501-20240911-HU").single(), "load Hu 501 lease");
if (huLease.signer_name !== "胡建初") throw new Error(`Unexpected 501 tenant: ${huLease.signer_name}`);
const customerId = huLease.customer_id;

const unitPayload = {
  building_id: building.id,
  code: "SACSI4-GARAGE-SMALL",
  unit_no: "小车库",
  floor_label: "G",
  kind: "parking",
  status: "available",
  layout: "小车库",
  furnishing: null,
  notes: "来源：4号公寓.xlsx。王瑞历史上同时使用一大一小，其中小车库记载30万/月；原表另记‘小仓库用押金2个月退，止2022.10.05-2022.12.04’，因缺少押金收款日期和完整租期，仅保留原意待核实，不生成合同或财务流水。胡建初按26.5万/月承租，明确付款覆盖2024-11-01至2026-05-09，现已退租；无押金记录。",
};
let unitRows = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "小车库"), "find small garage");
if (unitRows.length === 0) unitRows = await checked(supabase.from("units").select("id").eq("code", "SACSI4-GARAGE-SMALL"), "find small garage by code");
if (unitRows.length > 1) throw new Error("Duplicate small garage units");
let unitId;
if (unitRows.length === 1) {
  unitId = unitRows[0].id;
  await checked(supabase.from("units").update(unitPayload).eq("id", unitId), "update small garage");
} else {
  unitId = (await checked(supabase.from("units").insert(unitPayload).select("id").single(), "insert small garage")).id;
}

const flagRows = await checked(supabase.from("unit_business_flags").select("unit_id").eq("unit_id", unitId).eq("business_type", "long_lease"), "find small garage lease flag");
if (flagRows.length > 1) throw new Error("Duplicate small garage lease flags");
const flagPayload = { unit_id: unitId, business_type: "long_lease", is_enabled: true, default_price_xof: 265_000 };
if (flagRows.length === 1) await checked(supabase.from("unit_business_flags").update(flagPayload).eq("unit_id", unitId).eq("business_type", "long_lease"), "update small garage flag");
else await checked(supabase.from("unit_business_flags").insert(flagPayload), "insert small garage flag");

const contractNo = "WB-LEASE-SACSI4-GARAGE-SMALL-20241101";
let leaseRows = await checked(supabase.from("lease_contracts").select("id").eq("contract_no", contractNo), "find small garage lease");
if (leaseRows.length === 0) leaseRows = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unitId), "find small garage lease by unit");
if (leaseRows.length > 1) throw new Error("Duplicate small garage leases");
const leasePayload = {
  unit_id: unitId,
  customer_id: customerId,
  contract_no: contractNo,
  start_date: "2024-11-01",
  expected_end_date: "2026-05-09",
  actual_end_date: "2026-05-09",
  payment_cycle: "semiannual",
  payment_day: 1,
  monthly_rent_xof: 265_000,
  deposit_amount_xof: 0,
  deposit_received: false,
  rent_free_days: 0,
  signer_name: "胡建初",
  status: "terminated",
  expected_end_confirmed: true,
  paid_through_date: "2026-05-09",
};
let leaseId;
if (leaseRows.length === 1) {
  leaseId = leaseRows[0].id;
  await checked(supabase.from("lease_contracts").update(leasePayload).eq("id", leaseId), "update small garage lease");
} else {
  leaseId = (await checked(supabase.from("lease_contracts").insert(leasePayload).select("id").single(), "insert small garage lease")).id;
}

const entries = [
  { date: "2024-09-02", amount: 1_590_000, code: "RENT-01", period: "2024-11-01至2025-04-30（6个月）" },
  { date: "2025-04-29", amount: 1_139_500, code: "RENT-02", period: "2025-05-01至2025-09-09" },
  { date: "2025-09-15", amount: 1_590_000, code: "RENT-03", period: "2025-09-10至2026-03-09（6个月）" },
  { date: "2026-03-11", amount: 530_000, code: "RENT-04", period: "2026-03-10至2026-05-09（2个月）" },
];

for (const entry of entries) {
  const receiptNo = `WB4-LEASE-GARAGE-SMALL-${entry.date.replaceAll("-", "")}-${entry.code}`;
  const notes = `4#小车库胡建初租金，覆盖${entry.period}；月租26.5万；无押金记录。`;
  const paymentRows = await checked(supabase.from("payments").select("id").eq("source_id", leaseId).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (paymentRows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const paymentPayload = { customer_id: customerId, unit_id: unitId, source_type: "lease_rent", source_id: leaseId, payment_date: entry.date, amount: entry.amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
  let paymentId;
  if (paymentRows.length === 1) {
    paymentId = paymentRows[0].id;
    await checked(supabase.from("payments").update(paymentPayload).eq("id", paymentId), `update ${receiptNo}`);
  } else {
    paymentId = (await checked(supabase.from("payments").insert(paymentPayload).select("id").single(), `insert ${receiptNo}`)).id;
  }
  const ledgerRows = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgerRows.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledgerPayload = { building_id: building.id, unit_id: unitId, payment_id: paymentId, entry_date: entry.date, direction: "income", category: "lease_rent", amount_xof: entry.amount, amount_cny: null, description: notes };
  if (ledgerRows.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgerRows[0].id), `update ledger ${receiptNo}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${receiptNo}`);

  const receivableRows = await checked(supabase.from("receivables").select("id").eq("source_id", leaseId).eq("category", "lease_rent").eq("due_date", entry.date).eq("amount_xof", entry.amount), `find receivable ${receiptNo}`);
  if (receivableRows.length > 1) throw new Error(`Duplicate receivable ${receiptNo}`);
  const receivablePayload = { building_id: building.id, unit_id: unitId, customer_id: customerId, source_type: "lease_contract", source_id: leaseId, category: "lease_rent", title: "4# 小车库租金", due_date: entry.date, amount_xof: entry.amount, paid_amount_xof: entry.amount, status: "paid", currency: "XOF", notes: `${notes}\n收据号：${receiptNo}` };
  if (receivableRows.length === 1) await checked(supabase.from("receivables").update(receivablePayload).eq("id", receivableRows[0].id), `update receivable ${receiptNo}`);
  else await checked(supabase.from("receivables").insert(receivablePayload), `insert receivable ${receiptNo}`);
}

const payments = await checked(supabase.from("payments").select("source_type, amount").eq("source_id", leaseId), "verify small garage payments");
const receivables = await checked(supabase.from("receivables").select("amount_xof, paid_amount_xof, status").eq("source_id", leaseId).neq("status", "cancelled"), "verify small garage receivables");
const paymentTotal = payments.reduce((sum, row) => sum + Number(row.amount), 0);
const receivableTotal = receivables.reduce((sum, row) => sum + Number(row.amount_xof), 0);
if (payments.length !== 4 || receivables.length !== 4 || paymentTotal !== 4_849_500 || receivableTotal !== 4_849_500) throw new Error("Unexpected small garage financial records");
if (payments.some((row) => row.source_type !== "lease_rent") || receivables.some((row) => row.status !== "paid" || Number(row.paid_amount_xof) !== Number(row.amount_xof))) throw new Error("Unexpected small garage payment classification");

await checked(supabase.from("audit_logs").insert({ action: "reconcile_auxiliary_asset", entity_type: "unit", entity_id: unitId, metadata: { building_code: "SACSI4", unit_no: "小车库", asset_kind: "parking", tenant: "胡建初", customer_reused_from_unit: "501", lease_start: "2024-11-01", lease_end: "2026-05-09", status: "available", lease_status: "terminated", rent_income_xof: 4_849_500, deposit_xof: 0, wang_rui_history_notes_only: true } }), "write small garage audit");
console.log(JSON.stringify({ ok: true, unit: "小车库", tenant: "胡建初", status: "available", lease_status: "terminated", paid_through: "2026-05-09", rent_income_xof: paymentTotal, payment_count: payments.length, receivable_count: receivables.length }));
