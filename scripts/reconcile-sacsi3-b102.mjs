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
const unit = await checked(supabase.from("units").select("id, unit_no, area_sqm").eq("building_id", building.id).eq("unit_no", "B102").single(), "load B102");
if (Number(unit.area_sqm) !== 54.99) throw new Error(`Unexpected B102 area: ${unit.area_sqm}`);

const lease = await checked(supabase.from("lease_contracts").select("id, customer_id, contract_no, start_date, expected_end_date, monthly_rent_xof").eq("unit_id", unit.id).eq("status", "active").single(), "load B102 lease");
if (lease.contract_no !== "SACSI3-LEASE-B102" || lease.start_date !== "2026-04-16" || lease.expected_end_date !== "2026-10-15" || Number(lease.monthly_rent_xof) !== 470_000) throw new Error("Unexpected B102 lease");
const customer = await checked(supabase.from("customers").select("id, name").eq("id", lease.customer_id).single(), "load B102 tenant");
if (customer.name !== "\u6613\u4e3a") throw new Error(`Unexpected B102 tenant: ${customer.name}`);

const rateToXof = 80;
const notes = "\u6765\u6e90\uff1a3\u53f7\u516c\u5bd3.xlsx\uff1b2026-05-02\u4ed8\u4eba\u6c11\u5e0141125\u5143\uff1b\u7528\u6237\u786e\u8ba4\u539f\u8868\u201c\u6c47125\u201d\u8868\u793a10000 FCFA=125\u4eba\u6c11\u5e01\uff0c\u7b49\u4ef71\u4eba\u6c11\u5e01=80 FCFA\uff1b\u62bc1\u79df6\uff0c\u79df\u91d135250\u5143=282\u4e07FCFA\uff0c\u62bc\u91d15875\u5143=47\u4e07FCFA\uff0c\u5408\u8ba141125\u5143=329\u4e07FCFA\u3002";

await checked(supabase.from("lease_contracts").update({
  payment_cycle: "semiannual",
  payment_day: 16,
  deposit_amount_xof: 470_000,
  deposit_received: true,
  paid_through_date: "2026-10-15",
  expected_end_confirmed: true,
}).eq("id", lease.id), "update B102 lease");
await checked(supabase.from("units").update({ status: "leased", notes: `${notes}\n\u5f53\u524d\u79df\u6237\uff1a\u6613\u4e3a\u3002\u534e\u4e3a\u9000\u79df\u65e5\u671f2026-05-01\u4e0e\u672c\u5408\u540c\u8d77\u79df\u65e52026-04-16\u91cd\u53e0\uff0c\u5217\u5165\u5f85\u786e\u8ba4\u6e05\u5355\u3002` }).eq("id", unit.id), "update B102 unit");

const paymentSpecs = [
  { receiptNo: "S3-LEASE-B102-RENT", sourceType: "lease_rent", amountCny: 35_250, amountXof: 2_820_000, category: "lease_rent", direction: "income" },
  { receiptNo: "S3-LEASE-B102-DEP", sourceType: "lease_deposit", amountCny: 5_875, amountXof: 470_000, category: "lease_deposit", direction: "liability_in" },
];

for (const spec of paymentSpecs) {
  const payment = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", spec.receiptNo).single(), `load ${spec.receiptNo}`);
  await checked(supabase.from("payments").update({
    customer_id: customer.id,
    source_type: spec.sourceType,
    source_id: lease.id,
    payment_date: "2026-05-02",
    amount: spec.amountCny,
    currency: "CNY",
    exchange_rate_to_xof: rateToXof,
    notes,
  }).eq("id", payment.id), `update ${spec.receiptNo}`);
  await checked(supabase.from("ledger_entries").update({
    entry_date: "2026-05-02",
    direction: spec.direction,
    category: spec.category,
    amount_xof: spec.amountXof,
    amount_cny: spec.amountCny,
    description: notes,
  }).eq("payment_id", payment.id), `update ledger ${spec.receiptNo}`);
}

const receivableSpecs = [
  { category: "lease_rent", amountXof: 2_820_000, title: "3# B102 2026-04-16\u81f32026-10-15\u79df\u91d1" },
  { category: "lease_deposit", amountXof: 470_000, title: "3# B102\u79df\u8d41\u62bc\u91d1" },
];
for (const spec of receivableSpecs) {
  await checked(supabase.from("receivables").update({
    title: spec.title,
    due_date: "2026-05-02",
    amount_xof: spec.amountXof,
    paid_amount_xof: spec.amountXof,
    status: "paid",
    currency: "XOF",
    notes,
  }).eq("source_id", lease.id).eq("category", spec.category).neq("status", "cancelled"), `update receivable ${spec.category}`);
}

const payments = await checked(supabase.from("payments").select("source_type, amount, currency, exchange_rate_to_xof").eq("source_id", lease.id), "verify B102 payments");
if (payments.length !== 2 || payments.some((row) => row.currency !== "CNY" || Number(row.exchange_rate_to_xof) !== rateToXof) || payments.reduce((sum, row) => sum + Number(row.amount), 0) !== 41_125 || payments.reduce((sum, row) => sum + Number(row.amount) * Number(row.exchange_rate_to_xof), 0) !== 3_290_000) throw new Error("Unexpected verified B102 payments");

await checked(supabase.from("audit_logs").insert({
  action: "reconcile_sacsi3_b102",
  entity_type: "unit",
  entity_id: unit.id,
  metadata: { building_code: "SACSI3", unit_no: "B102", tenant: customer.name, lease_start: "2026-04-16", lease_end: "2026-10-15", paid_through: "2026-10-15", monthly_rent_xof: 470_000, rent_months: 6, rent_cny: 35_250, deposit_cny: 5_875, total_cny: 41_125, exchange_quote: "10000 XOF = 125 CNY", exchange_rate_to_xof: rateToXof, total_xof: 3_290_000, huawei_moveout_overlap_pending: true },
}), "write B102 audit log");

console.log(JSON.stringify({ ok: true, unit: "B102", tenant: customer.name, total_cny: 41_125, total_xof: 3_290_000, paid_through: "2026-10-15", pending: ["Huawei move-out date overlaps current lease"] }));
