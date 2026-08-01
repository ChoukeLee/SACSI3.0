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
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "504").single(), "load 504");
const leases = await checked(supabase.from("lease_contracts").select("id, contract_no, customer_id").eq("unit_id", unit.id).order("start_date"), "load 504 leases");
if (leases.length !== 2) throw new Error(`Unexpected 504 lease count: ${leases.length}`);

const historicalLease = leases.find((lease) => lease.contract_no === "WB-LEASE-SACSI4-504-20220115");
const activeLease = leases.find((lease) => lease.contract_no === "WB-LEASE-SACSI4-504-20230606");
if (!historicalLease || !activeLease) throw new Error("Unexpected 504 lease contracts");

await checked(supabase.from("lease_contracts").update({
  status: "terminated",
  actual_end_date: "2023-05-28",
  expected_end_confirmed: true,
}).eq("id", historicalLease.id), "confirm historical lease");
await checked(supabase.from("lease_contracts").update({
  status: "active",
  actual_end_date: null,
  expected_end_date: "2026-09-05",
  expected_end_confirmed: true,
  paid_through_date: "2026-09-05",
}).eq("id", activeLease.id), "confirm active lease");

function categoryFor(sourceType) {
  if (sourceType === "lease_rent") return "lease_rent";
  if (sourceType === "lease_deposit") return "lease_deposit";
  return "other";
}
function titleFor(sourceType) {
  if (sourceType === "lease_rent") return "504\u79df\u91d1";
  if (sourceType === "lease_deposit") return "504\u62bc\u91d1";
  if (sourceType === "property_fee") return "504\u7269\u4e1a\u8d39";
  if (sourceType === "lease_agency_income") return "504\u4e2d\u4ecb\u8d39\u6536\u5165";
  return "504\u5176\u4ed6\u79df\u8d41\u6536\u5165";
}

const leaseExpectations = new Map([
  [historicalLease.id, { count: 6, total_xof: 16_871_000 }],
  [activeLease.id, { count: 16, total_xof: 26_760_000 }],
]);
const incomeTypes = ["lease_rent", "lease_deposit", "property_fee", "lease_agency_income", "lease_other_income"];
for (const lease of leases) {
  const payments = await checked(supabase.from("payments").select("source_type, payment_date, amount, currency, exchange_rate_to_xof, receipt_no, notes").eq("source_id", lease.id).in("source_type", incomeTypes).order("payment_date"), `load payments ${lease.contract_no}`);
  const expectation = leaseExpectations.get(lease.id);
  const totalXof = payments.reduce((sum, payment) => sum + (payment.currency === "XOF" ? Number(payment.amount) : Math.round(Number(payment.amount) * Number(payment.exchange_rate_to_xof))), 0);
  if (payments.length !== expectation.count || totalXof !== expectation.total_xof) throw new Error(`${lease.contract_no}: unexpected income payments`);

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

const depositCloseout = await checked(supabase.from("payments").select("source_type, amount").eq("source_id", historicalLease.id).in("source_type", ["lease_deposit_refund", "lease_deposit_deduction"]), "load deposit closeout");
if (depositCloseout.length !== 2 || depositCloseout.reduce((sum, payment) => sum + Number(payment.amount), 0) !== 1_200_000) throw new Error("Unexpected 504 historical deposit closeout");

const ownerPayouts = await checked(supabase.from("payments").select("amount").eq("unit_id", unit.id).eq("source_type", "lease_other_expense"), "load owner payouts");
if (ownerPayouts.length !== 9 || ownerPayouts.reduce((sum, payment) => sum + Number(payment.amount), 0) !== 23_400_000) throw new Error("Unexpected 504 owner payouts");

const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).single(), "load 504 sale");
if (Number(sale.total_amount_xof) !== 80_000_000) throw new Error("Unexpected 504 sale total");
const salePayments = await checked(supabase.from("payments").select("source_type, payment_date, amount, receipt_no, notes").eq("source_id", sale.id).order("payment_date"), "load 504 sale payments");
const housePayments = salePayments.filter((payment) => payment.source_type === "sale_contract");
const taxPayment = salePayments.find((payment) => payment.source_type === "sale_other_income");
if (housePayments.length !== 2 || housePayments.some((payment) => Number(payment.amount) !== 40_000_000)) throw new Error("Unexpected 504 house payments");
if (!taxPayment || Number(taxPayment.amount) !== 1_800_000) throw new Error("Unexpected 504 transfer tax receipt");

const combined = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum").eq("amount_xof", 80_000_000), "find combined sale receivable");
if (combined.length > 1) throw new Error("Duplicate combined 504 sale receivable");
for (let index = 0; index < housePayments.length; index += 1) {
  const payment = housePayments[index];
  const rows = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum").eq("due_date", payment.payment_date).eq("amount_xof", 40_000_000), `find house receivable ${payment.receipt_no}`);
  if (rows.length > 1) throw new Error(`Duplicate house receivable ${payment.receipt_no}`);
  const payload = {
    building_id: building.id,
    unit_id: unit.id,
    customer_id: sale.customer_id,
    source_type: "sale_contract",
    source_id: sale.id,
    category: "sale_lump_sum",
    title: "4# 504\u8d2d\u623f\u6b3e",
    due_date: payment.payment_date,
    amount_xof: 40_000_000,
    paid_amount_xof: 40_000_000,
    status: "paid",
    currency: "XOF",
    notes: `${payment.notes}\n\u6536\u636e\u53f7\uff1a${payment.receipt_no}`,
  };
  if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update house receivable ${payment.receipt_no}`);
  else if (index === 0 && combined.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", combined[0].id), "split combined house receivable");
  else await checked(supabase.from("receivables").insert(payload), `insert house receivable ${payment.receipt_no}`);
}

const taxRows = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "other").eq("due_date", taxPayment.payment_date).eq("amount_xof", 1_800_000), "find tax receivable");
if (taxRows.length > 1) throw new Error("Duplicate 504 tax receivable");
const taxPayload = {
  building_id: building.id,
  unit_id: unit.id,
  customer_id: sale.customer_id,
  source_type: "sale_contract",
  source_id: sale.id,
  category: "other",
  title: "504\u8fc7\u6237\u7a0e\u4ee3\u6536",
  due_date: taxPayment.payment_date,
  amount_xof: 1_800_000,
  paid_amount_xof: 1_800_000,
  status: "paid",
  currency: "XOF",
  notes: `${taxPayment.notes}\n\u6536\u636e\u53f7\uff1a${taxPayment.receipt_no}`,
};
if (taxRows.length === 1) await checked(supabase.from("receivables").update(taxPayload).eq("id", taxRows[0].id), "update tax receivable");
else await checked(supabase.from("receivables").insert(taxPayload), "insert tax receivable");

const saleReceivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).neq("status", "cancelled"), "verify sale receivables");
if (saleReceivables.length !== 3) throw new Error(`Unexpected 504 sale receivable count: ${saleReceivables.length}`);

await checked(supabase.from("units").update({ notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u4e70\u65b9KONE SOUNAN\uff0c\u623f\u6b3e8000\u4e07\u5206\u4e3a2\u7b144000\u4e07\u5df2\u7ed3\u6e05\uff0c\u8fc7\u6237\u7a0e\u4ee3\u6536180\u4e07\u5355\u5217\uff1b\u6cb3\u5357\u4ea4\u901a\u4e3a504\u4ee3\u79df\u79df\u5ba2\uff0c\u5f53\u524d\u5728\u79df\u5e76\u5df2\u7f34\u81f32026-09-05\uff1b\u623f\u4e1c\u53d6\u79df9\u7b14\u5408\u8ba12340\u4e07\u5355\u5217\u4e3a\u652f\u51fa\u3002" }).eq("id", unit.id), "update 504 notes");
await checked(supabase.from("audit_logs").insert({ action: "rereview_unit_data", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI4", unit_no: "504", active_agency_tenant: "Henan Transport", paid_through: "2026-09-05", sale_paid_xof: 80_000_000, transfer_tax_received_xof: 1_800_000, owner_payout_count: 9, owner_payout_xof: 23_400_000, receivables_rebuilt_per_payment: true } }), "write audit");

console.log(JSON.stringify({ ok: true, unit: "504", active_tenant: "\u6cb3\u5357\u4ea4\u901a", paid_through: "2026-09-05", sale_receivables: 3, owner_payout_xof: 23_400_000 }));
