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

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI5").single(), "load building");
const units = await checked(supabase.from("units").select("id, unit_no").eq("building_id", building.id).in("unit_no", ["904", "905"]), "load units");
if (units.length !== 2) throw new Error(`Unexpected unit count: ${units.length}`);
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));

async function upsertCustomer(name, notes) {
  const rows = await checked(supabase.from("customers").select("id").eq("name", name), `find customer ${name}`);
  if (rows.length > 1) throw new Error(`Duplicate customer ${name}`);
  if (rows.length === 1) {
    await checked(supabase.from("customers").update({ notes }).eq("id", rows[0].id), `update customer ${name}`);
    return rows[0].id;
  }
  return (await checked(supabase.from("customers").insert({ name, notes, is_blacklisted: false }).select("id").single(), `insert customer ${name}`)).id;
}

const elielId = await upsertCustomer("ELIEL", "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b5# 904\u8d2d\u623f\u4eba\uff1b\u539f\u8868\u5907\u6ce8\u2018\u5f53\u5175\u2019\uff0c\u4e0d\u636e\u6b64\u63a8\u65ad\u5176\u4ed6\u8eab\u4efd\u4fe1\u606f\u3002");
const kanateId = await upsertCustomer("KANATE ALY", "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b2023-10-10\u4e3a5# 904\u652f\u4ed8\u6ce8\u518c\u91d130\u4e07\uff1b\u672a\u89c1\u540e\u7eed\u8d2d\u623f\u5408\u540c\u3002");
const yaoId = await upsertCustomer("YAO", "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b2025-02-07\u4e3a5# 905\u652f\u4ed8\u6ce8\u518c\u91d130\u4e07\uff1b\u672a\u89c1\u540e\u7eed\u8d2d\u623f\u5408\u540c\u3002");

const oldLeases = await checked(supabase.from("lease_contracts").select("id, contract_no").eq("unit_id", unitByNo["904"].id), "load 904 leases");
if (oldLeases.length > 1 || (oldLeases.length === 1 && oldLeases[0].contract_no !== "LEGACY-LEASE-SACSI5-904")) throw new Error("Unexpected 904 lease");
if (oldLeases.length === 1) {
  const leaseId = oldLeases[0].id;
  const [payments, receivables, ledgers] = await Promise.all([
    checked(supabase.from("payments").select("id").eq("source_id", leaseId), "check legacy lease payments"),
    checked(supabase.from("receivables").select("id").eq("source_id", leaseId), "check legacy lease receivables"),
    checked(supabase.from("ledger_entries").select("id").eq("unit_id", unitByNo["904"].id), "check legacy lease ledger"),
  ]);
  if (payments.length || receivables.length || ledgers.length) throw new Error("Legacy 904 lease unexpectedly has financial references");
  await checked(supabase.from("lease_contracts").delete().eq("id", leaseId), "delete legacy lease");
}

const contractNo = "WB-SALE-SACSI5-904-20260504-ELIEL";
let saleRows = await checked(supabase.from("sale_contracts").select("id").eq("unit_id", unitByNo["904"].id), "find 904 sale");
if (saleRows.length > 1) throw new Error("Duplicate 904 sales");
const salePayload = {
  unit_id: unitByNo["904"].id,
  customer_id: elielId,
  contract_no: contractNo,
  signed_date: "2026-05-04",
  transfer_status: "not_started",
  payment_plan_type: "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b\u5408\u540c\u603b\u4ef719587\u4e07\uff0c\u56db\u7b14\u623f\u6b3e\u540819000\u4e07\uff0c\u4ecd\u6b20587\u4e07\uff1b\u672a\u8bb0\u5408\u540c\u7b7e\u7f72\u65e5\u671f\uff0c\u4ee5\u9996\u7b14\u623f\u6b3e\u65e52026-05-04\u4f5c\u6280\u672f\u7b7e\u7ea6\u65e5\u3002KANATE ALY\u6ce8\u518c\u91d130\u4e07\u4e0eELIEL\u623f\u6b3e\u5206\u5f00\u7edf\u8ba1\u3002",
  total_amount_xof: 195_870_000,
  status: "active",
};
let saleId;
if (saleRows.length === 1) {
  saleId = saleRows[0].id;
  await checked(supabase.from("sale_contracts").update(salePayload).eq("id", saleId), "update 904 sale");
} else {
  saleId = (await checked(supabase.from("sale_contracts").insert(salePayload).select("id").single(), "insert 904 sale")).id;
}

async function upsertPayment({ customerId, unitId, sourceType, sourceId, date, amount, receipt, notes, ledgerCategory }) {
  const rows = await checked(supabase.from("payments").select("id").eq("source_id", sourceId).eq("receipt_no", receipt), `find ${receipt}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receipt}`);
  const payload = { customer_id: customerId, unit_id: unitId, source_type: sourceType, source_id: sourceId, payment_date: date, amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receipt, notes };
  let paymentId;
  if (rows.length === 1) {
    paymentId = rows[0].id;
    await checked(supabase.from("payments").update(payload).eq("id", paymentId), `update ${receipt}`);
  } else {
    paymentId = (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receipt}`)).id;
  }
  const ledgerRows = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receipt}`);
  if (ledgerRows.length > 1) throw new Error(`Duplicate ledger ${receipt}`);
  const ledgerPayload = { building_id: building.id, unit_id: unitId, payment_id: paymentId, entry_date: date, direction: "income", category: ledgerCategory, amount_xof: amount, amount_cny: null, description: notes };
  if (ledgerRows.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgerRows[0].id), `update ledger ${receipt}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${receipt}`);
  return paymentId;
}

const houseEntries = [
  ["2026-05-04", 80_000_000, "HOUSE-01"],
  ["2026-05-29", 20_000_000, "HOUSE-02"],
  ["2026-06-01", 80_000_000, "HOUSE-03"],
  ["2026-07-03", 10_000_000, "HOUSE-04"],
];
const housePaymentIds = [];
for (const [date, amount, suffix] of houseEntries) {
  const receipt = `WB5-SALE-904-${date.replaceAll("-", "")}-${suffix}`;
  const notes = `904 ELIEL\u623f\u6b3e${amount / 10_000}\u4e07FCFA\uff1b\u5408\u540c\u603b\u4ef719587\u4e07\uff0c\u56db\u7b14\u623f\u6b3e\u540819000\u4e07\uff0c\u4ecd\u6b20587\u4e07\u3002`;
  const paymentId = await upsertPayment({ customerId: elielId, unitId: unitByNo["904"].id, sourceType: "sale_contract", sourceId: saleId, date, amount, receipt, notes, ledgerCategory: "sale" });
  housePaymentIds.push(paymentId);
  const rows = await checked(supabase.from("receivables").select("id").eq("source_id", saleId).eq("category", "sale_lump_sum").eq("due_date", date).eq("amount_xof", amount), `find receivable ${receipt}`);
  if (rows.length > 1) throw new Error(`Duplicate receivable ${receipt}`);
  const payload = { building_id: building.id, unit_id: unitByNo["904"].id, customer_id: elielId, source_type: "sale_contract", source_id: saleId, category: "sale_lump_sum", title: "5# 904\u8d2d\u623f\u6b3e", due_date: date, amount_xof: amount, paid_amount_xof: amount, status: "paid", currency: "XOF", notes: `${notes}\n\u6536\u636e\u53f7\uff1a${receipt}` };
  if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update receivable ${receipt}`);
  else await checked(supabase.from("receivables").insert(payload), `insert receivable ${receipt}`);
}

const balanceRows = await checked(supabase.from("receivables").select("id").eq("source_id", saleId).eq("category", "sale_lump_sum").eq("amount_xof", 5_870_000).eq("paid_amount_xof", 0), "find 904 balance");
if (balanceRows.length > 1) throw new Error("Duplicate 904 balance");
const balancePayload = { building_id: building.id, unit_id: unitByNo["904"].id, customer_id: elielId, source_type: "sale_contract", source_id: saleId, category: "sale_lump_sum", title: "5# 904\u5269\u4f59\u8d2d\u623f\u6b3e", due_date: "2026-05-04", amount_xof: 5_870_000, paid_amount_xof: 0, status: "overdue", currency: "XOF", notes: "904 ELIEL\u5408\u540c\u603b\u4ef719587\u4e07\uff0c\u5df2\u4ed819000\u4e07\uff0c\u4ecd\u6b20587\u4e07\uff1b\u5b9e\u9645\u5230\u671f\u65e5\u672a\u8bb0\u8f7d\uff0c\u4ee5\u6280\u672f\u7b7e\u7ea6\u65e52026-05-04\u5f52\u8d26\u3002" };
if (balanceRows.length === 1) await checked(supabase.from("receivables").update(balancePayload).eq("id", balanceRows[0].id), "update 904 balance");
else await checked(supabase.from("receivables").insert(balancePayload), "insert 904 balance");

async function upsertStandaloneRegistration({ unitNo, customerId, name, date }) {
  const unit = unitByNo[unitNo];
  const receipt = `WB5-SALE-${unitNo}-${date.replaceAll("-", "")}-REGISTRATION-01`;
  const notes = `${unitNo} ${name}\u6ce8\u518c\u91d130\u4e07FCFA\uff1b\u4ec5\u8bb0\u5f55\u6ce8\u518c\u91d1\u6536\u5165\uff0c\u4e0d\u8ba1\u5165\u4efb\u4f55\u8d2d\u623f\u5408\u540c\u603b\u4ef7\uff0c\u4e0d\u63a8\u65ad\u9000\u6b3e\u6216\u8f6c\u5165\u5176\u4ed6\u5408\u540c\u3002`;
  await upsertPayment({ customerId, unitId: unit.id, sourceType: "sale_registration_fee", sourceId: unit.id, date, amount: 300_000, receipt, notes, ledgerCategory: "sale_registration_fee" });
  const rows = await checked(supabase.from("receivables").select("id").eq("source_type", "manual").eq("source_id", unit.id).eq("title", `5# ${unitNo}\u6ce8\u518c\u91d1`), `find ${unitNo} registration receivable`);
  if (rows.length > 1) throw new Error(`Duplicate ${unitNo} registration receivables`);
  const payload = { building_id: building.id, unit_id: unit.id, customer_id: customerId, source_type: "manual", source_id: unit.id, category: "other", title: `5# ${unitNo}\u6ce8\u518c\u91d1`, due_date: date, amount_xof: 300_000, paid_amount_xof: 300_000, status: "paid", currency: "XOF", notes: `${notes}\n\u6536\u636e\u53f7\uff1a${receipt}` };
  if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update ${unitNo} registration receivable`);
  else await checked(supabase.from("receivables").insert(payload), `insert ${unitNo} registration receivable`);
}

await upsertStandaloneRegistration({ unitNo: "904", customerId: kanateId, name: "KANATE ALY", date: "2023-10-10" });
await upsertStandaloneRegistration({ unitNo: "905", customerId: yaoId, name: "YAO", date: "2025-02-07" });

await checked(supabase.from("units").update({ status: "sold", notes: "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b\u4e70\u65b9ELIEL\uff0c\u5408\u540c\u603b\u4ef719587\u4e07\uff0c\u56db\u7b14\u623f\u6b3e\u540819000\u4e07\uff0c\u4ecd\u6b20587\u4e07\uff1b\u65e0\u79df\u8d41\u8bb0\u5f55\u3002KANATE ALY 2023-10-10\u6ce8\u518c\u91d130\u4e07\u72ec\u7acb\u5217\u793a\uff0c\u4e0d\u5f52\u5165ELIEL\u623f\u6b3e\u3002" }).eq("id", unitByNo["904"].id), "update 904 unit");
await checked(supabase.from("units").update({ status: "available", notes: "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1bYAO\u4e8e2025-02-07\u652f\u4ed8\u6ce8\u518c\u91d130\u4e07\uff1b\u65e0\u5408\u540c\u603b\u4ef7\u6216\u623f\u6b3e\u8bb0\u5f55\uff0c\u4e0d\u521b\u5efa\u9500\u552e\u5408\u540c\uff0c\u623f\u95f4\u4fdd\u6301\u7a7a\u95f2\uff1b\u4e0d\u63a8\u65ad\u9000\u6b3e\u6216\u8f6c\u5165\u5176\u4ed6\u5408\u540c\u3002" }).eq("id", unitByNo["905"].id), "update 905 unit");

const [verifiedLeases, verifiedSales, salePayments, saleReceivables, registrationPayments, manualReceivables] = await Promise.all([
  checked(supabase.from("lease_contracts").select("id").in("unit_id", units.map((unit) => unit.id)), "verify leases"),
  checked(supabase.from("sale_contracts").select("id, unit_id, customer_id, total_amount_xof, status").in("unit_id", units.map((unit) => unit.id)), "verify sales"),
  checked(supabase.from("payments").select("amount, source_type").eq("source_id", saleId), "verify sale payments"),
  checked(supabase.from("receivables").select("amount_xof, paid_amount_xof, status").eq("source_id", saleId).eq("source_type", "sale_contract").neq("status", "cancelled"), "verify sale receivables"),
  checked(supabase.from("payments").select("unit_id, customer_id, amount, source_type").in("source_id", units.map((unit) => unit.id)).eq("source_type", "sale_registration_fee"), "verify registration payments"),
  checked(supabase.from("receivables").select("unit_id, customer_id, amount_xof, paid_amount_xof, status").in("source_id", units.map((unit) => unit.id)).eq("source_type", "manual").neq("status", "cancelled"), "verify manual receivables"),
]);
if (verifiedLeases.length !== 0 || verifiedSales.length !== 1 || verifiedSales[0].unit_id !== unitByNo["904"].id || Number(verifiedSales[0].total_amount_xof) !== 195_870_000 || verifiedSales[0].status !== "active") throw new Error("Unexpected verified contracts");
if (salePayments.length !== 4 || salePayments.some((row) => row.source_type !== "sale_contract") || salePayments.reduce((sum, row) => sum + Number(row.amount), 0) !== 190_000_000) throw new Error("Unexpected verified house payments");
if (saleReceivables.length !== 5 || saleReceivables.reduce((sum, row) => sum + Number(row.amount_xof), 0) !== 195_870_000 || saleReceivables.reduce((sum, row) => sum + Number(row.paid_amount_xof), 0) !== 190_000_000 || saleReceivables.filter((row) => row.status === "overdue").reduce((sum, row) => sum + Number(row.amount_xof) - Number(row.paid_amount_xof), 0) !== 5_870_000) throw new Error("Unexpected verified sale receivables");
if (registrationPayments.length !== 2 || registrationPayments.reduce((sum, row) => sum + Number(row.amount), 0) !== 600_000 || registrationPayments.some((row) => row.source_type !== "sale_registration_fee")) throw new Error("Unexpected verified registrations");
if (manualReceivables.length !== 2 || manualReceivables.some((row) => Number(row.amount_xof) !== 300_000 || Number(row.paid_amount_xof) !== 300_000 || row.status !== "paid")) throw new Error("Unexpected verified registration receivables");

await checked(supabase.from("audit_logs").insert({ action: "reconcile_floor_sale_data", entity_type: "building", entity_id: building.id, metadata: { building_code: "SACSI5", floor: "9F", front_asset_available: true, unit_904: { buyer: "ELIEL", sale_total_xof: 195_870_000, paid_xof: 190_000_000, outstanding_xof: 5_870_000, contract_date_inferred_from_first_payment: true, erroneous_lease_deleted: true }, registrations: [{ unit_no: "904", customer: "KANATE ALY", date: "2023-10-10", amount_xof: 300_000, included_in_sale_total: false }, { unit_no: "905", customer: "YAO", date: "2025-02-07", amount_xof: 300_000, sale_contract_created: false }], unit_905_status: "available" } }), "write audit log");
console.log(JSON.stringify({ ok: true, floor: "9F", unit_904: { buyer: "ELIEL", total_xof: 195_870_000, paid_xof: 190_000_000, outstanding_xof: 5_870_000 }, registrations_xof: { "904": 300_000, "905": 300_000 }, unit_905_status: "available" }));
