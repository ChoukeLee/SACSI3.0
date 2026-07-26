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
  supabase.from("units").select("id, status").eq("building_id", building.id).eq("unit_no", "302").single(),
  "load unit 302",
);
const sales = await checked(supabase.from("sale_contracts").select("id").eq("unit_id", unit.id), "check 302 sales");
if (sales.length !== 0) throw new Error(`Expected no 302 sale, got ${sales.length}`);

async function upsertCustomer(name, notes) {
  const rows = await checked(supabase.from("customers").select("id").eq("name", name), `find customer ${name}`);
  if (rows.length > 1) throw new Error(`Duplicate customer ${name}`);
  if (rows.length === 1) return rows[0].id;
  return (await checked(supabase.from("customers").insert({ name, notes }).select("id").single(), `insert customer ${name}`)).id;
}

async function upsertLease(spec, customerId) {
  const rows = await checked(supabase.from("lease_contracts").select("id").eq("contract_no", spec.contractNo), `find ${spec.contractNo}`);
  if (rows.length > 1) throw new Error(`Duplicate lease ${spec.contractNo}`);
  const payload = {
    unit_id: unit.id,
    customer_id: customerId,
    contract_no: spec.contractNo,
    start_date: spec.start,
    expected_end_date: spec.expectedEnd,
    actual_end_date: spec.actualEnd,
    payment_cycle: "semiannual",
    payment_day: Number(spec.start.slice(-2)),
    monthly_rent_xof: spec.monthlyRent,
    deposit_amount_xof: spec.deposit,
    deposit_received: true,
    rent_free_days: 0,
    signer_name: spec.customer,
    status: "terminated",
    expected_end_confirmed: true,
    paid_through_date: spec.paidThrough,
  };
  if (rows.length === 1) {
    await checked(supabase.from("lease_contracts").update(payload).eq("id", rows[0].id), `update ${spec.contractNo}`);
    return rows[0].id;
  }
  return (await checked(supabase.from("lease_contracts").insert(payload).select("id").single(), `insert ${spec.contractNo}`)).id;
}

async function upsertEntry(leaseId, customerId, entry) {
  const rows = await checked(supabase.from("payments").select("id").eq("source_id", leaseId).eq("receipt_no", entry.receipt), `find ${entry.receipt}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${entry.receipt}`);
  const paymentPayload = {
    customer_id: customerId,
    unit_id: unit.id,
    source_type: entry.sourceType,
    source_id: leaseId,
    payment_date: entry.date,
    amount: entry.amount,
    currency: "XOF",
    exchange_rate_to_xof: 1,
    receipt_no: entry.receipt,
    notes: entry.notes,
  };
  let paymentId;
  if (rows.length === 1) {
    paymentId = rows[0].id;
    await checked(supabase.from("payments").update(paymentPayload).eq("id", paymentId), `update ${entry.receipt}`);
  } else {
    paymentId = (await checked(supabase.from("payments").insert(paymentPayload).select("id").single(), `insert ${entry.receipt}`)).id;
  }
  const ledgerPayload = {
    building_id: building.id,
    unit_id: unit.id,
    payment_id: paymentId,
    entry_date: entry.date,
    direction: entry.direction,
    category: entry.sourceType,
    amount_xof: entry.amount,
    amount_cny: null,
    description: entry.notes,
  };
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${entry.receipt}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${entry.receipt}`);
  if (ledgers.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgers[0].id), `update ledger ${entry.receipt}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${entry.receipt}`);

  if (entry.receivable === false) return;
  const receivablePayload = {
    building_id: building.id,
    unit_id: unit.id,
    customer_id: customerId,
    source_type: "lease_contract",
    source_id: leaseId,
    category: entry.category,
    title: entry.title,
    due_date: entry.date,
    amount_xof: entry.amount,
    paid_amount_xof: entry.amount,
    status: "paid",
    currency: "XOF",
    notes: entry.notes,
  };
  const receivables = await checked(supabase.from("receivables").select("id").eq("source_id", leaseId).eq("notes", entry.notes), `find receivable ${entry.receipt}`);
  if (receivables.length > 1) throw new Error(`Duplicate receivable ${entry.receipt}`);
  if (receivables.length === 1) await checked(supabase.from("receivables").update(receivablePayload).eq("id", receivables[0].id), `update receivable ${entry.receipt}`);
  else await checked(supabase.from("receivables").insert(receivablePayload), `insert receivable ${entry.receipt}`);
}

const specs = [
  {
    customer: "\u5468\u4e95\u8d85/\u9752\u5efa",
    customerNotes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b302\u5386\u53f2\u79df\u6237\uff0c\u539f\u8868\u8bb0\u4e3a\u201c\u5468\u4e95\u8d85\u7ed9\u9752\u5efa\u201d\u3002",
    contractNo: "WB-LEASE-SACSI4-302-20220701",
    start: "2022-07-01",
    expectedEnd: "2023-01-31",
    actualEnd: "2023-01-31",
    paidThrough: "2023-01-31",
    monthlyRent: 600_000,
    deposit: 1_200_000,
    entries: [
      { date: "2022-06-25", amount: 1_200_000, sourceType: "lease_deposit", category: "lease_deposit", direction: "liability_in", receipt: "WB4-LEASE-302-20220625-DEPOSIT-01", title: "302\u5386\u53f2\u62bc\u91d1", notes: "302\u5468\u4e95\u8d85/\u9752\u5efa\u62bc\u91d1120\u4e07\uff1b\u9000\u79df\u65f6\u5df2\u9000\u3002" },
      { date: "2022-06-25", amount: 3_600_000, sourceType: "lease_rent", category: "lease_rent", direction: "income", receipt: "WB4-LEASE-302-20220625-RENT-01", title: "302\u5386\u53f2\u79df\u91d1", notes: "302\u79df\u91d1360\u4e07\uff0c2022-07-01\u81f32022-12-31\u3002" },
      { date: "2022-06-25", amount: 240_000, sourceType: "property_fee", category: "other", direction: "income", receipt: "WB4-LEASE-302-20220625-PROP-01", title: "302\u5386\u53f2\u7269\u4e1a\u8d39", notes: "302\u7269\u4e1a\u8d3924\u4e07\uff0c2022-07-01\u81f32022-12-31\u3002" },
      { date: "2023-01-10", amount: 600_000, sourceType: "lease_rent", category: "lease_rent", direction: "income", receipt: "WB4-LEASE-302-20230110-RENT-02", title: "302\u5386\u53f2\u79df\u91d1", notes: "302\u79df\u91d160\u4e07\uff0c\u5df2\u7f34\u81f32023-01-31\u3002" },
      { date: "2023-01-10", amount: 40_000, sourceType: "property_fee", category: "other", direction: "income", receipt: "WB4-LEASE-302-20230110-PROP-02", title: "302\u5386\u53f2\u7269\u4e1a\u8d39", notes: "302\u7269\u4e1a\u8d394\u4e07\uff0c\u5df2\u7f34\u81f32023-01-31\u3002" },
      { date: "2023-01-31", amount: 1_200_000, sourceType: "lease_deposit_refund", direction: "liability_out", receipt: "WB4-LEASE-302-20230131-DEPREF-01", notes: "302\u5468\u4e95\u8d85/\u9752\u5efa\u62bc\u91d1120\u4e07\u5df2\u9000\uff1b\u5177\u4f53\u9000\u6b3e\u65e5\u671f\u672a\u8bb0\u8f7d\uff0c\u4ee5\u9000\u79df\u65e5\u4f5c\u8d26\u52a1\u65e5\u3002", receivable: false },
    ],
  },
  {
    customer: "LAPKA",
    customerNotes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b302\u5386\u53f2\u79df\u6237\u3002",
    contractNo: "WB-LEASE-SACSI4-302-20230301",
    start: "2023-03-01",
    expectedEnd: "2023-08-30",
    actualEnd: "2023-08-31",
    paidThrough: "2023-08-31",
    monthlyRent: 500_000,
    deposit: 1_000_000,
    entries: [
      { date: "2023-02-14", amount: 1_000_000, sourceType: "lease_deposit", category: "lease_deposit", direction: "liability_in", receipt: "WB4-LEASE-302-20230214-DEPOSIT-01", title: "302 LAPKA\u62bc\u91d1", notes: "302 LAPKA\u62bc\u91d1100\u4e07\uff1b\u9000\u79df\u65f6\u626328.06\u4e07\u3001\u5b9e\u900071.94\u4e07\u3002" },
      { date: "2023-02-14", amount: 2_500_000, sourceType: "lease_rent", category: "lease_rent", direction: "income", receipt: "WB4-LEASE-302-20230214-RENT-01", title: "302 LAPKA\u79df\u91d1", notes: "302 LAPKA\u79df\u91d1250\u4e07\uff0c2023-03-01\u81f32023-07-31\u3002" },
      { date: "2023-02-14", amount: 175_000, sourceType: "property_fee", category: "other", direction: "income", receipt: "WB4-LEASE-302-20230214-PROP-01", title: "302 LAPKA\u7269\u4e1a\u8d39", notes: "302 LAPKA\u7269\u4e1a\u8d3917.5\u4e07\uff0c2023-03-01\u81f32023-07-31\u3002" },
      { date: "2023-02-14", amount: 500_000, sourceType: "lease_agency_income", category: "other", direction: "income", receipt: "WB4-LEASE-302-20230214-AGENCY-01", title: "302 LAPKA\u4e2d\u4ecb\u8d39", notes: "302 LAPKA\u4e2d\u4ecb\u8d39\u6536\u516550\u4e07\uff0c\u4e0e\u62bc\u91d1\u3001\u79df\u91d1\u3001\u7269\u4e1a\u8d39\u5206\u5217\u3002" },
      { date: "2023-08-10", amount: 495_000, sourceType: "lease_rent", category: "lease_rent", direction: "income", receipt: "WB4-LEASE-302-20230810-RENT-02", title: "302 LAPKA\u79df\u91d1", notes: "302 LAPKA\u7eed\u79df\u81f32023-08-31\uff0c\u79df\u91d1\u5b9e\u653649.5\u4e07\uff1b\u630950\u4e07\u62631%\u540e\u8bb0\u8d26\u3002" },
      { date: "2023-08-10", amount: 34_650, sourceType: "property_fee", category: "other", direction: "income", receipt: "WB4-LEASE-302-20230810-PROP-02", title: "302 LAPKA\u7269\u4e1a\u8d39", notes: "302 LAPKA\u7eed\u79df\u81f32023-08-31\uff0c\u7269\u4e1a\u8d39\u5b9e\u65363.465\u4e07\uff1b\u63093.5\u4e07\u62631%\u540e\u8bb0\u8d26\u3002" },
      { date: "2023-11-02", amount: 280_600, sourceType: "lease_deposit_deduction", direction: "liability_out", receipt: "WB4-LEASE-302-20231102-DEPDED-01", notes: "302 LAPKA\u62bc\u91d1\u6263\u6b3e28.06\u4e07\uff0c\u5305\u542b\u8df3\u7968\u8d39\u3001\u7535\u8d39\u3001\u5237\u5899\u7b49\uff0c\u4e0e\u5b9e\u900071.94\u4e07\u95ed\u73af100\u4e07\u62bc\u91d1\u3002", receivable: false },
      { date: "2023-11-02", amount: 719_400, sourceType: "lease_deposit_refund", direction: "liability_out", receipt: "WB4-LEASE-302-20231102-DEPREF-01", notes: "302 LAPKA\u5b9e\u9000\u62bc\u91d171.94\u4e07\uff1b\u62bc\u91d1\u5df2\u6e05\u3002", receivable: false },
    ],
  },
  {
    customer: "\u4e2d\u6c7d\u5de5\u4e1a",
    customerNotes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b302\u5386\u53f2\u79df\u6237\u3002",
    contractNo: "WB-LEASE-SACSI4-302-20231001",
    start: "2023-10-01",
    expectedEnd: "2025-04-30",
    actualEnd: "2025-04-30",
    paidThrough: "2025-04-30",
    monthlyRent: 500_000,
    deposit: 1_000_000,
    entries: [
      { date: "2023-09-18", amount: 1_000_000, sourceType: "lease_deposit", category: "lease_deposit", direction: "liability_in", receipt: "WB4-LEASE-302-20230918-DEPOSIT-01", title: "302\u4e2d\u6c7d\u5de5\u4e1a\u62bc\u91d1", notes: "302\u4e2d\u6c7d\u5de5\u4e1a\u62bc\u91d1100\u4e07\uff1b\u9000\u79df\u65f6\u5df2\u9000\u3002" },
      { date: "2023-09-18", amount: 3_000_000, sourceType: "lease_rent", category: "lease_rent", direction: "income", receipt: "WB4-LEASE-302-20230918-RENT-01", title: "302\u4e2d\u6c7d\u5de5\u4e1a\u79df\u91d1", notes: "302\u4e2d\u6c7d\u5de5\u4e1a\u79df\u91d1300\u4e07\uff0c2023-10-01\u81f32024-03-31\u3002" },
      { date: "2023-09-18", amount: 210_000, sourceType: "property_fee", category: "other", direction: "income", receipt: "WB4-LEASE-302-20230918-PROP-01", title: "302\u4e2d\u6c7d\u5de5\u4e1a\u7269\u4e1a\u8d39", notes: "302\u4e2d\u6c7d\u5de5\u4e1a\u7269\u4e1a\u8d3921\u4e07\uff0c2023-10-01\u81f32024-03-31\u3002" },
      { date: "2023-09-18", amount: 500_000, sourceType: "lease_agency_income", category: "other", direction: "income", receipt: "WB4-LEASE-302-20230918-AGENCY-01", title: "302\u4e2d\u6c7d\u5de5\u4e1a\u4e2d\u4ecb\u8d39", notes: "302\u4e2d\u6c7d\u5de5\u4e1a\u4e2d\u4ecb\u8d39\u6536\u516550\u4e07\uff0c\u5355\u5217\u3002" },
      { date: "2024-04-02", amount: 3_000_000, sourceType: "lease_rent", category: "lease_rent", direction: "income", receipt: "WB4-LEASE-302-20240402-RENT-02", title: "302\u4e2d\u6c7d\u5de5\u4e1a\u79df\u91d1", notes: "302\u4e2d\u6c7d\u5de5\u4e1a\u79df\u91d1300\u4e07\uff0c2024-04-01\u81f32024-09-30\u3002" },
      { date: "2024-04-02", amount: 210_000, sourceType: "property_fee", category: "other", direction: "income", receipt: "WB4-LEASE-302-20240402-PROP-02", title: "302\u4e2d\u6c7d\u5de5\u4e1a\u7269\u4e1a\u8d39", notes: "302\u4e2d\u6c7d\u5de5\u4e1a\u7269\u4e1a\u8d3921\u4e07\uff0c2024-04-01\u81f32024-09-30\u3002" },
      { date: "2024-10-04", amount: 3_000_000, sourceType: "lease_rent", category: "lease_rent", direction: "income", receipt: "WB4-LEASE-302-20241004-RENT-03", title: "302\u4e2d\u6c7d\u5de5\u4e1a\u79df\u91d1", notes: "302\u4e2d\u6c7d\u5de5\u4e1a\u79df\u91d1300\u4e07\uff0c2024-10-01\u81f32025-03-31\u3002" },
      { date: "2024-10-04", amount: 210_000, sourceType: "property_fee", category: "other", direction: "income", receipt: "WB4-LEASE-302-20241004-PROP-03", title: "302\u4e2d\u6c7d\u5de5\u4e1a\u7269\u4e1a\u8d39", notes: "302\u4e2d\u6c7d\u5de5\u4e1a\u7269\u4e1a\u8d3921\u4e07\uff0c2024-10-01\u81f32025-03-31\u3002" },
      { date: "2025-04-08", amount: 500_000, sourceType: "lease_rent", category: "lease_rent", direction: "income", receipt: "WB4-LEASE-302-20250408-RENT-04", title: "302\u4e2d\u6c7d\u5de5\u4e1a\u79df\u91d1", notes: "302\u4e2d\u6c7d\u5de5\u4e1a\u79df\u91d150\u4e07\uff0c\u5df2\u7f34\u81f32025-04-30\u3002" },
      { date: "2025-04-08", amount: 35_000, sourceType: "property_fee", category: "other", direction: "income", receipt: "WB4-LEASE-302-20250408-PROP-04", title: "302\u4e2d\u6c7d\u5de5\u4e1a\u7269\u4e1a\u8d39", notes: "302\u4e2d\u6c7d\u5de5\u4e1a\u7269\u4e1a\u8d393.5\u4e07\uff0c\u5df2\u7f34\u81f32025-04-30\u3002" },
      { date: "2025-04-30", amount: 1_000_000, sourceType: "lease_deposit_refund", direction: "liability_out", receipt: "WB4-LEASE-302-20250430-DEPREF-01", notes: "302\u4e2d\u6c7d\u5de5\u4e1a\u62bc\u91d1100\u4e07\u5df2\u9000\uff1b\u5177\u4f53\u9000\u6b3e\u65e5\u671f\u672a\u8bb0\u8f7d\uff0c\u4ee5\u9000\u79df\u65e5\u4f5c\u8d26\u52a1\u65e5\u3002", receivable: false },
    ],
  },
];

const verification = {};
for (const spec of specs) {
  const customerId = await upsertCustomer(spec.customer, spec.customerNotes);
  const leaseId = await upsertLease(spec, customerId);
  for (const entry of spec.entries) await upsertEntry(leaseId, customerId, entry);
  const payments = await checked(supabase.from("payments").select("source_type, amount").eq("source_id", leaseId), `verify ${spec.contractNo}`);
  if (payments.length !== spec.entries.length) throw new Error(`Unexpected payment count for ${spec.contractNo}: ${payments.length}`);
  verification[spec.contractNo] = payments.reduce((totals, payment) => {
    totals[payment.source_type] = (totals[payment.source_type] ?? 0) + Number(payment.amount);
    return totals;
  }, {});
}

await checked(
  supabase.from("units").update({
    status: "available",
    notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b302\u65e0\u51fa\u552e\u8bb0\u5f55\uff1b\u4e09\u6bb5\u5386\u53f2\u957f\u79df\u5747\u5df2\u7ed3\u675f\uff0c\u6700\u540e\u4e00\u6bb5\u4e8e2025-04-30\u9000\u79df\uff1b\u6240\u6709\u62bc\u91d1\u5df2\u9000\u6216\u5df2\u6263\u6b3e\u95ed\u73af\uff1b\u5f53\u524d\u7a7a\u95f2\u3002",
  }).eq("id", unit.id),
  "update 302 unit",
);
await checked(
  supabase.from("audit_logs").insert({
    action: "reconcile_floor_lease_sale_data",
    entity_type: "building",
    entity_id: building.id,
    metadata: { building_code: "SACSI4", unit: "302", current_status: "available", sale_count: 0, leases: verification },
  }),
  "write 302 audit log",
);

console.log(JSON.stringify({ ok: true, unit: "302", current_status: "available", leases: verification }));
