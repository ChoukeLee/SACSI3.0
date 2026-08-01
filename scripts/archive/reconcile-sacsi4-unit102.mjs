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
  supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "102").single(),
  "load unit 102",
);
const sale = await checked(
  supabase.from("sale_contracts").select("id, customer_id, signed_date").eq("unit_id", unit.id).single(),
  "load 102 sale",
);
if (sale.signed_date !== "2023-12-28") throw new Error(`Unexpected 102 sale date ${sale.signed_date}`);

await checked(
  supabase.from("sale_contracts").update({
    contract_no: "WB-SALE-SACSI4-102-20231228",
    total_amount_xof: 88_000_000,
    payment_plan_type: "\u5408\u540c\u603b\u4ef78800\u4e07\uff0c\u5df2\u7ed3\u6e05\u3002Excel\u8bb0\u8f7d\u4eba\u6c11\u5e0120\u4e07\u5b9a\u91d1\u53ca6992\u4e07XOF\uff0c\u4f46\u6309\u6c47\u7387110.5\u65e0\u6cd5\u4e0e8800\u4e07\u95ed\u5408\uff0c\u4ec5\u6309\u6c47\u603b\u5df2\u4ed88800\u4e07\u7edf\u8ba1\u3002",
  }).eq("id", sale.id),
  "normalize 102 sale",
);
const salePayments = await checked(supabase.from("payments").select("id").eq("source_id", sale.id), "load 102 sale payments");
if (salePayments.length !== 1) throw new Error(`Expected one consolidated 102 sale payment, got ${salePayments.length}`);
await checked(
  supabase.from("payments").update({
    source_type: "sale_contract",
    payment_date: "2024-01-30",
    amount: 88_000_000,
    currency: "XOF",
    exchange_rate_to_xof: 1,
    receipt_no: "WB4-SALE-102-CONSOLIDATED",
    notes: "102\u8d2d\u623f\u6b3e\u6c47\u603b8800\u4e07\uff0c\u5df2\u7ed3\u6e05\uff1b\u4eba\u6c11\u5e0120\u4e07\u5b9a\u91d1\u4e0e6992\u4e07XOF\u7684\u539f\u989d\u65e0\u6cd5\u6309\u6c47\u7387110.5\u95ed\u5408\uff0c\u4e0d\u5f3a\u5236\u62c6\u5206\u3002",
  }).eq("id", salePayments[0].id),
  "update 102 sale payment",
);
const saleLedgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", salePayments[0].id), "load 102 sale ledger");
if (saleLedgers.length !== 1) throw new Error(`Expected one 102 sale ledger, got ${saleLedgers.length}`);
await checked(
  supabase.from("ledger_entries").update({
    unit_id: unit.id,
    direction: "income",
    category: "sale",
    amount_xof: 88_000_000,
    amount_cny: null,
    description: "102\u8d2d\u623f\u6b3e\u6c47\u603b8800\u4e07\uff0c\u5df2\u7ed3\u6e05\uff1b\u539f\u5e01\u62c6\u5206\u5f85\u8865\u5145\u3002",
  }).eq("id", saleLedgers[0].id),
  "update 102 sale ledger",
);
const saleReceivables = await checked(
  supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum"),
  "load 102 sale receivable",
);
if (saleReceivables.length !== 1) throw new Error(`Expected one 102 sale receivable, got ${saleReceivables.length}`);
await checked(
  supabase.from("receivables").update({
    amount_xof: 88_000_000,
    paid_amount_xof: 88_000_000,
    status: "paid",
    notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx Sheet1\uff1b\u5408\u540c\u603b\u4ef78800\u4e07\uff0c\u5df2\u7ed3\u6e05\uff1b\u4eba\u6c11\u5e0120\u4e07\u5b9a\u91d1\u4e0e6992\u4e07XOF\u4e0d\u6309\u6709\u77db\u76fe\u7684\u6c47\u7387\u5f3a\u5236\u62c6\u5206\u3002",
  }).eq("id", saleReceivables[0].id),
  "update 102 sale receivable",
);

const tenantName = "\u5370\u5ea6\u79df\u6237\uff08\u59d3\u540d\u5f85\u8865\uff09";
let tenantRows = await checked(supabase.from("customers").select("id").eq("name", tenantName), "find 102 tenant");
if (tenantRows.length > 1) throw new Error(`Duplicate 102 tenant customers: ${tenantRows.length}`);
let tenantId;
if (tenantRows.length === 1) tenantId = tenantRows[0].id;
else {
  const inserted = await checked(
    supabase.from("customers").insert({ name: tenantName, notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b102\u5386\u53f2\u79df\u6237\uff1b\u59d3\u540d\u5f85\u8865\u3002" }).select("id").single(),
    "insert 102 tenant",
  );
  tenantId = inserted.id;
}

const leaseNo = "WB-LEASE-SACSI4-102-20210615";
let leaseRows = await checked(supabase.from("lease_contracts").select("id").eq("contract_no", leaseNo), "find 102 lease");
if (leaseRows.length > 1) throw new Error(`Duplicate 102 leases: ${leaseRows.length}`);
const leasePayload = {
  unit_id: unit.id,
  customer_id: tenantId,
  contract_no: leaseNo,
  start_date: "2021-06-15",
  expected_end_date: "2024-06-30",
  actual_end_date: "2024-06-30",
  payment_cycle: "semiannual",
  payment_day: 15,
  monthly_rent_xof: 600_000,
  deposit_amount_xof: 1_200_000,
  deposit_received: true,
  rent_free_days: 0,
  signer_name: "\u5370\u5ea6\u79df\u6237\uff08\u59d3\u540d\u5f85\u8865\uff09",
  status: "terminated",
  expected_end_confirmed: true,
  paid_through_date: "2023-12-31",
};
let leaseId;
if (leaseRows.length === 1) {
  leaseId = leaseRows[0].id;
  await checked(supabase.from("lease_contracts").update(leasePayload).eq("id", leaseId), "update 102 lease");
} else {
  const inserted = await checked(supabase.from("lease_contracts").insert(leasePayload).select("id").single(), "insert 102 lease");
  leaseId = inserted.id;
}

const incomeEntries = [
  { date: "2021-06-15", amount: 1_200_000, sourceType: "lease_deposit", category: "lease_deposit", direction: "liability_in", receipt: "WB4-LEASE-102-20210615-DEPOSIT-01", title: "102\u5386\u53f2\u62bc\u91d1", notes: "102\u5386\u53f2\u62bc\u91d1120\u4e07\uff1b\u540e\u8f6c\u81f3404\u3002" },
  { date: "2021-06-15", amount: 3_600_000, sourceType: "lease_rent", category: "lease_rent", direction: "income", receipt: "WB4-LEASE-102-20210615-RENT-01", title: "102\u5386\u53f2\u79df\u91d1", notes: "102\u79df\u91d1360\u4e07\uff0c6\u4e2a\u6708\uff0c\u5df2\u7f34\u81f32021-12-14\u3002" },
  { date: "2021-12-15", amount: 3_900_000, sourceType: "lease_rent", category: "lease_rent", direction: "income", receipt: "WB4-LEASE-102-20211215-RENT-02", title: "102\u5386\u53f2\u79df\u91d1", notes: "102\u79df\u91d1390\u4e07\uff0c2021-12-15\u81f32022-06-30\u3002" },
  { date: "2021-12-15", amount: 260_000, sourceType: "property_fee", category: "other", direction: "income", receipt: "WB4-LEASE-102-20211215-PROP-01", title: "102\u5386\u53f2\u7269\u4e1a\u8d39", notes: "102\u7269\u4e1a\u8d3926\u4e07\uff0c2021-12-15\u81f32022-06-30\u3002" },
  { date: "2022-07-07", amount: 3_600_000, sourceType: "lease_rent", category: "lease_rent", direction: "income", receipt: "WB4-LEASE-102-20220707-RENT-03", title: "102\u5386\u53f2\u79df\u91d1", notes: "102\u79df\u91d1360\u4e07\uff0c\u5df2\u7f34\u81f32022-12-31\u3002" },
  { date: "2022-07-07", amount: 240_000, sourceType: "property_fee", category: "other", direction: "income", receipt: "WB4-LEASE-102-20220707-PROP-02", title: "102\u5386\u53f2\u7269\u4e1a\u8d39", notes: "102\u7269\u4e1a\u8d3924\u4e07\uff0c\u5df2\u7f34\u81f32022-12-31\u3002" },
  { date: "2023-01-03", amount: 2_400_000, sourceType: "lease_rent", category: "lease_rent", direction: "income", receipt: "WB4-LEASE-102-20230103-RENT-04", title: "102\u5386\u53f2\u79df\u91d1", notes: "102\u79df\u91d1240\u4e07\uff0c\u5df2\u7f34\u81f32023-04-30\u3002" },
  { date: "2023-01-03", amount: 160_000, sourceType: "property_fee", category: "other", direction: "income", receipt: "WB4-LEASE-102-20230103-PROP-03", title: "102\u5386\u53f2\u7269\u4e1a\u8d39", notes: "102\u7269\u4e1a\u8d3916\u4e07\uff0c\u5df2\u7f34\u81f32023-04-30\u3002" },
  { date: "2023-04-24", amount: 2_400_000, sourceType: "lease_rent", category: "lease_rent", direction: "income", receipt: "WB4-LEASE-102-20230424-RENT-05", title: "102\u5386\u53f2\u79df\u91d1", notes: "102\u79df\u91d1240\u4e07\uff0c\u5df2\u7f34\u81f32023-08-30\u3002" },
  { date: "2023-04-24", amount: 160_000, sourceType: "property_fee", category: "other", direction: "income", receipt: "WB4-LEASE-102-20230424-PROP-04", title: "102\u5386\u53f2\u7269\u4e1a\u8d39", notes: "102\u7269\u4e1a\u8d3916\u4e07\uff0c\u5df2\u7f34\u81f32023-08-30\u3002" },
  { date: "2023-09-01", amount: 2_400_000, sourceType: "lease_rent", category: "lease_rent", direction: "income", receipt: "WB4-LEASE-102-20230901-RENT-06", title: "102\u5386\u53f2\u79df\u91d1", notes: "102\u79df\u91d1240\u4e07\uff0c\u5df2\u7f34\u81f32023-12-31\u3002" },
  { date: "2023-09-01", amount: 160_000, sourceType: "property_fee", category: "other", direction: "income", receipt: "WB4-LEASE-102-20230901-PROP-05", title: "102\u5386\u53f2\u7269\u4e1a\u8d39", notes: "102\u7269\u4e1a\u8d3916\u4e07\uff0c\u5df2\u7f34\u81f32023-12-31\u3002" },
  { date: "2024-07-05", amount: 1_241_000, sourceType: "lease_other_income", category: "other", direction: "income", receipt: "WB4-LEASE-102-20240705-RESTORE-01", title: "102\u6062\u590d\u623f\u5c4b\u8d39", notes: "102\u6062\u590d\u623f\u5c4b\u8d39\u6536\u5165124.1\u4e07\uff0c\u4e0d\u8ba1\u5165\u79df\u91d1\u3002" },
];

for (const entry of incomeEntries) {
  const paymentPayload = { customer_id: tenantId, unit_id: unit.id, source_type: entry.sourceType, source_id: leaseId, payment_date: entry.date, amount: entry.amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: entry.receipt, notes: entry.notes };
  let rows = await checked(supabase.from("payments").select("id").eq("source_id", leaseId).eq("receipt_no", entry.receipt), `find ${entry.receipt}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${entry.receipt}`);
  let paymentId;
  if (rows.length === 1) {
    paymentId = rows[0].id;
    await checked(supabase.from("payments").update(paymentPayload).eq("id", paymentId), `update ${entry.receipt}`);
  } else {
    const inserted = await checked(supabase.from("payments").insert(paymentPayload).select("id").single(), `insert ${entry.receipt}`);
    paymentId = inserted.id;
  }
  const ledgerPayload = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: entry.date, direction: entry.direction, category: entry.sourceType, amount_xof: entry.amount, amount_cny: null, description: entry.notes };
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${entry.receipt}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${entry.receipt}`);
  if (ledgers.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgers[0].id), `update ledger ${entry.receipt}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${entry.receipt}`);

  const receivablePayload = { building_id: building.id, unit_id: unit.id, customer_id: tenantId, source_type: "lease_contract", source_id: leaseId, category: entry.category, title: entry.title, due_date: entry.date, amount_xof: entry.amount, paid_amount_xof: entry.amount, status: "paid", currency: "XOF", notes: entry.notes };
  const receivables = await checked(supabase.from("receivables").select("id").eq("source_id", leaseId).eq("notes", entry.notes), `find receivable ${entry.receipt}`);
  if (receivables.length > 1) throw new Error(`Duplicate receivable ${entry.receipt}`);
  if (receivables.length === 1) await checked(supabase.from("receivables").update(receivablePayload).eq("id", receivables[0].id), `update receivable ${entry.receipt}`);
  else await checked(supabase.from("receivables").insert(receivablePayload), `insert receivable ${entry.receipt}`);
}

const expenseEntries = [
  { date: "2024-06-30", amount: 1_200_000, sourceType: "lease_deposit_refund", category: "lease_deposit_transfer", receipt: "WB4-LEASE-102-20240630-DEPTRANSFER-01", notes: "102\u62bc\u91d1120\u4e07\u8f6c\u81f3404\uff1b\u4ee5\u9000\u79df\u65e5\u4f5c\u8d26\u52a1\u65e5\uff0c\u5b9e\u9645\u8f6c\u6b3e\u65e5\u671f\u672a\u63d0\u4f9b\u3002" },
  { date: "2024-11-12", amount: 600_000, sourceType: "lease_other_expense", category: "lease_other_expense", receipt: "WB4-LEASE-102-20241112-TRANSFER-01", notes: "102\u4e70\u65b9\u4e07\u6881\u8f6c\u7ed9404\u623f\u4e1c\u7684\u5370\u5ea6\u79df\u6237\u79df\u91d160\u4e07\uff1b\u5355\u5217\u8f6c\u6b3e\u652f\u51fa\uff0c\u4e0d\u8ba1\u5165102\u8d2d\u623f\u6b3e\u3002" },
];
for (const entry of expenseEntries) {
  const paymentPayload = { customer_id: tenantId, unit_id: unit.id, source_type: entry.sourceType, source_id: leaseId, payment_date: entry.date, amount: entry.amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: entry.receipt, notes: entry.notes };
  let rows = await checked(supabase.from("payments").select("id").eq("source_id", leaseId).eq("receipt_no", entry.receipt), `find ${entry.receipt}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${entry.receipt}`);
  let paymentId;
  if (rows.length === 1) {
    paymentId = rows[0].id;
    await checked(supabase.from("payments").update(paymentPayload).eq("id", paymentId), `update ${entry.receipt}`);
  } else {
    const inserted = await checked(supabase.from("payments").insert(paymentPayload).select("id").single(), `insert ${entry.receipt}`);
    paymentId = inserted.id;
  }
  const ledgerPayload = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: entry.date, direction: entry.sourceType === "lease_deposit_refund" ? "liability_out" : "expense", category: entry.category, amount_xof: entry.amount, amount_cny: null, description: entry.notes };
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${entry.receipt}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${entry.receipt}`);
  if (ledgers.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgers[0].id), `update ledger ${entry.receipt}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${entry.receipt}`);
}

await checked(
  supabase.from("units").update({ status: "sold", notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u4e1a\u4e3b\u4e07\u6881\u3001\u5f20\u536b\u840d\uff1b\u51fa\u552e8800\u4e07\u5df2\u7ed3\u6e05\uff1b\u5370\u5ea6\u79df\u62372021-06-15\u81f32024-06-30\uff0c\u5df2\u9000\u79df\uff1b\u62bc\u91d1120\u4e07\u8f6c404\u3002" }).eq("id", unit.id),
  "update unit 102 note",
);
await checked(
  supabase.from("audit_logs").insert({
    action: "reconcile_floor_lease_sale_data",
    entity_type: "building",
    entity_id: building.id,
    metadata: {
      building_code: "SACSI4",
      unit: "102",
      sale_total_xof: 88_000_000,
      sale_settled: true,
      sale_original_currency_split_unresolved: true,
      lease_status: "terminated",
      lease_rent_received_xof: 18_300_000,
      property_fee_received_xof: 980_000,
      deposit_transferred_to_unit: "404",
      deposit_transferred_xof: 1_200_000,
      restoration_income_xof: 1_241_000,
      rent_transfer_expense_xof: 600_000,
    },
  }),
  "write audit log",
);

console.log(JSON.stringify({ ok: true, sale: { total: 88_000_000, settled: true }, lease: { rent: 18_300_000, property: 980_000, depositTransferred: 1_200_000, restoration: 1_241_000, transferExpense: 600_000 } }));
