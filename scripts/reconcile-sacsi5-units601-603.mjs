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

const tenantName = "\u5c0f\u7c73";
const exchangeRate = 10_997_600 / 19_200;
const specs = {
  "601": { area: 175.95, originalShare: 7_008, rentXof: 4_014_124 },
  "602": { area: 156.39, originalShare: 6_229, rentXof: 3_567_919 },
  "603": { area: 149.72, originalShare: 5_963, rentXof: 3_415_557 },
};
const unitNos = Object.keys(specs);
const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI5").single(), "load building");
const units = await checked(supabase.from("units").select("id, unit_no, area_sqm").eq("building_id", building.id).in("unit_no", unitNos), "load units");
if (units.length !== 3) throw new Error(`Unexpected unit count: ${units.length}`);
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));
for (const unitNo of unitNos) {
  if (Number(unitByNo[unitNo].area_sqm) !== specs[unitNo].area) throw new Error(`Unexpected ${unitNo} area`);
}

const leases = await checked(supabase.from("lease_contracts").select("id, unit_id, customer_id, contract_no").in("unit_id", units.map((unit) => unit.id)), "load leases");
if (leases.length !== 3) throw new Error(`Unexpected lease count: ${leases.length}`);
const leaseByUnitId = Object.fromEntries(leases.map((lease) => [lease.unit_id, lease]));
const customerIds = [...new Set(leases.map((lease) => lease.customer_id))];
if (customerIds.length !== 1) throw new Error("601-603 do not share one tenant");
const customer = await checked(supabase.from("customers").select("id, name").eq("id", customerIds[0]).single(), "load tenant");
if (customer.name !== tenantName) throw new Error(`Unexpected tenant: ${customer.name}`);
const sales = await checked(supabase.from("sale_contracts").select("id").in("unit_id", units.map((unit) => unit.id)), "check sales");
if (sales.length !== 0) throw new Error(`Unexpected sales: ${sales.length}`);

for (const unitNo of unitNos) {
  const unit = unitByNo[unitNo];
  const lease = leaseByUnitId[unit.id];
  const spec = specs[unitNo];
  const contractNo = `WB-LEASE-SACSI5-${unitNo}-20260601-XIAOMI-GROUP`;
  const allowedOldContracts = unitNo === "601"
    ? ["WB-LEASE-SACSI5-601-20260601-XIAOMI", contractNo]
    : [`LEGACY-LEASE-SACSI5-${unitNo}`, contractNo];
  if (!allowedOldContracts.includes(lease.contract_no)) throw new Error(`Unexpected ${unitNo} contract: ${lease.contract_no}`);
  const monthlyRentXof = Math.round(spec.rentXof / 6);
  const allocation = `${unitNo}\u6309\u9762\u79ef${spec.area}\u33a1\u5206\u644a${spec.rentXof} FCFA`;
  const notes = `\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b\u5c0f\u7c73\u8054\u5408\u627f\u79df601\u3001602\u3001603\uff0c\u5373\u516d\u5c42\u7684\u4e00\u534a\uff1b\u79df\u671f2026-06-01\u81f32026-11-30\uff1bExcel\u8bb02026-06-22\u4ed819200\u201c\uffe5\u201d\u3001\u6298\u54081099.76\u4e07FCFA\uff0c\u4e24\u8005\u9690\u542b\u6c47\u7387\u7ea6572.79\uff0c\u4e0e\u4eba\u6c11\u5e01\u4e0d\u7b26\u800c\u4e0e\u7f8e\u5143\u6c47\u7387\u5339\u914d\uff1b\u539f\u5e01\u6309USD\u8bc6\u522b\uff0c\u4ee5Excel\u660e\u786e\u6298\u5408\u91d11099.76\u4e07FCFA\u4f5c\u8d22\u52a1\u4e3b\u91d1\u989d\uff1b${allocation}\uff1b\u65e0\u62bc\u91d1\u3001\u7269\u4e1a\u8d39\u6216\u4ee3\u79df\u8bb0\u5f55\u3002`;
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
  }).eq("id", lease.id), `update ${unitNo} lease`);
  await checked(supabase.from("units").update({ status: "leased", notes }).eq("id", unit.id), `update ${unitNo} unit`);

  const flagRows = await checked(supabase.from("unit_business_flags").select("unit_id").eq("unit_id", unit.id).eq("business_type", "long_lease"), `find ${unitNo} flag`);
  if (flagRows.length > 1) throw new Error(`Duplicate ${unitNo} flags`);
  const flagPayload = { unit_id: unit.id, business_type: "long_lease", is_enabled: true, default_price_xof: monthlyRentXof };
  if (flagRows.length === 1) await checked(supabase.from("unit_business_flags").update(flagPayload).eq("unit_id", unit.id).eq("business_type", "long_lease"), `update ${unitNo} flag`);
  else await checked(supabase.from("unit_business_flags").insert(flagPayload), `insert ${unitNo} flag`);

  const receiptNo = `WB5-LEASE-${unitNo}-20260622-RENT-GROUP-01`;
  const paymentRows = await checked(supabase.from("payments").select("id").eq("source_id", lease.id), `find ${unitNo} payment`);
  if (paymentRows.length > 1) throw new Error(`Unexpected ${unitNo} payments`);
  const paymentNotes = `${notes}\noriginal_currency=USD;original_amount=${spec.originalShare};original_period_months=6`;
  const paymentPayload = { customer_id: customer.id, unit_id: unit.id, source_type: "lease_rent", source_id: lease.id, payment_date: "2026-06-22", amount: spec.rentXof, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes: paymentNotes };
  let paymentId;
  if (paymentRows.length === 1) {
    paymentId = paymentRows[0].id;
    await checked(supabase.from("payments").update(paymentPayload).eq("id", paymentId), `update ${unitNo} payment`);
  } else {
    paymentId = (await checked(supabase.from("payments").insert(paymentPayload).select("id").single(), `insert ${unitNo} payment`)).id;
  }

  const ledgerRows = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ${unitNo} ledger`);
  if (ledgerRows.length > 1) throw new Error(`Duplicate ${unitNo} ledgers`);
  const ledgerPayload = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: "2026-06-22", direction: "income", category: "lease_rent", amount_xof: spec.rentXof, amount_cny: null, description: notes };
  if (ledgerRows.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgerRows[0].id), `update ${unitNo} ledger`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ${unitNo} ledger`);

  const receivableRows = await checked(supabase.from("receivables").select("id").eq("source_id", lease.id).neq("status", "cancelled"), `find ${unitNo} receivable`);
  if (receivableRows.length > 1) throw new Error(`Unexpected ${unitNo} receivables`);
  const receivablePayload = { building_id: building.id, unit_id: unit.id, customer_id: customer.id, source_type: "lease_contract", source_id: lease.id, category: "lease_rent", title: `5# ${unitNo}\u8054\u5408\u79df\u91d1\u5206\u644a`, due_date: "2026-06-22", amount_xof: spec.rentXof, paid_amount_xof: spec.rentXof, status: "paid", currency: "XOF", notes: `${notes}\n\u6536\u636e\u53f7\uff1a${receiptNo}` };
  if (receivableRows.length === 1) await checked(supabase.from("receivables").update(receivablePayload).eq("id", receivableRows[0].id), `update ${unitNo} receivable`);
  else await checked(supabase.from("receivables").insert(receivablePayload), `insert ${unitNo} receivable`);
}

await checked(supabase.from("customers").update({ notes: "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b5# 601\u3001602\u3001603\u8054\u5408\u79df\u6237\uff0c\u627f\u79df\u516d\u5c42\u4e00\u534a\u3002" }).eq("id", customer.id), "update tenant");

const verifiedLeases = await checked(supabase.from("lease_contracts").select("id, unit_id, signer_name, start_date, expected_end_date, deposit_amount_xof, status, paid_through_date").in("unit_id", units.map((unit) => unit.id)), "verify leases");
const verifiedPayments = await checked(supabase.from("payments").select("source_id, source_type, amount, currency, exchange_rate_to_xof").in("source_id", verifiedLeases.map((lease) => lease.id)), "verify payments");
const verifiedReceivables = await checked(supabase.from("receivables").select("source_id, amount_xof, paid_amount_xof, status").in("source_id", verifiedLeases.map((lease) => lease.id)).neq("status", "cancelled"), "verify receivables");
const verifiedLedgers = await checked(supabase.from("ledger_entries").select("unit_id, amount_xof, amount_cny, direction, category").in("unit_id", units.map((unit) => unit.id)), "verify ledgers");
if (verifiedLeases.length !== 3 || verifiedLeases.some((lease) => lease.signer_name !== tenantName || lease.start_date !== "2026-06-01" || lease.expected_end_date !== "2026-11-30" || lease.status !== "active" || lease.paid_through_date !== "2026-11-30" || Number(lease.deposit_amount_xof) !== 0)) throw new Error("Unexpected verified leases");
if (verifiedPayments.length !== 3 || verifiedPayments.some((payment) => payment.source_type !== "lease_rent" || payment.currency !== "XOF" || Number(payment.exchange_rate_to_xof) !== 1) || verifiedPayments.reduce((sum, payment) => sum + Number(payment.amount), 0) !== 10_997_600) throw new Error("Unexpected verified payments");
if (verifiedReceivables.length !== 3 || verifiedReceivables.some((row) => row.status !== "paid" || Number(row.amount_xof) !== Number(row.paid_amount_xof)) || verifiedReceivables.reduce((sum, row) => sum + Number(row.amount_xof), 0) !== 10_997_600) throw new Error("Unexpected verified receivables");
if (verifiedLedgers.length !== 3 || verifiedLedgers.some((row) => row.direction !== "income" || row.category !== "lease_rent" || row.amount_cny !== null) || verifiedLedgers.reduce((sum, row) => sum + Number(row.amount_xof), 0) !== 10_997_600) throw new Error("Unexpected verified ledgers");

await checked(supabase.from("audit_logs").insert({ action: "set_joint_lease_original_currency", entity_type: "building", entity_id: building.id, metadata: { building_code: "SACSI5", units: unitNos, tenant: tenantName, joint_lease: true, rented_scope: "6F half floor", allocation_basis: "area_sqm", total_area_sqm: 482.06, lease_start: "2026-06-01", lease_end: "2026-11-30", paid_through: "2026-11-30", workbook_original_amount: 19_200, workbook_original_symbol: "\uffe5", workbook_xof_equivalent: 10_997_600, exchange_rate_to_xof: exchangeRate, cny_interpretation_rejected: true, original_currency: "USD", accounting_currency: "XOF", rent_xof: 10_997_600, allocations: specs, deposit_xof: 0, property_fee_xof: 0, agency_recorded: false } }), "write audit log");
console.log(JSON.stringify({ ok: true, units: unitNos, tenant: tenantName, joint_lease: true, allocation_basis: "area_sqm", accounting_currency: "XOF", rent_xof: 10_997_600, original_amount: 19_200, original_currency: "USD", allocations: specs, paid_through: "2026-11-30" }));
