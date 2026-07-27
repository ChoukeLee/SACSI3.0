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

const rentCny = 19_200;
const rentXof = 10_997_600;
const exchangeRate = rentXof / rentCny;
const monthlyRentXof = Math.round(rentXof / 6);
const tenantName = "\u5c0f\u7c73";
const contractNo = "WB-LEASE-SACSI5-601-20260601-XIAOMI";
const receiptNo = "WB5-LEASE-601-20260622-RENT-01";
const notes = "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b\u5c0f\u7c73\u4ec5\u79df\u7528601\u7684\u4e00\u534a\uff0c\u4e0d\u5305\u62ec602\u3001603\uff1b\u79df\u671f2026-06-01\u81f32026-11-30\uff1b2026-06-22\u4e00\u6b21\u6536\u4eba\u6c11\u5e0119200\u5143\uff0c\u6298\u54081099.76\u4e07FCFA\uff1b\u65e0\u62bc\u91d1\u3001\u7269\u4e1a\u8d39\u6216\u4ee3\u79df\u8bb0\u5f55\u3002";

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI5").single(), "load building");
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "601").single(), "load unit");
const sales = await checked(supabase.from("sale_contracts").select("id").eq("unit_id", unit.id), "check sales");
if (sales.length !== 0) throw new Error(`Unexpected 601 sales: ${sales.length}`);

const leaseRows = await checked(supabase.from("lease_contracts").select("id, customer_id, contract_no").eq("unit_id", unit.id), "load lease");
if (leaseRows.length !== 1 || !["LEGACY-LEASE-SACSI5-601", contractNo].includes(leaseRows[0].contract_no)) throw new Error(`Unexpected 601 leases: ${leaseRows.length}`);
const lease = leaseRows[0];
const customer = await checked(supabase.from("customers").select("id, name").eq("id", lease.customer_id).single(), "load tenant");
if (customer.name !== tenantName) throw new Error(`Unexpected 601 tenant: ${customer.name}`);

if (lease.contract_no === "LEGACY-LEASE-SACSI5-601") {
  const [oldPayments, oldReceivables] = await Promise.all([
    checked(supabase.from("payments").select("id").eq("source_id", lease.id), "check legacy payments"),
    checked(supabase.from("receivables").select("id").eq("source_id", lease.id), "check legacy receivables"),
  ]);
  if (oldPayments.length || oldReceivables.length) throw new Error("Legacy 601 lease unexpectedly has financial records");
}

await checked(supabase.from("lease_contracts").update({
  contract_no: contractNo,
  start_date: "2026-06-01",
  expected_end_date: "2026-11-30",
  actual_end_date: null,
  payment_cycle: "semiannual",
  payment_day: 1,
  monthly_rent_xof: monthlyRentXof,
  deposit_amount_xof: 0,
  deposit_received: false,
  rent_free_days: 0,
  signer_name: tenantName,
  status: "active",
  expected_end_confirmed: true,
  paid_through_date: "2026-11-30",
}).eq("id", lease.id), "update lease");
await checked(supabase.from("customers").update({ notes: "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b5# 601\u534a\u95f4\u79df\u6237\u3002" }).eq("id", customer.id), "update tenant");
await checked(supabase.from("units").update({ status: "leased", notes }).eq("id", unit.id), "update unit");

const flagRows = await checked(supabase.from("unit_business_flags").select("unit_id").eq("unit_id", unit.id).eq("business_type", "long_lease"), "find lease flag");
if (flagRows.length > 1) throw new Error("Duplicate 601 long-lease flags");
const flagPayload = { unit_id: unit.id, business_type: "long_lease", is_enabled: true, default_price_xof: monthlyRentXof };
if (flagRows.length === 1) await checked(supabase.from("unit_business_flags").update(flagPayload).eq("unit_id", unit.id).eq("business_type", "long_lease"), "update lease flag");
else await checked(supabase.from("unit_business_flags").insert(flagPayload), "insert lease flag");

const paymentRows = await checked(supabase.from("payments").select("id, receipt_no").eq("source_id", lease.id), "find rent payment");
if (paymentRows.length > 1 || (paymentRows.length === 1 && paymentRows[0].receipt_no !== receiptNo)) throw new Error("Unexpected 601 payments");
const paymentPayload = { customer_id: customer.id, unit_id: unit.id, source_type: "lease_rent", source_id: lease.id, payment_date: "2026-06-22", amount: rentCny, currency: "CNY", exchange_rate_to_xof: exchangeRate, receipt_no: receiptNo, notes };
let paymentId;
if (paymentRows.length === 1) {
  paymentId = paymentRows[0].id;
  await checked(supabase.from("payments").update(paymentPayload).eq("id", paymentId), "update rent payment");
} else {
  paymentId = (await checked(supabase.from("payments").insert(paymentPayload).select("id").single(), "insert rent payment")).id;
}

const ledgerRows = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), "find rent ledger");
if (ledgerRows.length > 1) throw new Error("Duplicate 601 rent ledgers");
const ledgerPayload = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: "2026-06-22", direction: "income", category: "lease_rent", amount_xof: rentXof, amount_cny: rentCny, description: notes };
if (ledgerRows.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgerRows[0].id), "update rent ledger");
else await checked(supabase.from("ledger_entries").insert(ledgerPayload), "insert rent ledger");

const receivableRows = await checked(supabase.from("receivables").select("id").eq("source_id", lease.id).neq("status", "cancelled"), "find rent receivable");
if (receivableRows.length > 1) throw new Error("Unexpected 601 receivables");
const receivablePayload = { building_id: building.id, unit_id: unit.id, customer_id: customer.id, source_type: "lease_contract", source_id: lease.id, category: "lease_rent", title: "5# 601\u534a\u95f4\u79df\u91d1", due_date: "2026-06-22", amount_xof: rentXof, paid_amount_xof: rentXof, status: "paid", currency: "XOF", notes: `${notes}\n\u6536\u636e\u53f7\uff1a${receiptNo}` };
if (receivableRows.length === 1) await checked(supabase.from("receivables").update(receivablePayload).eq("id", receivableRows[0].id), "update rent receivable");
else await checked(supabase.from("receivables").insert(receivablePayload), "insert rent receivable");

const [verifiedLease, payments, receivables, ledgers] = await Promise.all([
  checked(supabase.from("lease_contracts").select("contract_no, start_date, expected_end_date, status, paid_through_date, deposit_amount_xof").eq("id", lease.id).single(), "verify lease"),
  checked(supabase.from("payments").select("source_type, amount, currency, exchange_rate_to_xof").eq("source_id", lease.id), "verify payments"),
  checked(supabase.from("receivables").select("amount_xof, paid_amount_xof, status").eq("source_id", lease.id).neq("status", "cancelled"), "verify receivables"),
  checked(supabase.from("ledger_entries").select("amount_xof, amount_cny, direction, category").eq("payment_id", paymentId), "verify ledger"),
]);
if (verifiedLease.contract_no !== contractNo || verifiedLease.start_date !== "2026-06-01" || verifiedLease.expected_end_date !== "2026-11-30" || verifiedLease.status !== "active" || verifiedLease.paid_through_date !== "2026-11-30" || Number(verifiedLease.deposit_amount_xof) !== 0) throw new Error("Unexpected verified lease");
if (payments.length !== 1 || payments[0].source_type !== "lease_rent" || payments[0].currency !== "CNY" || Number(payments[0].amount) !== rentCny || Math.round(Number(payments[0].amount) * Number(payments[0].exchange_rate_to_xof)) !== rentXof) throw new Error("Unexpected verified payment");
if (receivables.length !== 1 || Number(receivables[0].amount_xof) !== rentXof || Number(receivables[0].paid_amount_xof) !== rentXof || receivables[0].status !== "paid") throw new Error("Unexpected verified receivable");
if (ledgers.length !== 1 || Number(ledgers[0].amount_xof) !== rentXof || Number(ledgers[0].amount_cny) !== rentCny || ledgers[0].direction !== "income" || ledgers[0].category !== "lease_rent") throw new Error("Unexpected verified ledger");

await checked(supabase.from("audit_logs").insert({ action: "reconcile_unit_lease_data", entity_type: "lease_contract", entity_id: lease.id, metadata: { building_code: "SACSI5", unit_no: "601", tenant: tenantName, partial_unit: true, rented_fraction: "1/2", includes_units: ["601"], excludes_units: ["602", "603"], lease_start: "2026-06-01", lease_end: "2026-11-30", paid_through: "2026-11-30", rent_cny: rentCny, rent_xof: rentXof, exchange_rate_to_xof: exchangeRate, deposit_xof: 0, property_fee_xof: 0, agency_recorded: false } }), "write audit log");
console.log(JSON.stringify({ ok: true, unit: "601", tenant: tenantName, partial_unit: true, rent_cny: rentCny, rent_xof: rentXof, monthly_rent_xof: monthlyRentXof, paid_through: "2026-11-30" }));
