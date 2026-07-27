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
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "611").single(), "load 611");
const leases = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id), "load 611 leases");
if (leases.length !== 0) throw new Error(`Unexpected 611 lease count: ${leases.length}`);
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).single(), "load 611 sale");
if (Number(sale.total_amount_xof) !== 70_300_000) throw new Error("Unexpected 611 sale total");
const buyer = await checked(supabase.from("customers").select("name").eq("id", sale.customer_id).single(), "load 611 buyer");
if (buyer.name !== "AYA ROSEMONDE") throw new Error(`Unexpected 611 buyer: ${buyer.name}`);

const housePayments = await checked(supabase.from("payments").select("source_type, payment_date, amount, receipt_no, notes, created_at").eq("source_id", sale.id).eq("source_type", "sale_contract").order("payment_date").order("created_at"), "load 611 house payments");
if (housePayments.length !== 23 || housePayments.reduce((sum, payment) => sum + Number(payment.amount), 0) !== 70_300_000) throw new Error("Unexpected 611 house payments");
const normalized = housePayments.filter((payment) => payment.payment_date === "2022-06-22" && Number(payment.amount) === 3_280_000);
if (normalized.length !== 1 || !normalized[0].notes.includes("327.98")) throw new Error("Missing documented 611 normalization");
if (housePayments.filter((payment) => payment.payment_date === "2022-06-07").length !== 2 || housePayments.filter((payment) => payment.payment_date === "2022-06-22").length !== 2) throw new Error("Unexpected 611 same-day payment groups");

const combined = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum").eq("amount_xof", 70_300_000), "find combined 611 receivable");
if (combined.length > 1) throw new Error("Duplicate combined 611 receivable");
for (let index = 0; index < housePayments.length; index += 1) {
  const payment = housePayments[index];
  const amount = Number(payment.amount);
  const rows = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum").eq("due_date", payment.payment_date).eq("amount_xof", amount), `find receivable ${payment.receipt_no}`);
  if (rows.length > 1) throw new Error(`Duplicate receivable ${payment.receipt_no}`);
  const payload = {
    building_id: building.id,
    unit_id: unit.id,
    customer_id: sale.customer_id,
    source_type: "sale_contract",
    source_id: sale.id,
    category: "sale_lump_sum",
    title: "4# 611购房款",
    due_date: payment.payment_date,
    amount_xof: amount,
    paid_amount_xof: amount,
    status: "paid",
    currency: "XOF",
    notes: `${payment.notes}\n收据号：${payment.receipt_no}`,
  };
  if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update receivable ${payment.receipt_no}`);
  else if (index === 0 && combined.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", combined[0].id), "split combined 611 receivable");
  else await checked(supabase.from("receivables").insert(payload), `insert receivable ${payment.receipt_no}`);
}

let refunds = await checked(supabase.from("payments").select("id, payment_date, amount, receipt_no, notes, created_at").eq("source_id", sale.id).eq("source_type", "sale_other_expense").order("created_at"), "load 611 furniture refunds");
if (refunds.length < 1 || refunds.length > 2 || refunds.some((refund) => refund.payment_date !== "2022-08-17" || Number(refund.amount) !== 200_000)) throw new Error("Unexpected 611 furniture refunds");
let removedDuplicateReceipt = null;
if (refunds.length === 2) {
  if (refunds[0].receipt_no !== "WB4-SALE-611-20220817-FURNREF-23" || refunds[1].receipt_no !== "WB4-SALE-611-20220817-FURNREF-24") throw new Error("Unexpected 611 duplicate refund receipts");
  const duplicate = refunds[1];
  const duplicateLedgers = await checked(supabase.from("ledger_entries").select("id, direction, category, amount_xof").eq("payment_id", duplicate.id), "load duplicate 611 refund ledger");
  if (duplicateLedgers.length !== 1 || duplicateLedgers[0].direction !== "expense" || duplicateLedgers[0].category !== "sale_furniture_refund" || Number(duplicateLedgers[0].amount_xof) !== 200_000) throw new Error("Unexpected duplicate 611 refund ledger");
  await checked(supabase.from("ledger_entries").delete().eq("id", duplicateLedgers[0].id), "delete duplicate 611 refund ledger");
  await checked(supabase.from("payments").delete().eq("id", duplicate.id), "delete duplicate 611 refund payment");
  removedDuplicateReceipt = duplicate.receipt_no;
}
refunds = await checked(supabase.from("payments").select("id, payment_date, amount, receipt_no").eq("source_id", sale.id).eq("source_type", "sale_other_expense"), "verify 611 furniture refund");
if (refunds.length !== 1 || refunds[0].receipt_no !== "WB4-SALE-611-20220817-FURNREF-23" || Number(refunds[0].amount) !== 200_000) throw new Error("611 furniture refund was not deduplicated");
const refundLedgers = await checked(supabase.from("ledger_entries").select("direction, category, amount_xof").eq("payment_id", refunds[0].id), "verify retained 611 refund ledger");
if (refundLedgers.length !== 1 || refundLedgers[0].direction !== "expense" || refundLedgers[0].category !== "sale_furniture_refund" || Number(refundLedgers[0].amount_xof) !== 200_000) throw new Error("Unexpected retained 611 refund ledger");

const receivables = await checked(supabase.from("receivables").select("amount_xof, paid_amount_xof, status").eq("source_id", sale.id).neq("status", "cancelled"), "verify 611 receivables");
if (receivables.length !== 23 || receivables.reduce((sum, row) => sum + Number(row.amount_xof), 0) !== 70_300_000 || receivables.some((row) => row.status !== "paid" || Number(row.amount_xof) !== Number(row.paid_amount_xof))) throw new Error("Unexpected 611 receivables");
const refundReceivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("amount_xof", 200_000), "verify no 611 refund receivable");
if (refundReceivables.length !== 0) throw new Error("611 furniture refund must not create a receivable");

await checked(supabase.from("sale_contracts").update({ payment_plan_type: "来源：4号公寓.xlsx；房款7030万分23笔支付并已结清；Excel末笔记327.98万，逐笔原数合计比合同少200 XOF，按合同总额归一为328万。" }).eq("id", sale.id), "update 611 sale notes");
await checked(supabase.from("units").update({ notes: "来源：4号公寓.xlsx；买方AYA ROSEMONDE，房款7030万分23笔支付并已结清；2022-06-07两笔250万、160万分别列示，2022-06-22两笔156.9万、328万分别列示；Excel末笔原记327.98万，逐笔原数合计比合同少200 XOF，按合同总额归一为328万；2022-08-17退衣柜费20万仅保留一笔并单列支出；无租赁或代租记录。" }).eq("id", unit.id), "update 611 notes");
await checked(supabase.from("audit_logs").insert({ action: "rereview_unit_data", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI4", unit_no: "611", buyer: "AYA ROSEMONDE", lease_count: 0, sale_paid_xof: 70_300_000, sale_payment_count: 23, excel_raw_total_xof: 70_299_800, normalization_xof: 200, furniture_refund_xof: 200_000, duplicate_refund_removed: Boolean(removedDuplicateReceipt), removed_duplicate_receipt: removedDuplicateReceipt, receivables_rebuilt_per_payment: true } }), "write audit");

console.log(JSON.stringify({ ok: true, unit: "611", sale_paid_xof: 70_300_000, sale_payments: housePayments.length, receivables: receivables.length, furniture_refund_xof: 200_000, removed_duplicate_receipt: removedDuplicateReceipt }));
