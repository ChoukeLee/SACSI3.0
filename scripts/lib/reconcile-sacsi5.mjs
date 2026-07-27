import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
  const index = line.indexOf("=");
  return [line.slice(0, index), line.slice(index + 1)];
}));

export const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
export async function checked(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

export const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI5").single(), "load SACSI5");

export async function loadUnit(unitNo, expectedArea = undefined) {
  const unit = await checked(supabase.from("units").select("id, unit_no, area_sqm, status, notes").eq("building_id", building.id).eq("unit_no", unitNo).single(), `load ${unitNo}`);
  if (expectedArea !== undefined && Number(unit.area_sqm) !== expectedArea) throw new Error(`Unexpected ${unitNo} area: ${unit.area_sqm}`);
  return unit;
}

export async function prepareSaleUnit({ unitNo, expectedArea, customerName, legacyContractNo, customerNotes }) {
  const unit = await loadUnit(unitNo, expectedArea);
  const [leases, sales] = await Promise.all([
    checked(supabase.from("lease_contracts").select("id, customer_id, contract_no").eq("unit_id", unit.id), `load ${unitNo} leases`),
    checked(supabase.from("sale_contracts").select("id, customer_id").eq("unit_id", unit.id), `load ${unitNo} sales`),
  ]);
  if (leases.length > 1 || sales.length > 1) throw new Error(`Unexpected ${unitNo} contract count`);
  if (leases.length === 1 && leases[0].contract_no !== legacyContractNo) throw new Error(`Unexpected ${unitNo} lease ${leases[0].contract_no}`);
  let customerId = leases[0]?.customer_id ?? sales[0]?.customer_id;
  if (leases.length === 1) {
    const [payments, receivables, ledgers] = await Promise.all([
      checked(supabase.from("payments").select("id").eq("source_id", leases[0].id), `check ${unitNo} legacy payments`),
      checked(supabase.from("receivables").select("id").eq("source_id", leases[0].id), `check ${unitNo} legacy receivables`),
      checked(supabase.from("ledger_entries").select("id").eq("unit_id", unit.id), `check ${unitNo} legacy ledgers`),
    ]);
    if (payments.length || receivables.length || ledgers.length) throw new Error(`${unitNo} legacy lease has financial references`);
    await checked(supabase.from("lease_contracts").delete().eq("id", leases[0].id), `delete ${unitNo} legacy lease`);
  }
  if (!customerId) {
    const customers = await checked(supabase.from("customers").select("id").eq("name", customerName), `find ${customerName}`);
    if (customers.length > 1) throw new Error(`Duplicate customer ${customerName}`);
    customerId = customers[0]?.id ?? (await checked(supabase.from("customers").insert({ name: customerName, notes: customerNotes, is_blacklisted: false }).select("id").single(), `insert ${customerName}`)).id;
  }
  const customer = await checked(supabase.from("customers").select("name").eq("id", customerId).single(), `verify ${unitNo} customer`);
  if (customer.name !== customerName) throw new Error(`Unexpected ${unitNo} customer: ${customer.name}`);
  await checked(supabase.from("customers").update({ notes: customerNotes }).eq("id", customerId), `update ${customerName}`);
  return { unit, customerId, existingSaleId: sales[0]?.id };
}

export async function upsertSale({ unit, customerId, existingSaleId, contractNo, signedDate, total, status = "active", notes }) {
  const payload = { unit_id: unit.id, customer_id: customerId, contract_no: contractNo, signed_date: signedDate, transfer_status: "not_started", payment_plan_type: notes, total_amount_xof: total, status };
  if (existingSaleId) {
    await checked(supabase.from("sale_contracts").update(payload).eq("id", existingSaleId), `update ${unit.unit_no} sale`);
    return existingSaleId;
  }
  return (await checked(supabase.from("sale_contracts").insert(payload).select("id").single(), `insert ${unit.unit_no} sale`)).id;
}

export async function upsertPayment({ unit, customerId, sourceId, date, amount, receiptNo, notes, sourceType = "sale_contract", direction = "income", category = "sale" }) {
  const rows = await checked(supabase.from("payments").select("id").eq("source_id", sourceId).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const payload = { customer_id: customerId, unit_id: unit.id, source_type: sourceType, source_id: sourceId, payment_date: date, amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
  let paymentId;
  if (rows.length === 1) {
    paymentId = rows[0].id;
    await checked(supabase.from("payments").update(payload).eq("id", paymentId), `update ${receiptNo}`);
  } else paymentId = (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledgerPayload = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: date, direction, category, amount_xof: amount, amount_cny: null, description: notes };
  if (ledgers.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgers[0].id), `update ledger ${receiptNo}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${receiptNo}`);
  return paymentId;
}

export async function upsertReceivable({ unit, customerId, sourceId, title, dueDate, amount, paidAmount, status, notes, category = "sale_lump_sum" }) {
  const rows = await checked(supabase.from("receivables").select("id").eq("source_id", sourceId).eq("title", title).eq("due_date", dueDate).eq("amount_xof", amount), `find receivable ${title}`);
  if (rows.length > 1) throw new Error(`Duplicate receivable ${title}`);
  const payload = { building_id: building.id, unit_id: unit.id, customer_id: customerId, source_type: "sale_contract", source_id: sourceId, category, title, due_date: dueDate, amount_xof: amount, paid_amount_xof: paidAmount, status, currency: "XOF", notes };
  if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update receivable ${title}`);
  else await checked(supabase.from("receivables").insert(payload), `insert receivable ${title}`);
}

export async function setUnit(unit, status, notes) {
  await checked(supabase.from("units").update({ status, notes }).eq("id", unit.id), `update ${unit.unit_no}`);
}

export async function verifyNoFinance(unit, expectedStatus = "available") {
  const [leases, sales, payments, receivables, ledgers, refreshed] = await Promise.all([
    checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id), `verify ${unit.unit_no} leases`),
    checked(supabase.from("sale_contracts").select("id").eq("unit_id", unit.id), `verify ${unit.unit_no} sales`),
    checked(supabase.from("payments").select("id").eq("unit_id", unit.id), `verify ${unit.unit_no} payments`),
    checked(supabase.from("receivables").select("id").eq("unit_id", unit.id).neq("status", "cancelled"), `verify ${unit.unit_no} receivables`),
    checked(supabase.from("ledger_entries").select("id").eq("unit_id", unit.id), `verify ${unit.unit_no} ledgers`),
    checked(supabase.from("units").select("status").eq("id", unit.id).single(), `verify ${unit.unit_no} status`),
  ]);
  if (leases.length || sales.length || payments.length || receivables.length || ledgers.length || refreshed.status !== expectedStatus) throw new Error(`Unexpected ${unit.unit_no} no-finance state`);
}
