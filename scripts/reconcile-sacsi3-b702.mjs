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
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "B702").single(), "load B702");
if (Number(unit.area_sqm) !== 54.99) throw new Error(`Unexpected B702 area: ${unit.area_sqm}`);
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).eq("status", "active").single(), "load B702 sale");
if (Number(sale.total_amount_xof) !== 50_000_000) throw new Error(`Unexpected B702 total: ${sale.total_amount_xof}`);
const customer = await checked(supabase.from("customers").select("id, name").eq("id", sale.customer_id).single(), "load B702 buyer");
if (customer.name !== "MAROTTA") throw new Error(`Unexpected B702 buyer: ${customer.name}`);

const houseNotes = "来源：3号公寓.xlsx；B702买方MAROTTA；合同总价5000万FCFA；2020-07-08支票一次性支付5000万，已结清。";
const taxNotes = "来源：3号公寓.xlsx；B702于2020-09-22实际收税款150万FCFA；该款后续内部转入B602房款，B602不重复统计新增收入；按Excel实际金额登记，不另行计算差额，不计入B702合同总价。";
const misplacedNotes = "Excel B702行另写‘2023-12-04付2000万现金’，用户确认属于B701错位记录；B701已登记该笔，B702不重复入账。";
await checked(supabase.from("sale_contracts").update({ signed_date: "2020-07-08", payment_plan_type: "lump_sum", agency_company: "FULO", agency_commission_amount_xof: null, agency_commission_paid: true }).eq("id", sale.id), "update B702 sale");
await checked(supabase.from("units").update({ status: "sold", notes: `${houseNotes}\n${taxNotes}\nFULO提成于2020-11-12支付，金额待补。\n${misplacedNotes}\n过户状态不推断。` }).eq("id", unit.id), "update B702 unit");

async function upsertPayment({ receiptNo, legacyReceiptNo, date, amount, sourceType, direction, category, notes }) {
  let rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (!rows.length && legacyReceiptNo) rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", legacyReceiptNo), `find ${legacyReceiptNo}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const payload = { customer_id: customer.id, unit_id: unit.id, source_type: sourceType, source_id: sale.id, payment_date: date, amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
  const paymentId = rows.length
    ? (await checked(supabase.from("payments").update(payload).eq("id", rows[0].id).select("id").single(), `update ${receiptNo}`)).id
    : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledger = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: date, direction, category, amount_xof: amount, amount_cny: null, description: notes };
  if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), `update ledger ${receiptNo}`);
  else await checked(supabase.from("ledger_entries").insert(ledger), `insert ledger ${receiptNo}`);
}

await upsertPayment({ receiptNo: "WB3-SALE-702-20200708-HOUSE-01", legacyReceiptNo: "S3-SALE-B702-CONSOLIDATED", date: "2020-07-08", amount: 50_000_000, sourceType: "sale_contract", direction: "income", category: "sale", notes: houseNotes });
await upsertPayment({ receiptNo: "WB3-SALE-702-20200922-TRANSFER-TAX-01", date: "2020-09-22", amount: 1_500_000, sourceType: "sale_other_income", direction: "income", category: "sale_transfer_tax", notes: taxNotes });

const receivable = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).neq("status", "cancelled").single(), "load B702 receivable");
await checked(supabase.from("receivables").update({ category: "sale_lump_sum", title: "3# B702购房款", due_date: "2020-07-08", amount_xof: 50_000_000, paid_amount_xof: 50_000_000, status: "paid", currency: "XOF", notes: houseNotes }).eq("id", receivable.id), "update B702 receivable");

const verified = await checked(supabase.from("payments").select("source_type, payment_date, amount").eq("source_id", sale.id), "verify B702 payments");
const houseTotal = verified.filter((row) => row.source_type === "sale_contract").reduce((sum, row) => sum + Number(row.amount), 0);
const taxTotal = verified.filter((row) => row.source_type === "sale_other_income").reduce((sum, row) => sum + Number(row.amount), 0);
if (verified.length !== 2 || houseTotal !== 50_000_000 || taxTotal !== 1_500_000 || verified.some((row) => row.payment_date === "2023-12-04")) throw new Error("Unexpected B702 payment state");
await checked(supabase.from("audit_logs").insert({ action: "reconcile_sacsi3_b702", entity_type: "sale_contract", entity_id: sale.id, metadata: { building_code: "SACSI3", unit_no: "B702", buyer: "MAROTTA", total_xof: 50_000_000, house_payment: { date: "2020-07-08", amount_xof: 50_000_000, method: "check" }, settled: true, transfer_tax: { date: "2020-09-22", actual_amount_xof: 1_500_000, subsequently_allocated_to: "SACSI3-B602", counted_as_new_income_at_B602: false }, agency: { company: "FULO", paid_date: "2020-11-12", amount_pending: true }, misplaced_entry: { workbook_row_unit: "B702", date: "2023-12-04", amount_xof: 20_000_000, confirmed_actual_unit: "B701", recorded_at_B702: false }, transfer_status_inferred: false } }), "write B702 audit log");

console.log(JSON.stringify({ ok: true, unit: "B702", house_total_xof: 50_000_000, actual_transfer_tax_xof: 1_500_000, misplaced_payment_ignored: true, settled: true }));
