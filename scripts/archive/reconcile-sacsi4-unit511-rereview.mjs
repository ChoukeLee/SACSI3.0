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
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "511").single(), "load 511");
const leases = await checked(supabase.from("lease_contracts").select("id, contract_no, customer_id").eq("unit_id", unit.id).order("start_date"), "load 511 leases");
if (leases.length !== 2) throw new Error(`Unexpected 511 lease count: ${leases.length}`);
const zeng = leases.find((lease) => lease.contract_no === "WB-LEASE-SACSI4-511-20220915");
const lin = leases.find((lease) => lease.contract_no === "WB-LEASE-SACSI4-511-20260401");
if (!zeng || !lin) throw new Error("Unexpected 511 lease contracts");

await checked(supabase.from("lease_contracts").update({ status: "terminated", actual_end_date: "2026-03-14", expected_end_confirmed: true }).eq("id", zeng.id), "confirm Zeng lease");
await checked(supabase.from("lease_contracts").update({ signer_name: "\u6797\u8363\u4fe42", status: "active", actual_end_date: null, expected_end_date: "2026-09-30", expected_end_confirmed: true, paid_through_date: "2026-09-30" }).eq("id", lin.id), "confirm Lin lease");

const settlement = await checked(supabase.from("payments").select("id, amount").eq("source_id", zeng.id).eq("source_type", "lease_deposit_refund").single(), "load Zeng deposit settlement");
if (Number(settlement.amount) !== 1_000_000) throw new Error("Unexpected Zeng deposit settlement amount");
const settlementNotes = "511\u66fe\u6cd3\u7b562026-03-14\u9000\u623f\uff1bExcel\u4ec5\u8bb0\u62bc\u91d1\u3001\u7ef4\u4fee\u8d39\u5df2\u6e05\uff0c\u672c100\u4e07\u4e3a\u62bc\u91d1\u8d23\u4efb\u7ed3\u7b97\u95ed\u73af\u8bb0\u5f55\uff0c\u4e0d\u4ee3\u8868\u5df2\u786e\u8ba4\u73b0\u91d1\u5168\u989d\u9000\u6b3e\uff0c\u5b9e\u9645\u9000\u6b3e\u4e0e\u7ef4\u4fee\u6263\u6b3e\u672a\u62c6\u5206\u3002";
await checked(supabase.from("payments").update({ notes: settlementNotes }).eq("id", settlement.id), "update Zeng settlement notes");
await checked(supabase.from("ledger_entries").update({ description: settlementNotes }).eq("payment_id", settlement.id), "update Zeng settlement ledger");

const linPayments = await checked(supabase.from("payments").select("id, source_type, amount").eq("source_id", lin.id).in("source_type", ["lease_deposit", "lease_rent", "property_fee"]), "load Lin payments");
if (linPayments.length !== 3) throw new Error(`Unexpected Lin payment count: ${linPayments.length}`);
for (const payment of linPayments) {
  let notes;
  if (payment.source_type === "lease_deposit" && Number(payment.amount) === 1_000_000) notes = "511\u6797\u8363\u4fe42\u62bc\u91d1100\u4e07\u3002";
  else if (payment.source_type === "lease_rent" && Number(payment.amount) === 3_000_000) notes = "511\u6797\u8363\u4fe42\u79df\u91d1300\u4e07\u3002";
  else if (payment.source_type === "property_fee" && Number(payment.amount) === 210_000) notes = "511\u6797\u8363\u4fe42\u7269\u4e1a\u8d3921\u4e07\u3002";
  else throw new Error(`Unexpected Lin payment ${payment.id}`);
  await checked(supabase.from("payments").update({ notes }).eq("id", payment.id), `update Lin payment ${payment.id}`);
  await checked(supabase.from("ledger_entries").update({ description: notes }).eq("payment_id", payment.id), `update Lin ledger ${payment.id}`);
}

function categoryFor(sourceType) {
  if (sourceType === "lease_rent") return "lease_rent";
  if (sourceType === "lease_deposit") return "lease_deposit";
  return "other";
}
function titleFor(sourceType) {
  if (sourceType === "lease_rent") return "511\u79df\u91d1";
  if (sourceType === "lease_deposit") return "511\u62bc\u91d1";
  return "511\u7269\u4e1a\u8d39";
}

const expectations = new Map([
  [zeng.id, { count: 15, total_xof: 23_470_000 }],
  [lin.id, { count: 3, total_xof: 4_210_000 }],
]);
for (const lease of leases) {
  const payments = await checked(supabase.from("payments").select("source_type, payment_date, amount, receipt_no, notes").eq("source_id", lease.id).in("source_type", ["lease_rent", "lease_deposit", "property_fee"]).order("payment_date"), `load income payments ${lease.contract_no}`);
  const expected = expectations.get(lease.id);
  if (payments.length !== expected.count || payments.reduce((sum, payment) => sum + Number(payment.amount), 0) !== expected.total_xof) throw new Error(`${lease.contract_no}: unexpected income payments`);
  for (const payment of payments) {
    const category = categoryFor(payment.source_type);
    const rows = await checked(supabase.from("receivables").select("id").eq("source_id", lease.id).eq("category", category).eq("due_date", payment.payment_date).eq("amount_xof", Number(payment.amount)), `find receivable ${payment.receipt_no}`);
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

const sale = await checked(supabase.from("sale_contracts").select("id, total_amount_xof").eq("unit_id", unit.id).single(), "load 511 sale");
const salePayments = await checked(supabase.from("payments").select("amount").eq("source_id", sale.id).eq("source_type", "sale_contract"), "load 511 sale payments");
const saleReceivables = await checked(supabase.from("receivables").select("amount_xof").eq("source_id", sale.id).neq("status", "cancelled"), "load 511 sale receivables");
if (Number(sale.total_amount_xof) !== 60_000_000 || salePayments.length !== 1 || Number(salePayments[0].amount) !== 60_000_000 || saleReceivables.length !== 1 || Number(saleReceivables[0].amount_xof) !== 60_000_000) throw new Error("Unexpected 511 sale records");

await checked(supabase.from("units").update({ notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u4e70\u65b9\u6e38\u8fdb\u3001\u6bb7\u7b11\u82b8\uff0c\u623f\u6b3e6000\u4e07\u4e8e2026-06-12\u5df2\u7ed3\u6e05\uff1b\u66fe\u6cd3\u7b562026-03-14\u9000\u623f\uff0c\u62bc\u91d1\u548c\u7ef4\u4fee\u8d39\u5df2\u6e05\uff0c\u4f46\u5b9e\u9645\u9000\u6b3e\u4e0e\u7ef4\u4fee\u6263\u6b3e\u672a\u62c6\u5206\uff1b\u6797\u8363\u4fe42\u5f53\u524d\u5728\u79df\u5e76\u5df2\u7f34\u81f32026-09-30\u3002" }).eq("id", unit.id), "update 511 notes");
await checked(supabase.from("audit_logs").insert({ action: "rereview_unit_data", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI4", unit_no: "511", zeng_income_payment_count: 15, zeng_deposit_liability_closed_xof: 1_000_000, zeng_deposit_cash_refund_unconfirmed: true, active_tenant: "Lin Rongdi", paid_through: "2026-09-30", tenant_name_corrected: true, sale_paid_xof: 60_000_000, receivables_rebuilt_per_payment: true } }), "write audit");

console.log(JSON.stringify({ ok: true, unit: "511", active_tenant: "\u6797\u8363\u4fe42", paid_through: "2026-09-30", zeng_receivables: 15, sale_paid_xof: 60_000_000 }));
