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
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "B703").single(), "load B703");
if (Number(unit.area_sqm) !== 115.44) throw new Error(`Unexpected B703 area: ${unit.area_sqm}`);
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).eq("status", "active").single(), "load B703 sale");
if (Number(sale.total_amount_xof) !== 107_000_000) throw new Error(`Unexpected B703 total: ${sale.total_amount_xof}`);
const customer = await checked(supabase.from("customers").select("id, name").eq("id", sale.customer_id).single(), "load B703 buyer");
if (customer.name !== "HENRY") throw new Error(`Unexpected B703 buyer: ${customer.name}`);

const eurAmount = 22_870;
const eurXof = 15_000_000;
const eurRate = eurXof / eurAmount;
const houseNotes = `来源：3号公寓.xlsx；B703买方HENRY；合同总价10700万FCFA；2021-02-04收现金1500万、支票3850万；2021-02-27收现金2000万、支票1850万，并以22870欧元兑换1500万FCFA；合计10700万，已结清；欧元隐含汇率${eurRate.toFixed(6)} FCFA/EUR。`;
const taxNotes = "来源：3号公寓.xlsx；B703于2021-03-02实际收税款321万FCFA；按Excel实际金额登记，不另行计算差额，不计入合同总价。";
await checked(supabase.from("sale_contracts").update({ signed_date: "2021-02-04", payment_plan_type: "installment", agency_company: "FULO", agency_commission_amount_xof: null, agency_commission_paid: true }).eq("id", sale.id), "update B703 sale");
await checked(supabase.from("units").update({ status: "sold", notes: `${houseNotes}\n${taxNotes}\nFULO提成于2021-04-07支付，金额待补；Excel未记注册金；过户状态不推断。` }).eq("id", unit.id), "update B703 unit");

async function upsertPayment({ receiptNo, legacyReceiptNo, date, amount, currency = "XOF", rate = 1, amountXof, sourceType, category, notes }) {
  let rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (!rows.length && legacyReceiptNo) rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", legacyReceiptNo), `find ${legacyReceiptNo}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const payload = { customer_id: customer.id, unit_id: unit.id, source_type: sourceType, source_id: sale.id, payment_date: date, amount, currency, exchange_rate_to_xof: rate, receipt_no: receiptNo, notes };
  const paymentId = rows.length
    ? (await checked(supabase.from("payments").update(payload).eq("id", rows[0].id).select("id").single(), `update ${receiptNo}`)).id
    : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledger = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: date, direction: "income", category, amount_xof: amountXof, amount_cny: null, description: notes };
  if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), `update ledger ${receiptNo}`);
  else await checked(supabase.from("ledger_entries").insert(ledger), `insert ledger ${receiptNo}`);
}

const housePayments = [
  { date: "2021-02-04", amount: 15_000_000, amountXof: 15_000_000, method: "现金" },
  { date: "2021-02-04", amount: 38_500_000, amountXof: 38_500_000, method: "支票" },
  { date: "2021-02-27", amount: 20_000_000, amountXof: 20_000_000, method: "现金" },
  { date: "2021-02-27", amount: 18_500_000, amountXof: 18_500_000, method: "支票" },
  { date: "2021-02-27", amount: eurXof, amountXof: eurXof, method: "22870欧元兑换" },
];
for (let index = 0; index < housePayments.length; index += 1) {
  const payment = housePayments[index];
  const original = index === 4 ? `${eurAmount} EUR，折合${payment.amountXof / 10_000}万FCFA，隐含汇率${eurRate.toFixed(6)} FCFA/EUR` : `${payment.amountXof / 10_000}万FCFA`;
  await upsertPayment({ receiptNo: `WB3-SALE-703-${payment.date.replaceAll("-", "")}-HOUSE-${String(index + 1).padStart(2, "0")}`, legacyReceiptNo: index === 0 ? "S3-SALE-B703-CONSOLIDATED" : null, date: payment.date, amount: payment.amount, currency: payment.currency, rate: payment.rate, amountXof: payment.amountXof, sourceType: "sale_contract", category: "sale", notes: `${houseNotes} 本笔${original}，方式：${payment.method}。` });
}
await upsertPayment({ receiptNo: "WB3-SALE-703-20210302-TRANSFER-TAX-01", date: "2021-03-02", amount: 3_210_000, amountXof: 3_210_000, sourceType: "sale_other_income", category: "sale_transfer_tax", notes: taxNotes });

const receivable = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).neq("status", "cancelled").single(), "load B703 receivable");
await checked(supabase.from("receivables").update({ category: "sale_installment", title: "3# B703购房款", due_date: "2021-02-27", amount_xof: 107_000_000, paid_amount_xof: 107_000_000, status: "paid", currency: "XOF", notes: houseNotes }).eq("id", receivable.id), "update B703 receivable");

const verified = await checked(supabase.from("payments").select("source_type, amount, currency, exchange_rate_to_xof").eq("source_id", sale.id), "verify B703 payments");
const houseRows = verified.filter((row) => row.source_type === "sale_contract");
const houseXof = houseRows.reduce((sum, row) => sum + Number(row.amount) * Number(row.exchange_rate_to_xof), 0);
const taxTotal = verified.filter((row) => row.source_type === "sale_other_income").reduce((sum, row) => sum + Number(row.amount), 0);
if (verified.length !== 6 || houseRows.length !== 5 || Math.abs(houseXof - 107_000_000) > 1 || taxTotal !== 3_210_000 || houseRows.some((row) => row.currency !== "XOF")) throw new Error("Unexpected B703 payment state");
await checked(supabase.from("audit_logs").insert({ action: "reconcile_sacsi3_b703", entity_type: "sale_contract", entity_id: sale.id, metadata: { building_code: "SACSI3", unit_no: "B703", buyer: "HENRY", total_xof: 107_000_000, house_payments: [{ date: "2021-02-04", amount_xof: 15_000_000, method: "cash" }, { date: "2021-02-04", amount_xof: 38_500_000, method: "check" }, { date: "2021-02-27", amount_xof: 20_000_000, method: "cash" }, { date: "2021-02-27", amount_xof: 18_500_000, method: "check" }, { date: "2021-02-27", amount_eur: eurAmount, exchange_rate_to_xof: eurRate, amount_xof: eurXof, method: "currency_exchange" }], settled: true, transfer_tax: { date: "2021-03-02", actual_amount_xof: 3_210_000, difference_tracking: false }, agency: { company: "FULO", paid_date: "2021-04-07", amount_pending: true }, registration_missing: true, transfer_status_inferred: false } }), "write B703 audit log");

console.log(JSON.stringify({ ok: true, unit: "B703", house_total_xof: 107_000_000, original_eur: eurAmount, eur_rate_to_xof: eurRate, actual_transfer_tax_xof: 3_210_000, settled: true }));
