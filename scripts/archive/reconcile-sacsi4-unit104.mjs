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
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function checked(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI4").single(), "load building");
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "104").single(), "load unit 104");
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, signed_date").eq("unit_id", unit.id).single(), "load 104 sale");
if (sale.signed_date !== "2024-11-07") throw new Error(`Unexpected 104 sale date ${sale.signed_date}`);
await checked(
  supabase.from("sale_contracts").update({
    contract_no: "WB-SALE-SACSI4-104-20241107",
    total_amount_xof: 100_000_000,
    payment_plan_type: "\u5408\u540c\u603b\u4ef710000\u4e07\uff0c\u65e0\u8f66\u4f4d\uff1b2024-11-07\u548c2024-11-23\u5404\u65365000\u4e07\uff1b\u5df2\u7ed3\u6e05\u3002",
  }).eq("id", sale.id),
  "update 104 sale",
);
const consolidated = await checked(supabase.from("payments").select("id").eq("source_id", sale.id).eq("receipt_no", "S4-SALE-104-CONSOLIDATED").single(), "load 104 consolidated sale payment");
await checked(
  supabase.from("payments").update({
    source_type: "sale_contract",
    payment_date: "2024-11-07",
    amount: 50_000_000,
    receipt_no: "WB4-SALE-104-20241107-HOUSE-01",
    notes: "104\u623f\u6b3e5000\u4e07\uff0c\u5b58\u5165\u9ad8\u603b\u8d26\u53f7\uff1b\u65e0\u8f66\u4f4d\u3002",
  }).eq("id", consolidated.id),
  "split 104 first sale payment",
);
await checked(
  supabase.from("ledger_entries").update({
    unit_id: unit.id,
    direction: "income",
    category: "sale",
    amount_xof: 50_000_000,
    amount_cny: null,
    description: "104\u623f\u6b3e5000\u4e07\uff0c\u5b58\u5165\u9ad8\u603b\u8d26\u53f7\u3002",
  }).eq("payment_id", consolidated.id),
  "update 104 first sale ledger",
);
const secondSaleReceipt = "WB4-SALE-104-20241123-HOUSE-02";
const secondSalePayload = { customer_id: sale.customer_id, unit_id: unit.id, source_type: "sale_contract", source_id: sale.id, payment_date: "2024-11-23", amount: 50_000_000, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: secondSaleReceipt, notes: "104\u623f\u6b3e\u73b0\u91d15000\u4e07\uff1b\u65e0\u8f66\u4f4d\uff1b\u5df2\u7ed3\u6e05\u3002" };
let secondSaleRows = await checked(supabase.from("payments").select("id").eq("source_id", sale.id).eq("receipt_no", secondSaleReceipt), "find 104 second sale payment");
if (secondSaleRows.length > 1) throw new Error(`Duplicate 104 second sale payments: ${secondSaleRows.length}`);
let secondSaleId;
if (secondSaleRows.length === 1) {
  secondSaleId = secondSaleRows[0].id;
  await checked(supabase.from("payments").update(secondSalePayload).eq("id", secondSaleId), "update 104 second sale payment");
} else {
  const inserted = await checked(supabase.from("payments").insert(secondSalePayload).select("id").single(), "insert 104 second sale payment");
  secondSaleId = inserted.id;
}
const secondSaleLedger = { building_id: building.id, unit_id: unit.id, payment_id: secondSaleId, entry_date: "2024-11-23", direction: "income", category: "sale", amount_xof: 50_000_000, amount_cny: null, description: "104\u623f\u6b3e\u73b0\u91d15000\u4e07\uff1b\u5df2\u7ed3\u6e05\u3002" };
const secondSaleLedgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", secondSaleId), "find 104 second sale ledger");
if (secondSaleLedgers.length > 1) throw new Error(`Duplicate 104 second sale ledgers: ${secondSaleLedgers.length}`);
if (secondSaleLedgers.length === 1) await checked(supabase.from("ledger_entries").update(secondSaleLedger).eq("id", secondSaleLedgers[0].id), "update 104 second sale ledger");
else await checked(supabase.from("ledger_entries").insert(secondSaleLedger), "insert 104 second sale ledger");
const saleReceivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum"), "load 104 sale receivable");
if (saleReceivables.length !== 1) throw new Error(`Expected one 104 sale receivable, got ${saleReceivables.length}`);
await checked(
  supabase.from("receivables").update({ amount_xof: 100_000_000, paid_amount_xof: 100_000_000, status: "paid", notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx Sheet1\uff1b\u5408\u540c\u603b\u4ef710000\u4e07\uff0c\u65e0\u8f66\u4f4d\uff1b\u4e24\u7b14\u54045000\u4e07\uff1b\u5df2\u7ed3\u6e05\u3002" }).eq("id", saleReceivables[0].id),
  "update 104 sale receivable",
);

const lease = await checked(supabase.from("lease_contracts").select("id, customer_id, start_date").eq("unit_id", unit.id).single(), "load 104 lease");
if (lease.start_date !== "2021-11-01") throw new Error(`Unexpected 104 lease date ${lease.start_date}`);
await checked(
  supabase.from("lease_contracts").update({
    contract_no: "WB-LEASE-SACSI4-104-20211101",
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
  }).eq("id", lease.id),
  "update 104 lease",
);

const leaseEntries = [
  { date: "2021-10-27", amount: 1_200_000, type: "lease_deposit", direction: "liability_in", category: "lease_deposit", recCategory: "lease_deposit", receipt: "WB4-LEASE-104-20211027-DEPOSIT-01", title: "104\u62bc\u91d1", notes: "104\u82df\u5b87\u9e3f\u62bc\u91d1120\u4e07\uff1b\u5f53\u524d\u4ecd\u5728\u79df\uff0c\u672a\u9000\u3002" },
  { date: "2021-11-05", amount: 3_600_000, type: "lease_rent", direction: "income", category: "lease_rent", recCategory: "lease_rent", receipt: "WB4-LEASE-104-20211105-RENT-01", title: "104\u5386\u53f2\u79df\u91d1", notes: "104\u79df\u91d1360\u4e07\uff0c2021-11-01\u81f32022-04-30\u3002" },
  { date: "2022-05-11", amount: 3_600_000, type: "lease_rent", direction: "income", category: "lease_rent", recCategory: "lease_rent", receipt: "WB4-LEASE-104-20220511-RENT-02", title: "104\u5386\u53f2\u79df\u91d1", notes: "104\u79df\u91d1360\u4e07\uff0c\u5df2\u7f34\u81f32022-10-31\u3002" },
  { date: "2022-05-11", amount: 240_000, type: "property_fee", direction: "income", category: "property_fee", recCategory: "other", receipt: "WB4-LEASE-104-20220511-PROP-01", title: "104\u5386\u53f2\u7269\u4e1a\u8d39", notes: "104\u7269\u4e1a\u8d3924\u4e07\uff0c\u5df2\u7f34\u81f32022-10-31\u3002" },
  { date: "2022-11-07", amount: 3_600_000, type: "lease_rent", direction: "income", category: "lease_rent", recCategory: "lease_rent", receipt: "WB4-LEASE-104-20221107-RENT-03", title: "104\u5386\u53f2\u79df\u91d1", notes: "104\u79df\u91d1360\u4e07\uff0c\u5df2\u7f34\u81f32023-04-30\u3002" },
  { date: "2022-11-07", amount: 240_000, type: "property_fee", direction: "income", category: "property_fee", recCategory: "other", receipt: "WB4-LEASE-104-20221107-PROP-02", title: "104\u5386\u53f2\u7269\u4e1a\u8d39", notes: "104\u7269\u4e1a\u8d3924\u4e07\uff0c\u5df2\u7f34\u81f32023-04-30\u3002" },
  { date: "2023-04-25", amount: 3_600_000, type: "lease_rent", direction: "income", category: "lease_rent", recCategory: "lease_rent", receipt: "WB4-LEASE-104-20230425-RENT-04", title: "104\u5386\u53f2\u79df\u91d1", notes: "104\u79df\u91d1360\u4e07\uff0c\u5df2\u7f34\u81f32023-10-31\u3002" },
  { date: "2023-04-25", amount: 240_000, type: "property_fee", direction: "income", category: "property_fee", recCategory: "other", receipt: "WB4-LEASE-104-20230425-PROP-03", title: "104\u5386\u53f2\u7269\u4e1a\u8d39", notes: "104\u7269\u4e1a\u8d3924\u4e07\uff0c\u5df2\u7f34\u81f32023-10-31\u3002" },
  { date: "2023-10-20", amount: 3_600_000, type: "lease_rent", direction: "income", category: "lease_rent", recCategory: "lease_rent", receipt: "WB4-LEASE-104-20231020-RENT-05", title: "104\u5386\u53f2\u79df\u91d1", notes: "104\u79df\u91d1360\u4e07\uff0c\u5df2\u7f34\u81f32024-04-30\u3002" },
  { date: "2023-10-30", amount: 240_000, type: "property_fee", direction: "income", category: "property_fee", recCategory: "other", receipt: "WB4-LEASE-104-20231030-PROP-04", title: "104\u5386\u53f2\u7269\u4e1a\u8d39", notes: "104\u7269\u4e1a\u8d3924\u4e07\uff0c\u5df2\u7f34\u81f32024-04-30\u3002" },
  { date: "2024-04-30", amount: 3_600_000, type: "lease_rent", direction: "income", category: "lease_rent", recCategory: "lease_rent", receipt: "WB4-LEASE-104-20240430-RENT-06", title: "104\u5386\u53f2\u79df\u91d1", notes: "104\u79df\u91d1360\u4e07\uff0c\u5df2\u7f34\u81f32024-10-31\u3002" },
  { date: "2024-04-30", amount: 240_000, type: "property_fee", direction: "income", category: "property_fee", recCategory: "other", receipt: "WB4-LEASE-104-20240430-PROP-05", title: "104\u5386\u53f2\u7269\u4e1a\u8d39", notes: "104\u7269\u4e1a\u8d3924\u4e07\uff0c\u5df2\u7f34\u81f32024-10-31\u3002" },
  { date: "2024-11-06", amount: 3_600_000, type: "lease_rent", direction: "income", category: "lease_rent", recCategory: "lease_rent", receipt: "WB4-LEASE-104-20241106-RENT-07", title: "104\u5386\u53f2\u79df\u91d1", notes: "104\u79df\u91d1360\u4e07\uff0c\u5df2\u7f34\u81f32025-04-30\u3002" },
  { date: "2024-11-06", amount: 240_000, type: "property_fee", direction: "income", category: "property_fee", recCategory: "other", receipt: "WB4-LEASE-104-20241106-PROP-06", title: "104\u5386\u53f2\u7269\u4e1a\u8d39", notes: "104\u7269\u4e1a\u8d3924\u4e07\uff0c\u5df2\u7f34\u81f32025-04-30\u3002" },
  { date: "2025-05-05", amount: 3_600_000, type: "lease_rent", direction: "income", category: "lease_rent", recCategory: "lease_rent", receipt: "WB4-LEASE-104-20250505-RENT-08", title: "104\u5386\u53f2\u79df\u91d1", notes: "104\u79df\u91d1360\u4e07\uff0c\u5df2\u7f34\u81f32025-10-31\u3002" },
  { date: "2025-05-05", amount: 240_000, type: "property_fee", direction: "income", category: "property_fee", recCategory: "other", receipt: "WB4-LEASE-104-20250505-PROP-07", title: "104\u5386\u53f2\u7269\u4e1a\u8d39", notes: "104\u7269\u4e1a\u8d3924\u4e07\uff0c\u5df2\u7f34\u81f32025-10-31\u3002" },
  { date: "2025-11-08", amount: 3_600_000, type: "lease_rent", direction: "income", category: "lease_rent", recCategory: "lease_rent", receipt: "WB4-LEASE-104-20251108-RENT-09", title: "104\u5386\u53f2\u79df\u91d1", notes: "104\u79df\u91d1360\u4e07\uff0c\u5df2\u7f34\u81f32026-04-30\u3002" },
  { date: "2025-11-08", amount: 240_000, type: "property_fee", direction: "income", category: "property_fee", recCategory: "other", receipt: "WB4-LEASE-104-20251108-PROP-08", title: "104\u5386\u53f2\u7269\u4e1a\u8d39", notes: "104\u7269\u4e1a\u8d3924\u4e07\uff0c\u5df2\u7f34\u81f32026-04-30\u3002" },
  { date: "2026-04-29", amount: 3_600_000, type: "lease_rent", direction: "income", category: "lease_rent", recCategory: "lease_rent", receipt: "WB4-LEASE-104-20260429-RENT-10", oldReceipt: "WB4-L-104-20260429-RENT", title: "104\u5386\u53f2\u79df\u91d1", notes: "104\u79df\u91d1360\u4e07\uff0c\u5df2\u7f34\u81f32026-10-31\u3002" },
  { date: "2026-04-29", amount: 240_000, type: "property_fee", direction: "income", category: "property_fee", recCategory: "other", receipt: "WB4-LEASE-104-20260429-PROP-09", title: "104\u5386\u53f2\u7269\u4e1a\u8d39", notes: "104\u7269\u4e1a\u8d3924\u4e07\uff0c\u5df2\u7f34\u81f32026-10-31\u3002" },
];

for (const entry of leaseEntries) {
  const payload = { customer_id: lease.customer_id, unit_id: unit.id, source_type: entry.type, source_id: lease.id, payment_date: entry.date, amount: entry.amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: entry.receipt, notes: entry.notes };
  let rows = await checked(supabase.from("payments").select("id").eq("source_id", lease.id).eq("receipt_no", entry.receipt), `find ${entry.receipt}`);
  if (rows.length === 0 && entry.oldReceipt) rows = await checked(supabase.from("payments").select("id").eq("source_id", lease.id).eq("receipt_no", entry.oldReceipt), `find old ${entry.oldReceipt}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${entry.receipt}`);
  let paymentId;
  if (rows.length === 1) {
    paymentId = rows[0].id;
    await checked(supabase.from("payments").update(payload).eq("id", paymentId), `update ${entry.receipt}`);
  } else {
    const inserted = await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${entry.receipt}`);
    paymentId = inserted.id;
  }
  const ledgerPayload = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: entry.date, direction: entry.direction, category: entry.category, amount_xof: entry.amount, amount_cny: null, description: entry.notes };
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${entry.receipt}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${entry.receipt}`);
  if (ledgers.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgers[0].id), `update ledger ${entry.receipt}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${entry.receipt}`);
  const receivablePayload = { building_id: building.id, unit_id: unit.id, customer_id: lease.customer_id, source_type: "lease_contract", source_id: lease.id, category: entry.recCategory, title: entry.title, due_date: entry.date, amount_xof: entry.amount, paid_amount_xof: entry.amount, status: "paid", currency: "XOF", notes: entry.notes };
  const recs = await checked(supabase.from("receivables").select("id").eq("source_id", lease.id).eq("notes", entry.notes), `find receivable ${entry.receipt}`);
  if (recs.length > 1) throw new Error(`Duplicate receivable ${entry.receipt}`);
  if (recs.length === 1) await checked(supabase.from("receivables").update(receivablePayload).eq("id", recs[0].id), `update receivable ${entry.receipt}`);
  else await checked(supabase.from("receivables").insert(receivablePayload), `insert receivable ${entry.receipt}`);
}

await checked(
  supabase.from("units").update({ notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u4e1a\u4e3bCAMARA LAMINE\uff0c\u51fa\u552e10000\u4e07\u65e0\u8f66\u4f4d\uff0c\u5df2\u7ed3\u6e05\uff1b\u82df\u5b87\u9e3f\u4ecd\u5728\u79df\uff0c\u6708\u79df60\u4e07\u3001\u7269\u4e1a\u8d394\u4e07\uff0c\u5df2\u7f34\u81f32026-10-31\u3002" }).eq("id", unit.id),
  "update unit 104 note",
);
await checked(
  supabase.from("audit_logs").insert({
    action: "reconcile_floor_lease_sale_data",
    entity_type: "building",
    entity_id: building.id,
    metadata: { building_code: "SACSI4", unit: "104", sale_total_xof: 100_000_000, sale_settled: true, sale_has_parking: false, lease_active: true, lease_rent_received_xof: 36_000_000, property_fee_received_xof: 2_160_000, deposit_held_xof: 1_200_000, paid_through_date: "2026-10-31" },
  }),
  "write audit log",
);

console.log(JSON.stringify({ ok: true, sale: { total: 100_000_000, settled: true }, lease: { active: true, rent: 36_000_000, property: 2_160_000, depositHeld: 1_200_000, paidThrough: "2026-10-31" } }));
