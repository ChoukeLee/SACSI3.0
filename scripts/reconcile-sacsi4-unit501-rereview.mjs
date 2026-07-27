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
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "501").single(), "load 501");
const leases = await checked(supabase.from("lease_contracts").select("id, contract_no, customer_id").eq("unit_id", unit.id), "load 501 leases");
const leaseByNo = Object.fromEntries(leases.map((lease) => [lease.contract_no, lease]));
const hu = leaseByNo["WB-LEASE-SACSI4-501-20240911-HU"];
const gong = leaseByNo["WB-LEASE-SACSI4-501-20240311-GONG"];
if (!hu || !gong || leases.length !== 3) throw new Error(`Unexpected 501 leases: ${leases.length}`);

await checked(supabase.from("lease_contracts").update({
  status: "active",
  actual_end_date: null,
  expected_end_confirmed: false,
  paid_through_date: "2026-07-09",
}).eq("id", hu.id), "restore Hu lease");

const deduction = await checked(supabase.from("payments").select("id").eq("source_id", gong.id).eq("source_type", "lease_deposit_deduction").eq("amount", 53_000).single(), "load Gong deduction");
const deductionNotes = "501\u9f9a\u5c11\u534e\u62bc\u91d1100\u4e07\u5b9e\u900094.7\u4e07\uff0c\u5dee\u989d5.3\u4e07\u6309\u62bc\u91d1\u6263\u6b3e\u5904\u7406\uff1b\u7528\u6237\u5df2\u786e\u8ba4\u3002";
await checked(supabase.from("payments").update({ notes: deductionNotes }).eq("id", deduction.id), "confirm Gong deduction");
await checked(supabase.from("ledger_entries").update({ description: deductionNotes }).eq("payment_id", deduction.id), "update Gong deduction ledger");

function categoryFor(sourceType) {
  if (sourceType === "lease_rent") return "lease_rent";
  if (sourceType === "lease_deposit") return "lease_deposit";
  return "other";
}
function titleFor(sourceType) {
  if (sourceType === "lease_rent") return "501\u79df\u91d1";
  if (sourceType === "lease_deposit") return "501\u62bc\u91d1";
  if (sourceType === "property_fee") return "501\u7269\u4e1a\u8d39";
  return "501\u5176\u4ed6\u6536\u5165";
}

const incomeTypes = ["lease_rent", "lease_deposit", "property_fee", "lease_other_income", "lease_agency_income", "lease_furniture_income"];
for (const lease of leases) {
  const payments = await checked(supabase.from("payments").select("id, source_type, payment_date, amount, currency, exchange_rate_to_xof, receipt_no, notes").eq("source_id", lease.id).in("source_type", incomeTypes).order("payment_date"), `load payments ${lease.contract_no}`);
  for (const payment of payments) {
    const amountXof = payment.currency === "XOF" ? Number(payment.amount) : Math.round(Number(payment.amount) * Number(payment.exchange_rate_to_xof));
    const category = categoryFor(payment.source_type);
    const rows = await checked(supabase.from("receivables").select("id").eq("source_id", lease.id).eq("category", category).eq("due_date", payment.payment_date).eq("amount_xof", amountXof), `find receivable ${payment.receipt_no}`);
    if (rows.length > 1) throw new Error(`Duplicate receivable ${payment.receipt_no}`);
    const notes = `${payment.notes}\n\u6536\u636e\u53f7\uff1a${payment.receipt_no}`;
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
      notes,
    };
    if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update receivable ${payment.receipt_no}`);
    else await checked(supabase.from("receivables").insert(payload), `insert receivable ${payment.receipt_no}`);
  }
  const receivables = await checked(supabase.from("receivables").select("id").eq("source_id", lease.id).neq("status", "cancelled"), `verify receivables ${lease.contract_no}`);
  if (receivables.length !== payments.length) throw new Error(`${lease.contract_no}: ${payments.length} income payments but ${receivables.length} receivables`);
}

await checked(supabase.from("units").update({ notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u4e70\u65b9\u4e07\u6881\u3001\u5f20\u536b\u840d\uff0c\u623f\u6b3e6000\u4e07\u5df2\u7ed3\u6e05\uff1b\u80e1\u5efa\u521d\u5f53\u524d\u4ecd\u5728\u79df\uff0c\u5df2\u7f34\u81f32026-07-09\uff0c\u7eed\u8d39\u5f85\u6536\u3002" }).eq("id", unit.id), "update unit notes");
await checked(supabase.from("audit_logs").insert({ action: "rereview_unit_data", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI4", unit_no: "501", hu_lease_active: true, hu_paid_through: "2026-07-09", gong_deposit_deduction_xof: 53_000, receivables_rebuilt_per_payment: true } }), "write audit");
console.log(JSON.stringify({ ok: true, unit: "501", active_tenant: "\u80e1\u5efa\u521d", paid_through: "2026-07-09", gong_deposit_deduction_xof: 53_000 }));
