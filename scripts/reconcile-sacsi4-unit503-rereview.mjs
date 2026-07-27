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
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "503").single(), "load 503");
const leases = await checked(supabase.from("lease_contracts").select("id, contract_no, customer_id").eq("unit_id", unit.id).order("start_date"), "load 503 leases");
if (leases.length !== 2) throw new Error(`Unexpected 503 lease count: ${leases.length}`);

const expectedLeases = new Map([
  ["WB-LEASE-SACSI4-503-20220615", { actual_end_date: "2023-03-14", income_count: 7, income_total_xof: 5_815_000 }],
  ["WB-LEASE-SACSI4-503-20230311-SUN", { actual_end_date: "2024-03-10", income_count: 5, income_total_xof: 7_420_000 }],
]);
const incomeTypes = ["lease_rent", "lease_deposit", "property_fee"];

function categoryFor(sourceType) {
  if (sourceType === "lease_rent") return "lease_rent";
  if (sourceType === "lease_deposit") return "lease_deposit";
  return "other";
}
function titleFor(sourceType) {
  if (sourceType === "lease_rent") return "503\u79df\u91d1";
  if (sourceType === "lease_deposit") return "503\u62bc\u91d1";
  return "503\u7269\u4e1a\u8d39";
}

for (const lease of leases) {
  const expected = expectedLeases.get(lease.contract_no);
  if (!expected) throw new Error(`Unexpected 503 lease: ${lease.contract_no}`);
  await checked(supabase.from("lease_contracts").update({
    status: "terminated",
    actual_end_date: expected.actual_end_date,
    expected_end_confirmed: true,
  }).eq("id", lease.id), `confirm lease ${lease.contract_no}`);

  const payments = await checked(supabase.from("payments").select("source_type, payment_date, amount, currency, exchange_rate_to_xof, receipt_no, notes").eq("source_id", lease.id).in("source_type", incomeTypes).order("payment_date"), `load payments ${lease.contract_no}`);
  if (payments.length !== expected.income_count) throw new Error(`${lease.contract_no}: unexpected income payment count ${payments.length}`);
  if (payments.reduce((sum, payment) => sum + Number(payment.amount), 0) !== expected.income_total_xof) throw new Error(`${lease.contract_no}: unexpected income payment total`);

  for (const payment of payments) {
    const amountXof = payment.currency === "XOF" ? Number(payment.amount) : Math.round(Number(payment.amount) * Number(payment.exchange_rate_to_xof));
    const category = categoryFor(payment.source_type);
    const rows = await checked(supabase.from("receivables").select("id").eq("source_id", lease.id).eq("category", category).eq("due_date", payment.payment_date).eq("amount_xof", amountXof), `find receivable ${payment.receipt_no}`);
    if (rows.length > 1) throw new Error(`Duplicate receivable ${payment.receipt_no}`);
    const payload = {
      building_id: building.id,
      unit_id: unit.id,
      customer_id: lease.customer_id,
      source_type: "lease_contract",
      source_id: lease.id,
      category,
      title: titleFor(payment.source_type),
      due_date: payment.payment_date,
      amount_xof: amountXof,
      paid_amount_xof: amountXof,
      status: "paid",
      currency: "XOF",
      notes: `${payment.notes}\n\u6536\u636e\u53f7\uff1a${payment.receipt_no}`,
    };
    if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update receivable ${payment.receipt_no}`);
    else await checked(supabase.from("receivables").insert(payload), `insert receivable ${payment.receipt_no}`);
  }

  const receivables = await checked(supabase.from("receivables").select("id").eq("source_id", lease.id).neq("status", "cancelled"), `verify receivables ${lease.contract_no}`);
  if (receivables.length !== payments.length) throw new Error(`${lease.contract_no}: ${payments.length} income payments but ${receivables.length} receivables`);
}

const sunLease = leases.find((lease) => lease.contract_no === "WB-LEASE-SACSI4-503-20230311-SUN");
const sunCloseout = await checked(supabase.from("payments").select("source_type, amount").eq("source_id", sunLease.id).in("source_type", ["lease_deposit_refund", "lease_deposit_deduction"]), "load Sun deposit closeout");
if (sunCloseout.length !== 2 || sunCloseout.reduce((sum, payment) => sum + Number(payment.amount), 0) !== 1_000_000) throw new Error("Unexpected Sun deposit closeout");

const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).single(), "load 503 sale");
if (Number(sale.total_amount_xof) !== 73_000_000) throw new Error("Unexpected 503 sale total");
const salePayments = await checked(supabase.from("payments").select("source_type, payment_date, amount, receipt_no, notes").eq("source_id", sale.id).order("payment_date"), "load 503 sale payments");
const housePayment = salePayments.find((payment) => payment.source_type === "sale_contract");
const propertyPayment = salePayments.find((payment) => payment.source_type === "property_fee");
const furnitureRefund = salePayments.find((payment) => payment.source_type === "sale_other_expense");
if (!housePayment || Number(housePayment.amount) !== 73_000_000) throw new Error("Unexpected 503 house payment");
if (!propertyPayment || Number(propertyPayment.amount) !== 210_000) throw new Error("Unexpected 503 property payment");
if (!furnitureRefund || Number(furnitureRefund.amount) !== 200_000) throw new Error("Unexpected 503 furniture refund");

const propertyRows = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "other").eq("due_date", propertyPayment.payment_date).eq("amount_xof", 210_000), "find sale property receivable");
if (propertyRows.length > 1) throw new Error("Duplicate 503 sale property receivable");
const propertyPayload = {
  building_id: building.id,
  unit_id: unit.id,
  customer_id: sale.customer_id,
  source_type: "sale_contract",
  source_id: sale.id,
  category: "other",
  title: "503\u7269\u4e1a\u8d39",
  due_date: propertyPayment.payment_date,
  amount_xof: 210_000,
  paid_amount_xof: 210_000,
  status: "paid",
  currency: "XOF",
  notes: `${propertyPayment.notes}\n\u6536\u636e\u53f7\uff1a${propertyPayment.receipt_no}`,
};
if (propertyRows.length === 1) await checked(supabase.from("receivables").update(propertyPayload).eq("id", propertyRows[0].id), "update sale property receivable");
else await checked(supabase.from("receivables").insert(propertyPayload), "insert sale property receivable");

await checked(supabase.from("units").update({ notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u4e70\u65b9\u848b\u53cb\u5e73\uff0c\u623f\u6b3e7300\u4e07\u4e8e2024-04-02\u5df2\u7ed3\u6e05\uff0c\u7269\u4e1a\u8d3921\u4e07\u5355\u5217\uff0c2024-04-12\u9000\u8863\u67dc\u8d3920\u4e07\uff1bCHAUHAN\u62bc\u91d1100\u4e07\u7684\u9000\u8fd8\u6216\u6263\u6b3eExcel\u672a\u8bb0\u8f7d\uff0c\u5f85\u6838\u5b9e\u3002" }).eq("id", unit.id), "update 503 notes");
await checked(supabase.from("audit_logs").insert({ action: "rereview_unit_data", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI4", unit_no: "503", historical_leases: 2, sun_deposit_closed_xof: 1_000_000, chauhan_deposit_disposition: "unrecorded", sale_paid_xof: 73_000_000, property_fee_xof: 210_000, furniture_refund_xof: 200_000, receivables_rebuilt_per_payment: true } }), "write audit");

console.log(JSON.stringify({ ok: true, unit: "503", historical_leases: 2, sale_paid_xof: 73_000_000, property_fee_xof: 210_000, furniture_refund_xof: 200_000 }));
