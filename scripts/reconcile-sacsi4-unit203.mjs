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

async function oneCustomer(name, notes) {
  const rows = await checked(supabase.from("customers").select("id").eq("name", name), `find customer ${name}`);
  if (rows.length > 1) throw new Error(`Duplicate customer ${name}`);
  if (rows.length === 1) return rows[0].id;
  return (await checked(supabase.from("customers").insert({ name, notes }).select("id").single(), `insert customer ${name}`)).id;
}

async function upsertPayment({ oldReceipts = [], ...entry }) {
  const accepted = [entry.receipt, ...oldReceipts];
  const rows = await checked(
    supabase.from("payments").select("id").eq("source_id", entry.sourceId).in("receipt_no", accepted),
    `find ${entry.receipt}`,
  );
  if (rows.length > 1) throw new Error(`Duplicate payment candidates for ${entry.receipt}`);
  const payload = {
    customer_id: entry.customerId,
    unit_id: unit.id,
    source_type: entry.sourceType,
    source_id: entry.sourceId,
    payment_date: entry.date,
    amount: entry.amount,
    currency: "XOF",
    exchange_rate_to_xof: 1,
    receipt_no: entry.receipt,
    notes: entry.notes,
  };
  const paymentId = rows.length === 1
    ? rows[0].id
    : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${entry.receipt}`)).id;
  if (rows.length === 1) await checked(supabase.from("payments").update(payload).eq("id", paymentId), `update ${entry.receipt}`);

  const ledgerPayload = {
    building_id: building.id,
    unit_id: unit.id,
    payment_id: paymentId,
    entry_date: entry.date,
    direction: entry.direction,
    category: entry.ledgerCategory,
    amount_xof: entry.amount,
    amount_cny: null,
    description: entry.notes,
  };
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${entry.receipt}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledgers for ${entry.receipt}`);
  if (ledgers.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgers[0].id), `update ledger ${entry.receipt}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${entry.receipt}`);

  if (!entry.receivableCategory) return;
  const receivablePayload = {
    building_id: building.id,
    unit_id: unit.id,
    customer_id: entry.customerId,
    source_type: entry.receivableSourceType,
    source_id: entry.sourceId,
    category: entry.receivableCategory,
    title: entry.title,
    due_date: entry.date,
    amount_xof: entry.amount,
    paid_amount_xof: entry.amount,
    status: "paid",
    currency: "XOF",
    notes: entry.notes,
  };
  const receivables = await checked(
    supabase.from("receivables").select("id").eq("source_id", entry.sourceId).eq("notes", entry.notes),
    `find receivable ${entry.receipt}`,
  );
  if (receivables.length > 1) throw new Error(`Duplicate receivables for ${entry.receipt}`);
  if (receivables.length === 1) await checked(supabase.from("receivables").update(receivablePayload).eq("id", receivables[0].id), `update receivable ${entry.receipt}`);
  else await checked(supabase.from("receivables").insert(receivablePayload), `insert receivable ${entry.receipt}`);
}

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI4").single(), "load building");
const unit = await checked(
  supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "203").single(),
  "load unit 203",
);

const sale = await checked(
  supabase.from("sale_contracts").select("id, customer_id, signed_date, total_amount_xof").eq("unit_id", unit.id).single(),
  "load 203 sale",
);
if (sale.signed_date !== "2026-06-19" || Number(sale.total_amount_xof) !== 60_000_000) {
  throw new Error(`Unexpected 203 sale: ${sale.signed_date} / ${sale.total_amount_xof}`);
}
await checked(
  supabase.from("sale_contracts").update({
    contract_no: "WB-SALE-SACSI4-203-20260619",
    payment_plan_type: "\u623f\u6b3e6000\u4e07\uff0c2026-06-19\u4e00\u6b21\u4ed8\u6e05\uff1b\u65e0\u8f66\u4f4d\u3002",
  }).eq("id", sale.id),
  "update 203 sale",
);
await upsertPayment({
  sourceId: sale.id,
  customerId: sale.customer_id,
  sourceType: "sale_contract",
  date: "2026-06-19",
  amount: 60_000_000,
  receipt: "WB4-SALE-203-20260619-HOUSE-01",
  oldReceipts: ["S4-SALE-203-CONSOLIDATED"],
  notes: "203\u623f\u6b3e6000\u4e07\uff0c2026-06-19\u4e00\u6b21\u4ed8\u6e05\uff1b\u65e0\u8f66\u4f4d\u3002",
  direction: "income",
  ledgerCategory: "sale",
});
const saleReceivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum"), "load 203 sale receivable");
if (saleReceivables.length !== 1) throw new Error(`Expected one 203 sale receivable, got ${saleReceivables.length}`);
await checked(
  supabase.from("receivables").update({
    amount_xof: 60_000_000,
    paid_amount_xof: 60_000_000,
    status: "paid",
    notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx Sheet1\uff1b203\u623f\u6b3e6000\u4e07\u5df2\u7ed3\u6e05\uff0c\u65e0\u8f66\u4f4d\u3002",
  }).eq("id", saleReceivables[0].id),
  "update 203 sale receivable",
);

const oldTenantId = await oneCustomer("\u5f20\u6770", "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b4\u53f7\u697c203\u5386\u53f2\u957f\u79df\u79df\u6237\u3002");
const currentTenantId = await oneCustomer("\u738b\u5f69\u6770", "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b4\u53f7\u697c203\u5f53\u524d\u957f\u79df\u79df\u6237\u3002");

const oldLeaseNo = "WB-LEASE-SACSI4-203-20220105";
let oldLeaseRows = await checked(supabase.from("lease_contracts").select("id").eq("contract_no", oldLeaseNo), "find old 203 lease");
if (oldLeaseRows.length > 1) throw new Error(`Duplicate old 203 leases: ${oldLeaseRows.length}`);
const oldLeasePayload = {
  unit_id: unit.id,
  customer_id: oldTenantId,
  contract_no: oldLeaseNo,
  start_date: "2022-01-05",
  expected_end_date: "2023-01-04",
  actual_end_date: "2023-01-04",
  payment_cycle: "semiannual",
  payment_day: 5,
  monthly_rent_xof: 500_000,
  deposit_amount_xof: 1_000_000,
  deposit_received: true,
  rent_free_days: 0,
  signer_name: "\u5f20\u6770",
  status: "terminated",
  expected_end_confirmed: true,
  paid_through_date: "2023-01-04",
};
const oldLeaseId = oldLeaseRows.length === 1
  ? oldLeaseRows[0].id
  : (await checked(supabase.from("lease_contracts").insert(oldLeasePayload).select("id").single(), "insert old 203 lease")).id;
if (oldLeaseRows.length === 1) await checked(supabase.from("lease_contracts").update(oldLeasePayload).eq("id", oldLeaseId), "update old 203 lease");

const currentLease = await checked(
  supabase.from("lease_contracts").select("id, start_date").eq("unit_id", unit.id).eq("customer_id", currentTenantId).single(),
  "load current 203 lease",
);
if (currentLease.start_date !== "2023-02-15") throw new Error(`Unexpected current 203 lease date ${currentLease.start_date}`);
await checked(
  supabase.from("lease_contracts").update({
    contract_no: "WB-LEASE-SACSI4-203-20230215",
    expected_end_date: "2026-08-14",
    actual_end_date: null,
    payment_cycle: "semiannual",
    payment_day: 15,
    monthly_rent_xof: 500_000,
    deposit_amount_xof: 1_000_000,
    deposit_received: true,
    signer_name: "\u738b\u5f69\u6770",
    status: "active",
    expected_end_confirmed: false,
    paid_through_date: "2026-08-14",
  }).eq("id", currentLease.id),
  "update current 203 lease",
);

const entries = [
  { sourceId: oldLeaseId, customerId: oldTenantId, sourceType: "lease_deposit", date: "2022-01-03", amount: 1_000_000, receipt: "WB4-LEASE-203-20220103-DEPOSIT-01", notes: "203\u5f20\u6770\u5386\u53f2\u62bc\u91d1100\u4e07\uff1b\u540e\u5df2\u9000\u3002", direction: "liability_in", ledgerCategory: "lease_deposit", receivableSourceType: "lease_contract", receivableCategory: "lease_deposit", title: "203\u5f20\u6770\u5386\u53f2\u62bc\u91d1" },
  { sourceId: oldLeaseId, customerId: oldTenantId, sourceType: "lease_rent", date: "2022-01-03", amount: 3_000_000, receipt: "WB4-LEASE-203-20220103-RENT-01", notes: "203\u5f20\u6770\u5386\u53f2\u79df\u91d1300\u4e07\uff0c2022-01-05\u81f32022-07-04\u3002", direction: "income", ledgerCategory: "lease_rent", receivableSourceType: "lease_contract", receivableCategory: "lease_rent", title: "203\u5f20\u6770\u5386\u53f2\u79df\u91d1" },
  { sourceId: oldLeaseId, customerId: oldTenantId, sourceType: "property_fee", date: "2022-01-03", amount: 210_000, receipt: "WB4-LEASE-203-20220103-PROP-01", notes: "203\u5f20\u6770\u5386\u53f2\u7269\u4e1a\u8d3921\u4e07\uff0c6\u4e2a\u6708\u3002", direction: "income", ledgerCategory: "property_fee", receivableSourceType: "lease_contract", receivableCategory: "other", title: "203\u5f20\u6770\u5386\u53f2\u7269\u4e1a\u8d39" },
  { sourceId: oldLeaseId, customerId: oldTenantId, sourceType: "lease_rent", date: "2022-07-08", amount: 3_000_000, receipt: "WB4-LEASE-203-20220708-RENT-02", notes: "203\u5f20\u6770\u5386\u53f2\u79df\u91d1300\u4e07\uff0c\u5df2\u7f34\u81f32023-01-04\u3002", direction: "income", ledgerCategory: "lease_rent", receivableSourceType: "lease_contract", receivableCategory: "lease_rent", title: "203\u5f20\u6770\u5386\u53f2\u79df\u91d1" },
  { sourceId: oldLeaseId, customerId: oldTenantId, sourceType: "property_fee", date: "2022-07-08", amount: 210_000, receipt: "WB4-LEASE-203-20220708-PROP-02", notes: "203\u5f20\u6770\u5386\u53f2\u7269\u4e1a\u8d3921\u4e07\uff0c\u5df2\u7f34\u81f32023-01-04\u3002", direction: "income", ledgerCategory: "property_fee", receivableSourceType: "lease_contract", receivableCategory: "other", title: "203\u5f20\u6770\u5386\u53f2\u7269\u4e1a\u8d39" },
  { sourceId: oldLeaseId, customerId: oldTenantId, sourceType: "lease_deposit_refund", date: "2023-01-04", amount: 1_000_000, receipt: "WB4-LEASE-203-20230104-DEPREFUND-01", notes: "203\u5f20\u6770\u5386\u53f2\u62bc\u91d1100\u4e07\u5df2\u9000\uff1b\u5177\u4f53\u9000\u6b3e\u65e5\u671f\u672a\u8bb0\u5f55\uff0c\u6309\u9000\u79df\u65e5\u5f52\u8d26\u3002", direction: "liability_out", ledgerCategory: "lease_deposit_refund" },
  { sourceId: currentLease.id, customerId: currentTenantId, sourceType: "lease_deposit", date: "2023-02-09", amount: 1_000_000, receipt: "WB4-LEASE-203-20230209-DEPOSIT-01", notes: "203\u738b\u5f69\u6770\u62bc\u91d1100\u4e07\uff0c\u5f53\u524d\u4ecd\u6301\u6709\u3002", direction: "liability_in", ledgerCategory: "lease_deposit", receivableSourceType: "lease_contract", receivableCategory: "lease_deposit", title: "203\u738b\u5f69\u6770\u62bc\u91d1" },
];

const currentDates = ["2023-02-09", "2023-08-15", "2024-02-14", "2024-08-15", "2025-02-15", "2025-08-13", "2026-02-24"];
for (let index = 0; index < currentDates.length; index += 1) {
  const date = currentDates[index];
  const seq = String(index + 1).padStart(2, "0");
  entries.push(
    { sourceId: currentLease.id, customerId: currentTenantId, sourceType: "lease_rent", date, amount: 3_000_000, receipt: `WB4-LEASE-203-${date.replaceAll("-", "")}-RENT-${seq}`, oldReceipts: index === 6 ? ["WB4-L-203-20260224-RENT"] : [], notes: `203\u738b\u5f69\u6770\u7b2c${index + 1}\u671f\u79df\u91d1300\u4e07\uff0c6\u4e2a\u6708\u3002`, direction: "income", ledgerCategory: "lease_rent", receivableSourceType: "lease_contract", receivableCategory: "lease_rent", title: "203\u738b\u5f69\u6770\u79df\u91d1" },
    { sourceId: currentLease.id, customerId: currentTenantId, sourceType: "property_fee", date, amount: 210_000, receipt: `WB4-LEASE-203-${date.replaceAll("-", "")}-PROP-${seq}`, notes: `203\u738b\u5f69\u6770\u7b2c${index + 1}\u671f\u7269\u4e1a\u8d3921\u4e07\uff0c6\u4e2a\u6708\u3002`, direction: "income", ledgerCategory: "property_fee", receivableSourceType: "lease_contract", receivableCategory: "other", title: "203\u738b\u5f69\u6770\u7269\u4e1a\u8d39" },
  );
}
for (const entry of entries) await upsertPayment(entry);

await checked(
  supabase.from("units").update({
    status: "sold",
    notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u4e1a\u4e3b\u6bdb\u6c38\u4f1f\uff0c\u623f\u6b3e6000\u4e07\u5df2\u7ed3\u6e05\uff0c\u65e0\u8f66\u4f4d\uff1b\u5f20\u6770\u5386\u53f2\u79df\u7ea6\u5df2\u9000\uff1b\u738b\u5f69\u6770\u5f53\u524d\u5728\u79df\uff0c\u79df\u91d1\u548c\u7269\u4e1a\u8d39\u5df2\u7f34\u81f32026-08-14\uff0c\u62bc\u91d1100\u4e07\u4ecd\u6301\u6709\u3002",
  }).eq("id", unit.id),
  "update 203 unit note",
);

const leaseIds = [oldLeaseId, currentLease.id];
const finalPayments = await checked(
  supabase.from("payments").select("source_id, source_type, amount, receipt_no").in("source_id", [sale.id, ...leaseIds]),
  "verify 203 payments",
);
const total = (sourceId, sourceType) => finalPayments
  .filter((payment) => payment.source_id === sourceId && payment.source_type === sourceType)
  .reduce((sum, payment) => sum + Number(payment.amount), 0);
const verification = {
  sale: total(sale.id, "sale_contract"),
  oldRent: total(oldLeaseId, "lease_rent"),
  oldProperty: total(oldLeaseId, "property_fee"),
  oldDeposit: total(oldLeaseId, "lease_deposit"),
  oldDepositRefund: total(oldLeaseId, "lease_deposit_refund"),
  currentRent: total(currentLease.id, "lease_rent"),
  currentProperty: total(currentLease.id, "property_fee"),
  currentDeposit: total(currentLease.id, "lease_deposit"),
};
const expected = { sale: 60_000_000, oldRent: 6_000_000, oldProperty: 420_000, oldDeposit: 1_000_000, oldDepositRefund: 1_000_000, currentRent: 21_000_000, currentProperty: 1_470_000, currentDeposit: 1_000_000 };
for (const [key, amount] of Object.entries(expected)) {
  if (verification[key] !== amount) throw new Error(`Unexpected 203 ${key}: ${verification[key]}`);
}

await checked(supabase.from("audit_logs").insert({
  action: "reconcile_floor_lease_sale_data",
  entity_type: "building",
  entity_id: building.id,
  metadata: { building_code: "SACSI4", unit: "203", ...verification, current_paid_through: "2026-08-14", current_lease_status: "active" },
}), "write 203 audit log");

console.log(JSON.stringify({ ok: true, unit: "203", verification }));
