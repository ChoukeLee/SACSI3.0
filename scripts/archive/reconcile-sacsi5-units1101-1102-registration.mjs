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
const units = await checked(supabase.from("units").select("id, unit_no").eq("building_id", building.id).in("unit_no", ["1101", "1102"]), "load units");
if (units.length !== 2) throw new Error(`Unexpected unit count: ${units.length}`);
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));
const [leases, sales] = await Promise.all([
  checked(supabase.from("lease_contracts").select("id, unit_id").in("unit_id", units.map((unit) => unit.id)), "check leases"),
  checked(supabase.from("sale_contracts").select("id, unit_id").in("unit_id", units.map((unit) => unit.id)), "check sales"),
]);
if (leases.length !== 0 || sales.length !== 0) throw new Error("1101/1102 unexpectedly have contracts");

async function upsertCustomer(name, notes) {
  const rows = await checked(supabase.from("customers").select("id").eq("name", name), `find customer ${name}`);
  if (rows.length > 1) throw new Error(`Duplicate customer ${name}`);
  if (rows.length === 1) {
    await checked(supabase.from("customers").update({ notes }).eq("id", rows[0].id), `update customer ${name}`);
    return rows[0].id;
  }
  return (await checked(supabase.from("customers").insert({ name, notes, is_blacklisted: false }).select("id").single(), `insert customer ${name}`)).id;
}

const specs = {
  "1101": { name: "OSSEPE", status: "available", note: "\u65e0\u540e\u7eed\u8d2d\u5165\uff0c\u623f\u95f4\u4fdd\u6301\u7a7a\u95f2\u3002" },
  "1102": { name: "YAO", status: "leased", note: "\u65e0\u540e\u7eed\u8d2d\u5165\uff1b\u7528\u6237\u786e\u8ba4\u76ee\u524d\u5df2\u51fa\u79df\uff0c\u4f46\u627f\u79df\u4eba\u3001\u79df\u671f\u3001\u79df\u91d1\u3001\u62bc\u91d1\u548c\u6536\u6b3e\u4fe1\u606f\u5f85\u4e0b\u5348\u8865\u5145\uff0c\u6682\u4e0d\u521b\u5efa\u5408\u540c\u6216\u8d22\u52a1\u6d41\u6c34\u3002" },
};
for (const [unitNo, spec] of Object.entries(specs)) {
  const unit = unitByNo[unitNo];
  const customerNotes = spec.name === "YAO"
    ? "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b2025-02-07\u5206\u522b\u4e3a5# 905\u30011102\u652f\u4ed8\u6ce8\u518c\u91d1\u540430\u4e07\uff1b\u4e24\u95f4\u5747\u65e0\u540e\u7eed\u8d2d\u623f\uff1b1102\u73b0\u5df2\u51fa\u79df\uff0c\u79df\u7ea6\u4fe1\u606f\u5f85\u8865\u5145\u3002"
    : `\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b2025-02-07\u4e3a5# ${unitNo}\u652f\u4ed8\u6ce8\u518c\u91d130\u4e07\uff1b\u65e0\u540e\u7eed\u8d2d\u623f\u3002`;
  const customerId = await upsertCustomer(spec.name, customerNotes);
  const receiptNo = `WB5-SALE-${unitNo}-20250207-REGISTRATION-01`;
  const notes = `${unitNo} ${spec.name}\u4e8e2025-02-07\u652f\u4ed8\u6ce8\u518c\u91d130\u4e07FCFA\uff1b\u65e0\u540e\u7eed\u8d2d\u5165\uff0c\u4e0d\u521b\u5efa\u9500\u552e\u5408\u540c\uff0c\u4e0d\u63a8\u65ad\u9000\u6b3e\u6216\u8f6c\u5165\u5176\u4ed6\u623f\u95f4\u3002`;
  const paymentRows = await checked(supabase.from("payments").select("id").eq("source_id", unit.id).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (paymentRows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const paymentPayload = { customer_id: customerId, unit_id: unit.id, source_type: "sale_registration_fee", source_id: unit.id, payment_date: "2025-02-07", amount: 300_000, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
  let paymentId;
  if (paymentRows.length === 1) {
    paymentId = paymentRows[0].id;
    await checked(supabase.from("payments").update(paymentPayload).eq("id", paymentId), `update ${receiptNo}`);
  } else {
    paymentId = (await checked(supabase.from("payments").insert(paymentPayload).select("id").single(), `insert ${receiptNo}`)).id;
  }
  const ledgerRows = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgerRows.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledgerPayload = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: "2025-02-07", direction: "income", category: "sale_registration_fee", amount_xof: 300_000, amount_cny: null, description: notes };
  if (ledgerRows.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgerRows[0].id), `update ledger ${receiptNo}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${receiptNo}`);

  const receivableRows = await checked(supabase.from("receivables").select("id").eq("source_type", "manual").eq("source_id", unit.id).eq("title", `5# ${unitNo}\u6ce8\u518c\u91d1`), `find ${unitNo} receivable`);
  if (receivableRows.length > 1) throw new Error(`Duplicate ${unitNo} receivables`);
  const receivablePayload = { building_id: building.id, unit_id: unit.id, customer_id: customerId, source_type: "manual", source_id: unit.id, category: "other", title: `5# ${unitNo}\u6ce8\u518c\u91d1`, due_date: "2025-02-07", amount_xof: 300_000, paid_amount_xof: 300_000, status: "paid", currency: "XOF", notes: `${notes}\n\u6536\u636e\u53f7\uff1a${receiptNo}` };
  if (receivableRows.length === 1) await checked(supabase.from("receivables").update(receivablePayload).eq("id", receivableRows[0].id), `update ${unitNo} receivable`);
  else await checked(supabase.from("receivables").insert(receivablePayload), `insert ${unitNo} receivable`);
  await checked(supabase.from("units").update({ status: spec.status, notes: `\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b${spec.name}\u4e8e2025-02-07\u652f\u4ed8\u6ce8\u518c\u91d130\u4e07\uff1b${spec.note}` }).eq("id", unit.id), `update ${unitNo}`);
}

const [verifiedUnits, verifiedPayments, verifiedReceivables, verifiedLedgers, verifiedLeases, verifiedSales] = await Promise.all([
  checked(supabase.from("units").select("unit_no, status").in("id", units.map((unit) => unit.id)), "verify units"),
  checked(supabase.from("payments").select("unit_id, amount, source_type").in("source_id", units.map((unit) => unit.id)).eq("source_type", "sale_registration_fee"), "verify payments"),
  checked(supabase.from("receivables").select("unit_id, amount_xof, paid_amount_xof, status").in("source_id", units.map((unit) => unit.id)).eq("source_type", "manual").neq("status", "cancelled"), "verify receivables"),
  checked(supabase.from("ledger_entries").select("unit_id, amount_xof, direction, category").in("unit_id", units.map((unit) => unit.id)), "verify ledgers"),
  checked(supabase.from("lease_contracts").select("id").in("unit_id", units.map((unit) => unit.id)), "verify leases"),
  checked(supabase.from("sale_contracts").select("id").in("unit_id", units.map((unit) => unit.id)), "verify sales"),
]);
if (!verifiedUnits.some((row) => row.unit_no === "1101" && row.status === "available") || !verifiedUnits.some((row) => row.unit_no === "1102" && row.status === "leased")) throw new Error("Unexpected verified statuses");
if (verifiedPayments.length !== 2 || verifiedPayments.some((row) => Number(row.amount) !== 300_000 || row.source_type !== "sale_registration_fee")) throw new Error("Unexpected verified payments");
if (verifiedReceivables.length !== 2 || verifiedReceivables.some((row) => Number(row.amount_xof) !== 300_000 || Number(row.paid_amount_xof) !== 300_000 || row.status !== "paid")) throw new Error("Unexpected verified receivables");
if (verifiedLedgers.length !== 2 || verifiedLedgers.some((row) => Number(row.amount_xof) !== 300_000 || row.direction !== "income" || row.category !== "sale_registration_fee")) throw new Error("Unexpected verified ledgers");
if (verifiedLeases.length !== 0 || verifiedSales.length !== 0) throw new Error("Contracts must remain absent");

await checked(supabase.from("audit_logs").insert({ action: "reconcile_registration_only_units", entity_type: "building", entity_id: building.id, metadata: { building_code: "SACSI5", units: [{ unit_no: "1101", customer: "OSSEPE", registration_xof: 300_000, purchase_follow_up: false, status: "available" }, { unit_no: "1102", customer: "YAO", registration_xof: 300_000, purchase_follow_up: false, status: "leased", current_lease_details_pending: true, lease_contract_created: false }], registration_date: "2025-02-07", refunds_inferred: false } }), "write audit log");
console.log(JSON.stringify({ ok: true, units: { "1101": { registration_xof: 300_000, status: "available" }, "1102": { registration_xof: 300_000, status: "leased", lease_details_pending: true } }, contracts_created: false }));
