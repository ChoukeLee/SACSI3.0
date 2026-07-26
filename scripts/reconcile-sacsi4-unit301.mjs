import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function checked(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI4").single(), "load building");
const unit = await checked(
  supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "301").single(),
  "load unit 301",
);

async function upsertCustomer(name, notes) {
  const rows = await checked(supabase.from("customers").select("id").eq("name", name), `find customer ${name}`);
  if (rows.length > 1) throw new Error(`Duplicate customer ${name}`);
  if (rows.length === 1) return rows[0].id;
  return (await checked(supabase.from("customers").insert({ name, notes }).select("id").single(), `insert customer ${name}`)).id;
}

async function upsertLease(contractNo, payload) {
  const rows = await checked(supabase.from("lease_contracts").select("id").eq("contract_no", contractNo), `find ${contractNo}`);
  if (rows.length > 1) throw new Error(`Duplicate lease ${contractNo}`);
  if (rows.length === 1) {
    await checked(supabase.from("lease_contracts").update(payload).eq("id", rows[0].id), `update ${contractNo}`);
    return rows[0].id;
  }
  return (await checked(supabase.from("lease_contracts").insert(payload).select("id").single(), `insert ${contractNo}`)).id;
}

async function upsertEntry({ leaseId, customerId, date, amount, sourceType, category, direction, receipt, oldReceipt, title, notes, receivable = true }) {
  let rows = await checked(supabase.from("payments").select("id").eq("source_id", leaseId).eq("receipt_no", receipt), `find ${receipt}`);
  if (rows.length === 0 && oldReceipt) {
    rows = await checked(supabase.from("payments").select("id").eq("source_id", leaseId).eq("receipt_no", oldReceipt), `find ${oldReceipt}`);
  }
  if (rows.length > 1) throw new Error(`Duplicate payment ${receipt}`);
  const paymentPayload = {
    customer_id: customerId,
    unit_id: unit.id,
    source_type: sourceType,
    source_id: leaseId,
    payment_date: date,
    amount,
    currency: "XOF",
    exchange_rate_to_xof: 1,
    receipt_no: receipt,
    notes,
  };
  let paymentId;
  if (rows.length === 1) {
    paymentId = rows[0].id;
    await checked(supabase.from("payments").update(paymentPayload).eq("id", paymentId), `update ${receipt}`);
  } else {
    paymentId = (await checked(supabase.from("payments").insert(paymentPayload).select("id").single(), `insert ${receipt}`)).id;
  }
  const ledgerPayload = {
    building_id: building.id,
    unit_id: unit.id,
    payment_id: paymentId,
    entry_date: date,
    direction,
    category: sourceType,
    amount_xof: amount,
    amount_cny: null,
    description: notes,
  };
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receipt}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${receipt}`);
  if (ledgers.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgers[0].id), `update ledger ${receipt}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${receipt}`);

  if (!receivable) return;
  const receivablePayload = {
    building_id: building.id,
    unit_id: unit.id,
    customer_id: customerId,
    source_type: "lease_contract",
    source_id: leaseId,
    category,
    title,
    due_date: date,
    amount_xof: amount,
    paid_amount_xof: amount,
    status: "paid",
    currency: "XOF",
    notes,
  };
  const receivables = await checked(supabase.from("receivables").select("id").eq("source_id", leaseId).eq("notes", notes), `find receivable ${receipt}`);
  if (receivables.length > 1) throw new Error(`Duplicate receivable ${receipt}`);
  if (receivables.length === 1) await checked(supabase.from("receivables").update(receivablePayload).eq("id", receivables[0].id), `update receivable ${receipt}`);
  else await checked(supabase.from("receivables").insert(receivablePayload), `insert receivable ${receipt}`);
}

const sale = await checked(
  supabase.from("sale_contracts").select("id, customer_id, signed_date, total_amount_xof").eq("unit_id", unit.id).single(),
  "load 301 sale",
);
if (sale.signed_date !== "2026-06-12" || Number(sale.total_amount_xof) !== 80_000_000) {
  throw new Error(`Unexpected 301 sale: ${sale.signed_date} / ${sale.total_amount_xof}`);
}
const saleSummary = "\u5408\u540c\u603b\u4ef78000\u4e07\uff0c2026-06-12\u4e00\u6b21\u4ed8\u6e05\uff1b\u65e0\u8f66\u4f4d\u548c\u5176\u4ed6\u51fa\u552e\u6536\u6b3e\u3002";
await checked(
  supabase.from("sale_contracts").update({ contract_no: "WB-SALE-SACSI4-301-20260612", payment_plan_type: saleSummary }).eq("id", sale.id),
  "update 301 sale",
);
const salePayments = await checked(supabase.from("payments").select("id").eq("source_id", sale.id), "load 301 sale payments");
if (salePayments.length !== 1) throw new Error(`Expected one 301 sale payment, got ${salePayments.length}`);
const salePaymentId = salePayments[0].id;
await checked(
  supabase.from("payments").update({
    source_type: "sale_contract",
    payment_date: "2026-06-12",
    amount: 80_000_000,
    currency: "XOF",
    exchange_rate_to_xof: 1,
    receipt_no: "WB4-SALE-301-20260612-HOUSE-01",
    notes: "301\u623f\u6b3e8000\u4e07\uff0c2026-06-12\u4e00\u6b21\u4ed8\u6e05\uff1b\u65e0\u8f66\u4f4d\u3002",
  }).eq("id", salePaymentId),
  "update 301 sale payment",
);
await checked(
  supabase.from("ledger_entries").update({
    unit_id: unit.id,
    direction: "income",
    category: "sale",
    amount_xof: 80_000_000,
    amount_cny: null,
    description: "301\u623f\u6b3e8000\u4e07\uff0c\u5df2\u7ed3\u6e05\u3002",
  }).eq("payment_id", salePaymentId),
  "update 301 sale ledger",
);
const saleReceivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum"), "load 301 sale receivable");
if (saleReceivables.length !== 1) throw new Error(`Expected one 301 sale receivable, got ${saleReceivables.length}`);
await checked(
  supabase.from("receivables").update({ amount_xof: 80_000_000, paid_amount_xof: 80_000_000, status: "paid", notes: `\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx Sheet1\uff1b${saleSummary}` }).eq("id", saleReceivables[0].id),
  "update 301 sale receivable",
);

const historicalName = "\u5019\u7389\u82f1\u3001\u9759\u9759";
const historicalCustomerId = await upsertCustomer(historicalName, "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b301\u5386\u53f2\u79df\u6237\uff0c\u539f\u8868\u59d3\u540d\u8fde\u5199\u3002");
const historicalLeaseNo = "WB-LEASE-SACSI4-301-20230416";
const historicalLeaseId = await upsertLease(historicalLeaseNo, {
  unit_id: unit.id,
  customer_id: historicalCustomerId,
  contract_no: historicalLeaseNo,
  start_date: "2023-04-16",
  expected_end_date: "2025-10-15",
  actual_end_date: "2025-10-15",
  payment_cycle: "semiannual",
  payment_day: 16,
  monthly_rent_xof: 600_000,
  deposit_amount_xof: 1_200_000,
  deposit_received: true,
  rent_free_days: 0,
  signer_name: historicalName,
  status: "terminated",
  expected_end_confirmed: true,
  paid_through_date: "2025-10-15",
});

const historicalEntries = [
  { date: "2023-04-24", amount: 1_200_000, sourceType: "lease_deposit", category: "lease_deposit", direction: "liability_in", receipt: "WB4-LEASE-301-20230424-DEPOSIT-01", title: "301\u5386\u53f2\u62bc\u91d1", notes: "301\u5019\u7389\u82f1\u3001\u9759\u9759\u62bc\u91d1120\u4e07\uff1b\u9000\u79df\u65f6\u5df2\u9000\u3002" },
  { date: "2023-04-24", amount: 3_600_000, sourceType: "lease_rent", category: "lease_rent", direction: "income", receipt: "WB4-LEASE-301-20230424-RENT-01", title: "301\u5386\u53f2\u79df\u91d1", notes: "301\u79df\u91d1360\u4e07\uff0c\u5df2\u7f34\u81f32023-10-15\u3002" },
  { date: "2023-04-24", amount: 240_000, sourceType: "property_fee", category: "other", direction: "income", receipt: "WB4-LEASE-301-20230424-PROP-01", title: "301\u5386\u53f2\u7269\u4e1a\u8d39", notes: "301\u7269\u4e1a\u8d3924\u4e07\uff0c\u5df2\u7f34\u81f32023-10-15\u3002" },
  { date: "2023-10-13", amount: 3_600_000, sourceType: "lease_rent", category: "lease_rent", direction: "income", receipt: "WB4-LEASE-301-20231013-RENT-02", title: "301\u5386\u53f2\u79df\u91d1", notes: "301\u79df\u91d1360\u4e07\uff0c\u5df2\u7f34\u81f32024-04-15\u3002" },
  { date: "2023-10-13", amount: 240_000, sourceType: "property_fee", category: "other", direction: "income", receipt: "WB4-LEASE-301-20231013-PROP-02", title: "301\u5386\u53f2\u7269\u4e1a\u8d39", notes: "301\u7269\u4e1a\u8d3924\u4e07\uff0c\u5df2\u7f34\u81f32024-04-15\u3002" },
  { date: "2024-04-14", amount: 3_600_000, sourceType: "lease_rent", category: "lease_rent", direction: "income", receipt: "WB4-LEASE-301-20240414-RENT-03", title: "301\u5386\u53f2\u79df\u91d1", notes: "301\u79df\u91d1360\u4e07\uff0c\u5df2\u7f34\u81f32024-10-15\u3002" },
  { date: "2024-04-14", amount: 240_000, sourceType: "property_fee", category: "other", direction: "income", receipt: "WB4-LEASE-301-20240414-PROP-03", title: "301\u5386\u53f2\u7269\u4e1a\u8d39", notes: "301\u7269\u4e1a\u8d3924\u4e07\uff0c\u5df2\u7f34\u81f32024-10-15\u3002" },
  { date: "2024-10-17", amount: 3_600_000, sourceType: "lease_rent", category: "lease_rent", direction: "income", receipt: "WB4-LEASE-301-20241017-RENT-04", title: "301\u5386\u53f2\u79df\u91d1", notes: "301\u79df\u91d1360\u4e07\uff0c\u5df2\u7f34\u81f32025-04-15\uff1b\u539f\u8868\u51992024-01-17\uff0c\u6309\u6536\u6b3e\u5468\u671f\u63a8\u65ad\u4e3a2024-10-17\u3002" },
  { date: "2024-10-17", amount: 240_000, sourceType: "property_fee", category: "other", direction: "income", receipt: "WB4-LEASE-301-20241017-PROP-04", title: "301\u5386\u53f2\u7269\u4e1a\u8d39", notes: "301\u7269\u4e1a\u8d3924\u4e07\uff0c\u5df2\u7f34\u81f32025-04-15\uff1b\u65e5\u671f\u6309\u6536\u6b3e\u5468\u671f\u4fee\u6b63\u3002" },
  { date: "2025-03-14", amount: 3_600_000, sourceType: "lease_rent", category: "lease_rent", direction: "income", receipt: "WB4-LEASE-301-20250314-RENT-05", title: "301\u5386\u53f2\u79df\u91d1", notes: "301\u79df\u91d1360\u4e07\uff0c\u5df2\u7f34\u81f32025-10-15\u3002" },
  { date: "2025-03-14", amount: 240_000, sourceType: "property_fee", category: "other", direction: "income", receipt: "WB4-LEASE-301-20250314-PROP-05", title: "301\u5386\u53f2\u7269\u4e1a\u8d39", notes: "301\u7269\u4e1a\u8d3924\u4e07\uff0c\u5df2\u7f34\u81f32025-10-15\u3002" },
  { date: "2025-10-15", amount: 1_200_000, sourceType: "lease_deposit_refund", category: null, direction: "liability_out", receipt: "WB4-LEASE-301-20251015-DEPREF-01", title: null, notes: "301\u5019\u7389\u82f1\u3001\u9759\u9759\u62bc\u91d1120\u4e07\u5df2\u9000\uff1b\u5177\u4f53\u9000\u6b3e\u65e5\u671f\u672a\u8bb0\u8f7d\uff0c\u4ee5\u9000\u79df\u65e5\u4f5c\u8d26\u52a1\u65e5\u3002", receivable: false },
];
for (const entry of historicalEntries) await upsertEntry({ leaseId: historicalLeaseId, customerId: historicalCustomerId, ...entry });

const currentLease = await checked(
  supabase.from("lease_contracts").select("id, customer_id").eq("unit_id", unit.id).eq("start_date", "2025-11-01").single(),
  "load current 301 lease",
);
const currentLeaseNo = "WB-LEASE-SACSI4-301-20251101";
await checked(
  supabase.from("lease_contracts").update({
    contract_no: currentLeaseNo,
    expected_end_date: "2026-10-31",
    actual_end_date: null,
    payment_cycle: "semiannual",
    payment_day: 1,
    monthly_rent_xof: 600_000,
    deposit_amount_xof: 1_200_000,
    deposit_received: true,
    status: "active",
    expected_end_confirmed: true,
    paid_through_date: "2026-10-31",
  }).eq("id", currentLease.id),
  "update current 301 lease",
);
const currentEntries = [
  { date: "2025-10-01", amount: 1_200_000, sourceType: "lease_deposit", category: "lease_deposit", direction: "liability_in", receipt: "WB4-LEASE-301-20251001-DEPOSIT-01", title: "301\u4e2d\u80fd\u5efa\u62bc\u91d1", notes: "301\u4e2d\u80fd\u5efa\u62bc\u91d1120\u4e07\uff1b\u5f53\u524d\u4ecd\u5728\u79df\uff0c\u672a\u9000\u3002" },
  { date: "2025-10-01", amount: 3_600_000, sourceType: "lease_rent", category: "lease_rent", direction: "income", receipt: "WB4-LEASE-301-20251001-RENT-01", title: "301\u4e2d\u80fd\u5efa\u79df\u91d1", notes: "301\u4e2d\u80fd\u5efa\u79df\u91d1360\u4e07\uff0c2025-11-01\u81f32026-04-30\u3002" },
  { date: "2025-10-01", amount: 240_000, sourceType: "property_fee", category: "other", direction: "income", receipt: "WB4-LEASE-301-20251001-PROP-01", title: "301\u4e2d\u80fd\u5efa\u7269\u4e1a\u8d39", notes: "301\u4e2d\u80fd\u5efa\u7269\u4e1a\u8d3924\u4e07\uff0c2025-11-01\u81f32026-04-30\u3002" },
  { date: "2025-11-28", amount: 3_600_000, sourceType: "lease_rent", category: "lease_rent", direction: "income", receipt: "WB4-LEASE-301-20251128-RENT-02", oldReceipt: "WB4-L-301-20251128-RENT", title: "301\u4e2d\u80fd\u5efa\u79df\u91d1", notes: "301\u4e2d\u80fd\u5efa\u79df\u91d1360\u4e07\uff0c2026-05-01\u81f32026-10-31\u3002" },
  { date: "2025-11-28", amount: 240_000, sourceType: "property_fee", category: "other", direction: "income", receipt: "WB4-LEASE-301-20251128-PROP-02", title: "301\u4e2d\u80fd\u5efa\u7269\u4e1a\u8d39", notes: "301\u4e2d\u80fd\u5efa\u7269\u4e1a\u8d3924\u4e07\uff0c2026-05-01\u81f32026-10-31\u3002" },
];
for (const entry of currentEntries) await upsertEntry({ leaseId: currentLease.id, customerId: currentLease.customer_id, ...entry });

await checked(
  supabase.from("units").update({
    status: "sold",
    notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u4e1a\u4e3b/\u4e70\u65b9\u4e07\u6881\u3001\u5f20\u536b\u840d\uff0c\u623f\u6b3e8000\u4e07\u5df2\u7ed3\u6e05\uff1b\u5019\u7389\u82f1\u3001\u9759\u97592023-04-16\u81f32025-10-15\u5df2\u9000\u79df\u4e14\u62bc\u91d1\u5df2\u9000\uff1b\u4e2d\u80fd\u5efa2025-11-01\u81f32026-10-31\u4ecd\u5728\u79df\uff0c\u6708\u79df60\u4e07\u3001\u7269\u4e1a\u8d394\u4e07\uff0c\u5df2\u7f34\u81f32026-10-31\u3002",
  }).eq("id", unit.id),
  "update 301 unit note",
);
await checked(
  supabase.from("audit_logs").insert({
    action: "reconcile_floor_lease_sale_data",
    entity_type: "building",
    entity_id: building.id,
    metadata: {
      building_code: "SACSI4",
      unit: "301",
      sale_total_xof: 80_000_000,
      sale_settled: true,
      historical_lease_rent_xof: 18_000_000,
      historical_property_fee_xof: 1_200_000,
      historical_deposit_refunded_xof: 1_200_000,
      current_lease_rent_xof: 7_200_000,
      current_property_fee_xof: 480_000,
      current_deposit_held_xof: 1_200_000,
      current_paid_through_date: "2026-10-31",
    },
  }),
  "write 301 audit log",
);

const finalLeases = await checked(
  supabase.from("lease_contracts").select("id, contract_no, status, monthly_rent_xof, paid_through_date").eq("unit_id", unit.id).order("start_date"),
  "verify 301 leases",
);
const finalPayments = await checked(supabase.from("payments").select("source_id, source_type, amount").in("source_id", [sale.id, historicalLeaseId, currentLease.id]), "verify 301 payments");
console.log(JSON.stringify({ ok: true, sale_contract_no: "WB-SALE-SACSI4-301-20260612", leases: finalLeases, payment_count: finalPayments.length }));
