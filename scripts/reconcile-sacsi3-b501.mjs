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

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI3").single(), "load building");
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "B501").single(), "load B501");
if (Number(unit.area_sqm) !== 173.51) throw new Error(`Unexpected B501 area: ${unit.area_sqm}`);
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).eq("status", "active").single(), "load B501 sale");
if (Number(sale.total_amount_xof) !== 160_000_000) throw new Error(`Unexpected B501 total: ${sale.total_amount_xof}`);
const customer = await checked(supabase.from("customers").select("id, name").eq("id", sale.customer_id).single(), "load B501 buyer");
if (customer.name !== "付丽") throw new Error(`Unexpected B501 buyer: ${customer.name}`);

const notes = "来源：3号公寓.xlsx；B501买方付丽；合同总价16000万FCFA；2022-03-26一次性支付16000万，已结清；Excel原注‘高总的房子不用报账’，2026-07-27用户确认仍按正常购房款收入统计。Excel未记税款或FULO提成，过户状态不推断。";
await checked(supabase.from("sale_contracts").update({
  signed_date: "2022-03-26",
  payment_plan_type: "lump_sum",
  agency_company: null,
  agency_commission_amount_xof: null,
  agency_commission_paid: false,
}).eq("id", sale.id), "update B501 sale");
await checked(supabase.from("units").update({ status: "sold", notes }).eq("id", unit.id), "update B501 unit");

const receiptNo = "WB3-SALE-B501-20220326-HOUSE-01";
let payments = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", receiptNo), "find B501 payment");
if (!payments.length) payments = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", "S3-SALE-B501-CONSOLIDATED"), "find B501 legacy payment");
if (payments.length !== 1) throw new Error("Unexpected B501 payment count");
const paymentId = payments[0].id;
await checked(supabase.from("payments").update({ customer_id: customer.id, unit_id: unit.id, source_type: "sale_contract", source_id: sale.id, payment_date: "2022-03-26", amount: 160_000_000, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes }).eq("id", paymentId), "update B501 payment");
const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), "find B501 ledger");
if (ledgers.length > 1) throw new Error("Duplicate B501 ledger");
const ledger = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: "2022-03-26", direction: "income", category: "sale", amount_xof: 160_000_000, amount_cny: null, description: notes };
if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), "update B501 ledger");
else await checked(supabase.from("ledger_entries").insert(ledger), "insert B501 ledger");

const receivable = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).neq("status", "cancelled").single(), "load B501 receivable");
await checked(supabase.from("receivables").update({ category: "sale_lump_sum", title: "3# B501购房款", due_date: "2022-03-26", amount_xof: 160_000_000, paid_amount_xof: 160_000_000, status: "paid", currency: "XOF", notes }).eq("id", receivable.id), "update B501 receivable");

const verified = await checked(supabase.from("payments").select("source_type, amount").eq("source_id", sale.id), "verify B501 payment");
if (verified.length !== 1 || verified[0].source_type !== "sale_contract" || Number(verified[0].amount) !== 160_000_000) throw new Error("Unexpected verified B501 payment");
await checked(supabase.from("audit_logs").insert({
  action: "reconcile_sacsi3_b501",
  entity_type: "sale_contract",
  entity_id: sale.id,
  metadata: { building_code: "SACSI3", unit_no: "B501", buyer: customer.name, total_xof: 160_000_000, payment: { date: "2022-03-26", amount_xof: 160_000_000 }, settled: true, workbook_note: "高总的房子不用报账", user_confirmed_normal_financial_reporting_on: "2026-07-27", included_in_financial_income: true, tax_missing: true, agency_missing: true, transfer_status_inferred: false },
}), "write B501 audit log");

console.log(JSON.stringify({ ok: true, unit: "B501", house_total_xof: 160_000_000, settled: true, included_in_financial_income: true }));
