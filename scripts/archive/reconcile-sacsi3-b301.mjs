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
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "B301").single(), "load B301");
if (Number(unit.area_sqm) !== 173.51) throw new Error(`Unexpected B301 area: ${unit.area_sqm}`);
const lease = await checked(supabase.from("lease_contracts").select("id, customer_id, contract_no, start_date, expected_end_date, monthly_rent_xof").eq("unit_id", unit.id).eq("status", "active").single(), "load B301 lease");
if (lease.contract_no !== "SACSI3-LEASE-B301" || lease.start_date !== "2026-04-16" || lease.expected_end_date !== "2026-10-15" || Number(lease.monthly_rent_xof) !== 1_140_000) throw new Error("Unexpected B301 lease");
const customer = await checked(supabase.from("customers").select("id, name").eq("id", lease.customer_id).single(), "load B301 tenants");
if (customer.name !== "\u674e\u4e2d\u5f3a\u7b493\u4eba") throw new Error(`Unexpected B301 tenants: ${customer.name}`);

const rateToXof = 80;
const notes = "\u6765\u6e90\uff1a3\u53f7\u516c\u5bd3.xlsx\uff1bB301\u7531\u674e\u4e2d\u5f3a\u7b493\u4eba\u5408\u79df\uff1b2026-04-17\u81f318\u65e5\u4e24\u65e5\u5408\u8ba1\u4ed8\u4eba\u6c11\u5e0199750\u5143\uff1b\u63091\u4eba\u6c11\u5e01=80 FCFA\uff0c\u62bc1\u79df6\uff1b\u79df\u91d185500\u5143=684\u4e07FCFA\uff0c\u62bc\u91d114250\u5143=114\u4e07FCFA\uff0c\u5408\u8ba199750\u5143=798\u4e07FCFA\u3002";
await checked(supabase.from("lease_contracts").update({ payment_cycle: "semiannual", payment_day: 16, deposit_amount_xof: 1_140_000, deposit_received: true, paid_through_date: "2026-10-15", expected_end_confirmed: true }).eq("id", lease.id), "update B301 lease");
await checked(supabase.from("units").update({ status: "leased", notes: `${notes}\n\u534e\u4e3a2026-04-15\u9000\u79df\uff0c\u672c\u5408\u540c2026-04-16\u8d77\u79df\uff0c\u65f6\u95f4\u8854\u63a5\u3002` }).eq("id", unit.id), "update B301 unit");

const specs = [
  { receiptNo: "S3-LEASE-B301-RENT", sourceType: "lease_rent", amountCny: 85_500, amountXof: 6_840_000, category: "lease_rent", direction: "income" },
  { receiptNo: "S3-LEASE-B301-DEP", sourceType: "lease_deposit", amountCny: 14_250, amountXof: 1_140_000, category: "lease_deposit", direction: "liability_in" },
];
for (const spec of specs) {
  const payment = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", spec.receiptNo).single(), `load ${spec.receiptNo}`);
  await checked(supabase.from("payments").update({ customer_id: customer.id, source_type: spec.sourceType, source_id: lease.id, payment_date: "2026-04-18", amount: spec.amountCny, currency: "CNY", exchange_rate_to_xof: rateToXof, notes }).eq("id", payment.id), `update ${spec.receiptNo}`);
  await checked(supabase.from("ledger_entries").update({ entry_date: "2026-04-18", direction: spec.direction, category: spec.category, amount_xof: spec.amountXof, amount_cny: spec.amountCny, description: notes }).eq("payment_id", payment.id), `update ledger ${spec.receiptNo}`);
}

const receivableSpecs = [
  { category: "lease_rent", amountXof: 6_840_000, title: "3# B301 2026-04-16\u81f32026-10-15\u79df\u91d1" },
  { category: "lease_deposit", amountXof: 1_140_000, title: "3# B301\u79df\u8d41\u62bc\u91d1" },
];
for (const spec of receivableSpecs) await checked(supabase.from("receivables").update({ title: spec.title, due_date: "2026-04-18", amount_xof: spec.amountXof, paid_amount_xof: spec.amountXof, status: "paid", currency: "XOF", notes }).eq("source_id", lease.id).eq("category", spec.category).neq("status", "cancelled"), `update receivable ${spec.category}`);

const verified = await checked(supabase.from("payments").select("amount, currency, exchange_rate_to_xof").eq("source_id", lease.id), "verify B301 payments");
if (verified.length !== 2 || verified.some((row) => row.currency !== "CNY" || Number(row.exchange_rate_to_xof) !== rateToXof) || verified.reduce((sum, row) => sum + Number(row.amount), 0) !== 99_750 || verified.reduce((sum, row) => sum + Number(row.amount) * Number(row.exchange_rate_to_xof), 0) !== 7_980_000) throw new Error("Unexpected verified B301 payments");
await checked(supabase.from("audit_logs").insert({ action: "reconcile_sacsi3_b301", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI3", unit_no: "B301", tenant: customer.name, joint_tenants: 3, lease_start: "2026-04-16", lease_end: "2026-10-15", paid_through: "2026-10-15", monthly_rent_xof: 1_140_000, rent_cny: 85_500, deposit_cny: 14_250, total_cny: 99_750, exchange_rate_to_xof: rateToXof, total_xof: 7_980_000, previous_huawei_moveout: "2026-04-15" } }), "write B301 audit log");
console.log(JSON.stringify({ ok: true, unit: "B301", tenants: customer.name, total_cny: 99_750, total_xof: 7_980_000, paid_through: "2026-10-15" }));
