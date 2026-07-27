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
const units = await checked(supabase.from("units").select("id, unit_no, notes").eq("building_id", building.id).in("unit_no", ["403", "509"]), "load units");
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));
if (!unitByNo["403"] || !unitByNo["509"]) throw new Error("Missing 403 or 509");

const lease403 = await checked(supabase.from("lease_contracts").select("id, customer_id").eq("unit_id", unitByNo["403"].id).eq("contract_no", "WB-LEASE-SACSI4-403-20241001-GUO").single(), "load 403 Guo lease");
const leases509 = await checked(supabase.from("lease_contracts").select("id, contract_no, customer_id").eq("unit_id", unitByNo["509"].id).order("start_date"), "load 509 leases");
if (leases509.length !== 3) throw new Error(`Unexpected 509 lease count: ${leases509.length}`);
const usa = leases509.find((lease) => lease.contract_no === "WB-LEASE-SACSI4-509-20220901");
const guo = leases509.find((lease) => lease.contract_no === "WB-LEASE-SACSI4-509-20241201-GUO");
const gao = leases509.find((lease) => lease.contract_no === "WB-LEASE-SACSI4-509-20260401");
if (!usa || !guo || !gao) throw new Error("Unexpected 509 lease contracts");

await checked(supabase.from("lease_contracts").update({ status: "terminated", actual_end_date: "2024-11-30", expected_end_confirmed: true }).eq("id", usa.id), "confirm USA lease");
await checked(supabase.from("lease_contracts").update({ customer_id: lease403.customer_id, signer_name: "\u90ed\u6b66\u8273", status: "terminated", actual_end_date: "2026-03-31", expected_end_confirmed: true }).eq("id", guo.id), "confirm Guo lease");
await checked(supabase.from("lease_contracts").update({ status: "active", actual_end_date: null, expected_end_date: "2026-09-30", expected_end_confirmed: true, paid_through_date: "2026-09-30" }).eq("id", gao.id), "confirm Gao lease");
guo.customer_id = lease403.customer_id;
await checked(supabase.from("payments").update({ customer_id: lease403.customer_id }).eq("source_id", guo.id), "unify Guo payments");
await checked(supabase.from("receivables").update({ customer_id: lease403.customer_id }).eq("source_id", guo.id), "unify Guo receivables");

async function loadPayment(sourceId, receipt) {
  return checked(supabase.from("payments").select("id").eq("source_id", sourceId).eq("receipt_no", receipt).single(), `load ${receipt}`);
}
async function updatePaymentLedger(paymentId, paymentPayload, ledgerPayload, label) {
  await checked(supabase.from("payments").update(paymentPayload).eq("id", paymentId), `update payment ${label}`);
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${label}`);
  if (ledgers.length !== 1) throw new Error(`Unexpected ledger count for ${label}: ${ledgers.length}`);
  await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgers[0].id), `update ledger ${label}`);
}

const rent403 = await loadPayment(lease403.id, "WB4-LEASE-403-20240814-RENT-02");
const prop403 = await loadPayment(lease403.id, "WB4-LEASE-403-20240814-PROP-03");
const rent403Notes = "403\u90ed\u6b66\u8273\u539f\u4ed8\u534a\u5e74\u79df\u91d1300\u4e07\uff1b2024-12-01\u642c\u81f3509\uff0c403\u4fdd\u755910-11\u6708\u79df\u91d1100\u4e07\uff0c\u4f59\u989d200\u4e07\u8f6c509\u3002";
const prop403Notes = "403\u90ed\u6b66\u8273\u539f\u4ed8\u534a\u5e74\u7269\u4e1a\u8d3921\u4e07\uff1b2024-12-01\u642c\u81f3509\uff0c403\u4fdd\u755910-11\u6708\u7269\u4e1a\u8d397\u4e07\uff0c\u4f59\u989d14\u4e07\u8f6c509\u3002";
await updatePaymentLedger(rent403.id, { amount: 1_000_000, notes: rent403Notes }, { amount_xof: 1_000_000, description: rent403Notes }, "403 rent retained");
await updatePaymentLedger(prop403.id, { amount: 70_000, notes: prop403Notes }, { amount_xof: 70_000, description: prop403Notes }, "403 property retained");

const rentReceivable403 = await checked(supabase.from("receivables").select("id").eq("source_id", lease403.id).eq("category", "lease_rent").eq("due_date", "2024-08-14").single(), "load 403 rent receivable");
const propReceivable403 = await checked(supabase.from("receivables").select("id").eq("source_id", lease403.id).eq("category", "other").eq("due_date", "2024-08-14").single(), "load 403 property receivable");
await checked(supabase.from("receivables").update({ amount_xof: 1_000_000, paid_amount_xof: 1_000_000, notes: rent403Notes }).eq("id", rentReceivable403.id), "update 403 rent receivable");
await checked(supabase.from("receivables").update({ amount_xof: 70_000, paid_amount_xof: 70_000, notes: prop403Notes }).eq("id", propReceivable403.id), "update 403 property receivable");

async function upsertPayment(lease, spec) {
  const rows = await checked(supabase.from("payments").select("id").eq("source_id", lease.id).eq("receipt_no", spec.receipt), `find ${spec.receipt}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${spec.receipt}`);
  const payload = {
    customer_id: lease.customer_id,
    unit_id: unitByNo["509"].id,
    source_type: spec.source_type,
    source_id: lease.id,
    payment_date: spec.date,
    amount: spec.amount,
    currency: "XOF",
    exchange_rate_to_xof: 1,
    receipt_no: spec.receipt,
    notes: spec.notes,
  };
  let paymentId;
  if (rows.length === 1) {
    paymentId = rows[0].id;
    await checked(supabase.from("payments").update(payload).eq("id", paymentId), `update ${spec.receipt}`);
  } else {
    paymentId = (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${spec.receipt}`)).id;
  }
  const ledgerPayload = {
    building_id: building.id,
    unit_id: unitByNo["509"].id,
    payment_id: paymentId,
    entry_date: spec.date,
    direction: spec.direction,
    category: spec.ledger_category,
    amount_xof: spec.amount,
    amount_cny: null,
    description: spec.notes,
  };
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${spec.receipt}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${spec.receipt}`);
  if (ledgers.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgers[0].id), `update ledger ${spec.receipt}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${spec.receipt}`);
}

await upsertPayment(guo, {
  source_type: "lease_rent",
  date: "2024-12-01",
  amount: 2_000_000,
  receipt: "WB4-LEASE-509-20241201-RENTTRANSFER-02",
  notes: "509\u90ed\u6b66\u8273\u7531403\u8f6c\u5165\u5269\u4f594\u4e2a\u6708\u79df\u91d1200\u4e07\uff0c\u5df2\u7f34\u81f32025-03-31\u3002",
  direction: "income",
  ledger_category: "lease_rent",
});
await upsertPayment(guo, {
  source_type: "property_fee",
  date: "2024-12-01",
  amount: 140_000,
  receipt: "WB4-LEASE-509-20241201-PROPTRANSFER-03",
  notes: "509\u90ed\u6b66\u8273\u7531403\u8f6c\u5165\u5269\u4f594\u4e2a\u6708\u7269\u4e1a\u8d3914\u4e07\uff0c\u5df2\u7f34\u81f32025-03-31\u3002",
  direction: "income",
  ledger_category: "property_fee",
});

const utilityAdvance = await loadPayment(guo.id, "WB4-LEASE-509-20241204-UTILITY-02");
const utilityNotes = "509\u90ed\u6b66\u8273\u9884\u4ed8\u6c34\u7535\u8d395\u4e07\uff0c\u6309\u4ee3\u6536\u6b3e\u767b\u8bb0\uff0c\u4e0d\u8ba1\u79df\u91d1\u6536\u5165\u3002";
await updatePaymentLedger(utilityAdvance.id, { customer_id: guo.customer_id, source_type: "lease_other_income", notes: utilityNotes }, { direction: "liability_in", category: "utility_advance", amount_xof: 50_000, description: utilityNotes }, "509 utility advance");

function categoryFor(sourceType) {
  if (sourceType === "lease_rent") return "lease_rent";
  if (sourceType === "lease_deposit") return "lease_deposit";
  return "other";
}
function titleFor(sourceType) {
  if (sourceType === "lease_rent") return "509\u79df\u91d1";
  if (sourceType === "lease_deposit") return "509\u62bc\u91d1";
  if (sourceType === "property_fee") return "509\u7269\u4e1a\u8d39";
  return "509\u6c34\u7535\u8d39\u4ee3\u6536";
}

const leaseExpectations = new Map([
  [usa.id, { count: 12, total_xof: 15_945_000 }],
  [guo.id, { count: 8, total_xof: 9_610_000 }],
  [gao.id, { count: 3, total_xof: 4_210_000 }],
]);
for (const lease of leases509) {
  if (lease.id === guo.id) lease.customer_id = guo.customer_id;
  const payments = await checked(supabase.from("payments").select("source_type, payment_date, amount, receipt_no, notes").eq("source_id", lease.id).in("source_type", ["lease_rent", "lease_deposit", "property_fee", "lease_other_income"]).order("payment_date"), `load income payments ${lease.contract_no}`);
  const expected = leaseExpectations.get(lease.id);
  if (payments.length !== expected.count || payments.reduce((sum, payment) => sum + Number(payment.amount), 0) !== expected.total_xof) throw new Error(`${lease.contract_no}: unexpected income payments`);
  for (const payment of payments) {
    const category = categoryFor(payment.source_type);
    const rows = await checked(supabase.from("receivables").select("id").eq("source_id", lease.id).eq("category", category).eq("due_date", payment.payment_date).eq("amount_xof", Number(payment.amount)), `find receivable ${payment.receipt_no}`);
    if (rows.length > 1) throw new Error(`Duplicate receivable ${payment.receipt_no}`);
    const payload = {
      building_id: building.id,
      unit_id: unitByNo["509"].id,
      customer_id: lease.customer_id,
      source_type: "lease_contract",
      source_id: lease.id,
      category,
      title: titleFor(payment.source_type),
      due_date: payment.payment_date,
      amount_xof: Number(payment.amount),
      paid_amount_xof: Number(payment.amount),
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

const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unitByNo["509"].id).single(), "load 509 sale");
if (Number(sale.total_amount_xof) !== 76_000_000) throw new Error("Unexpected 509 sale total");
const salePayments = await checked(supabase.from("payments").select("source_type, payment_date, amount, receipt_no, notes").eq("source_id", sale.id).order("payment_date"), "load 509 sale payments");
const registration = salePayments.find((payment) => payment.source_type === "sale_registration_fee");
const transferTax = salePayments.find((payment) => payment.source_type === "sale_other_income");
if (!registration || Number(registration.amount) !== 250_000 || !transferTax || Number(transferTax.amount) !== 1_950_000) throw new Error("Unexpected 509 sale extras");
for (const spec of [{ payment: registration, title: "509\u6ce8\u518c\u91d1" }, { payment: transferTax, title: "509\u8fc7\u6237\u7a0e\u4ee3\u6536" }]) {
  const rows = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "other").eq("due_date", spec.payment.payment_date).eq("amount_xof", Number(spec.payment.amount)), `find sale receivable ${spec.payment.receipt_no}`);
  if (rows.length > 1) throw new Error(`Duplicate sale receivable ${spec.payment.receipt_no}`);
  const payload = {
    building_id: building.id,
    unit_id: unitByNo["509"].id,
    customer_id: sale.customer_id,
    source_type: "sale_contract",
    source_id: sale.id,
    category: "other",
    title: spec.title,
    due_date: spec.payment.payment_date,
    amount_xof: Number(spec.payment.amount),
    paid_amount_xof: Number(spec.payment.amount),
    status: "paid",
    currency: "XOF",
    notes: `${spec.payment.notes}\n\u6536\u636e\u53f7\uff1a${spec.payment.receipt_no}`,
  };
  if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update sale receivable ${spec.payment.receipt_no}`);
  else await checked(supabase.from("receivables").insert(payload), `insert sale receivable ${spec.payment.receipt_no}`);
}
const saleReceivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).neq("status", "cancelled"), "verify 509 sale receivables");
if (saleReceivables.length !== 3) throw new Error(`Unexpected 509 sale receivable count: ${saleReceivables.length}`);

const transferNote403 = "\u90ed\u6b66\u82732024-12-01\u56e0\u623f\u4e1c\u7528\u623f\u642c\u81f3509\uff0c403\u4fdd\u75592\u4e2a\u6708\u79df\u91d1100\u4e07\u548c\u7269\u4e1a\u8d397\u4e07\uff0c\u5269\u4f594\u4e2a\u6708\u79df\u91d1200\u4e07\u548c\u7269\u4e1a\u8d3914\u4e07\u8f6c509\u3002";
const notes403 = `\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u623f\u6b3e7800\u4e07\u5df2\u7ed3\u6e05\uff1b\u6ce8\u518c\u91d125\u4e07\u548c\u4e2d\u4ecb\u8d39117\u4e07\u53e6\u5217\uff1b${transferNote403}`;
await checked(supabase.from("units").update({ notes: notes403 }).eq("id", unitByNo["403"].id), "update 403 notes");
await checked(supabase.from("units").update({ notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u4e70\u65b9TRAORE\uff0c\u623f\u6b3e7600\u4e07\u5df2\u7ed3\u6e05\uff0c\u6ce8\u518c\u91d125\u4e07\u548c\u8fc7\u6237\u7a0e\u4ee3\u6536195\u4e07\u5355\u5217\uff1b\u90ed\u6b66\u8273\u7531403\u642c\u5165\uff0c\u8f6c\u51654\u4e2a\u6708\u79df\u91d1200\u4e07\u3001\u7269\u4e1a\u8d3914\u4e07\u548c\u62bc\u91d1100\u4e07\uff0c\u62bc\u91d1\u540e\u8f6c\u9ad8\u4fca\u4f1a\uff1b\u6c34\u7535\u8d39\u9884\u4ed85\u4e07\u4e3a\u4ee3\u6536\uff0c\u516c\u53f8\u4ee3\u4ed8\u7535\u8d393.6\u4e07\u4e3a\u652f\u51fa\uff1b\u9ad8\u4fca\u4f1a\u5f53\u524d\u5728\u79df\u5e76\u5df2\u7f34\u81f32026-09-30\u3002" }).eq("id", unitByNo["509"].id), "update 509 notes");
await checked(supabase.from("audit_logs").insert([
  { action: "reallocate_lease_payment", entity_type: "unit", entity_id: unitByNo["403"].id, metadata: { building_code: "SACSI4", unit_no: "403", destination_unit: "509", rent_transferred_xof: 2_000_000, property_fee_transferred_xof: 140_000, total_income_unchanged: true } },
  { action: "rereview_unit_data", entity_type: "unit", entity_id: unitByNo["509"].id, metadata: { building_code: "SACSI4", unit_no: "509", source_unit: "403", transferred_xof: 2_140_000, customer_identity_unified: true, utility_advance_xof: 50_000, utility_expense_xof: 36_000, active_tenant: "Gao Junhui", paid_through: "2026-09-30", receivables_rebuilt_per_payment: true } },
]), "write 403/509 audits");

console.log(JSON.stringify({ ok: true, unit: "509", active_tenant: "\u9ad8\u4fca\u4f1a", paid_through: "2026-09-30", transferred_from_403_xof: 2_140_000, utility_advance_xof: 50_000, sale_receivables: 3 }));
