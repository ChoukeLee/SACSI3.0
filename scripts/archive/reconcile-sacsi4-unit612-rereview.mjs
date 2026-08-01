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
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "612").single(), "load 612");
const leases = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id), "load 612 leases");
if (leases.length !== 0) throw new Error(`Unexpected 612 lease count: ${leases.length}`);
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof, agency_commission_amount_xof, agency_commission_paid").eq("unit_id", unit.id).single(), "load 612 sale");
if (Number(sale.total_amount_xof) !== 88_000_000 || Number(sale.agency_commission_amount_xof) !== 2_000_000 || !sale.agency_commission_paid) throw new Error("Unexpected 612 sale contract");
const buyer = await checked(supabase.from("customers").select("name").eq("id", sale.customer_id).single(), "load 612 buyer");
if (buyer.name !== "YDO YAO") throw new Error(`Unexpected 612 buyer: ${buyer.name}`);

const existingPayments = await checked(supabase.from("payments").select("id, source_type, payment_date, amount, receipt_no, notes").eq("source_id", sale.id).order("payment_date"), "load 612 payments");
const registration = existingPayments.find((payment) => payment.source_type === "sale_registration_fee");
const house = existingPayments.find((payment) => payment.source_type === "sale_contract");
const agencyExpense = existingPayments.find((payment) => payment.source_type === "sale_agency_expense");
const furniture = existingPayments.find((payment) => payment.source_type === "sale_other_income" && Number(payment.amount) === 300_000);
if (!registration || registration.payment_date !== "2020-12-30" || Number(registration.amount) !== 250_000) throw new Error("Unexpected 612 registration payment");
if (!house || house.payment_date !== "2020-12-31" || Number(house.amount) !== 88_000_000) throw new Error("Unexpected 612 house payment");
if (!agencyExpense || agencyExpense.payment_date !== "2021-01-14" || Number(agencyExpense.amount) !== 2_000_000) throw new Error("Unexpected 612 agency expense");
if (!furniture || furniture.payment_date !== "2022-08-10" || Number(furniture.amount) !== 300_000) throw new Error("Unexpected 612 furniture payment");
const unexpected = existingPayments.filter((payment) => ![registration.id, house.id, agencyExpense.id, furniture.id].includes(payment.id) && payment.receipt_no !== "WB4-SALE-612-20201231-AGENCYFUNDS-02A");
if (unexpected.length !== 0) throw new Error(`Unexpected extra 612 payments: ${unexpected.map((payment) => payment.receipt_no).join(", ")}`);

const agencyFundsReceipt = "WB4-SALE-612-20201231-AGENCYFUNDS-02A";
const agencyFundsNotes = "612于2020-12-31实收9000万，其中房款8800万、中介费代收资金200万；该200万于2021-01-14支付中介，不计入8800万合同房价。";
const agencyFundsRows = await checked(supabase.from("payments").select("id").eq("source_id", sale.id).eq("receipt_no", agencyFundsReceipt), "find 612 agency funds payment");
if (agencyFundsRows.length > 1) throw new Error("Duplicate 612 agency funds payment");
const agencyFundsPayload = {
  customer_id: sale.customer_id,
  unit_id: unit.id,
  source_type: "sale_other_income",
  source_id: sale.id,
  payment_date: "2020-12-31",
  amount: 2_000_000,
  currency: "XOF",
  exchange_rate_to_xof: 1,
  receipt_no: agencyFundsReceipt,
  notes: agencyFundsNotes,
};
let agencyFundsId;
if (agencyFundsRows.length === 1) {
  agencyFundsId = agencyFundsRows[0].id;
  await checked(supabase.from("payments").update(agencyFundsPayload).eq("id", agencyFundsId), "update 612 agency funds payment");
} else {
  agencyFundsId = (await checked(supabase.from("payments").insert(agencyFundsPayload).select("id").single(), "insert 612 agency funds payment")).id;
}
const agencyFundsLedger = { building_id: building.id, unit_id: unit.id, payment_id: agencyFundsId, entry_date: "2020-12-31", direction: "liability_in", category: "sale_agency_funds", amount_xof: 2_000_000, amount_cny: null, description: agencyFundsNotes };
const agencyFundsLedgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", agencyFundsId), "find 612 agency funds ledger");
if (agencyFundsLedgers.length > 1) throw new Error("Duplicate 612 agency funds ledger");
if (agencyFundsLedgers.length === 1) await checked(supabase.from("ledger_entries").update(agencyFundsLedger).eq("id", agencyFundsLedgers[0].id), "update 612 agency funds ledger");
else await checked(supabase.from("ledger_entries").insert(agencyFundsLedger), "insert 612 agency funds ledger");

const specs = [
  { payment: registration, category: "other", title: "612注册金" },
  { payment: house, category: "sale_lump_sum", title: "4# 612购房款" },
  { payment: { ...agencyFundsPayload, id: agencyFundsId }, category: "other", title: "612中介费代收资金" },
  { payment: furniture, category: "other", title: "612衣柜款" },
];
for (const spec of specs) {
  const payment = spec.payment;
  const rows = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", spec.category).eq("amount_xof", Number(payment.amount)), `find receivable ${payment.receipt_no}`);
  if (rows.length > 1) throw new Error(`Duplicate receivable ${payment.receipt_no}`);
  const payload = {
    building_id: building.id,
    unit_id: unit.id,
    customer_id: sale.customer_id,
    source_type: "sale_contract",
    source_id: sale.id,
    category: spec.category,
    title: spec.title,
    due_date: payment.payment_date,
    amount_xof: Number(payment.amount),
    paid_amount_xof: Number(payment.amount),
    status: "paid",
    currency: "XOF",
    notes: `${payment.notes}\n收据号：${payment.receipt_no}`,
  };
  if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update receivable ${payment.receipt_no}`);
  else await checked(supabase.from("receivables").insert(payload), `insert receivable ${payment.receipt_no}`);
}

const receivables = await checked(supabase.from("receivables").select("amount_xof, paid_amount_xof, status").eq("source_id", sale.id).neq("status", "cancelled"), "verify 612 receivables");
if (receivables.length !== 4 || receivables.reduce((sum, row) => sum + Number(row.amount_xof), 0) !== 90_550_000 || receivables.some((row) => row.status !== "paid" || Number(row.amount_xof) !== Number(row.paid_amount_xof))) throw new Error("Unexpected 612 receivables");
const agencyExpenseReceivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("amount_xof", 2_000_000), "verify 612 agency receivable count");
if (agencyExpenseReceivables.length !== 1) throw new Error("612 must have one 2m agency-funds receivable and no expense receivable");
const agencyExpenseLedgers = await checked(supabase.from("ledger_entries").select("direction, category, amount_xof").eq("payment_id", agencyExpense.id), "verify 612 agency expense ledger");
if (agencyExpenseLedgers.length !== 1 || agencyExpenseLedgers[0].direction !== "expense" || Number(agencyExpenseLedgers[0].amount_xof) !== 2_000_000) throw new Error("Unexpected 612 agency expense ledger");

await checked(supabase.from("sale_contracts").update({ payment_plan_type: "来源：4号公寓.xlsx；2020-12-31实收9000万，拆为房款8800万和中介费代收资金200万；房款已结清；2021-01-14支付中介费200万。" }).eq("id", sale.id), "update 612 sale notes");
await checked(supabase.from("units").update({ notes: "来源：4号公寓.xlsx；买方YDO YAO；2020-12-30注册金25万单列；2020-12-31实收9000万，拆为房款8800万和中介费代收资金200万，房款已结清；2021-01-14支付中介费200万单列支出，与代收资金闭环；2022-08-10衣柜款30万单列；合同房价仍为8800万；无租赁或代租记录。" }).eq("id", unit.id), "update 612 notes");
await checked(supabase.from("audit_logs").insert({ action: "rereview_unit_data", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI4", unit_no: "612", buyer: "YDO YAO", lease_count: 0, gross_receipt_2020_12_31_xof: 90_000_000, sale_paid_xof: 88_000_000, agency_funds_received_xof: 2_000_000, agency_expense_xof: 2_000_000, registration_xof: 250_000, furniture_income_xof: 300_000, receivable_total_xof: 90_550_000, receivables_rebuilt_per_payment: true } }), "write audit");

console.log(JSON.stringify({ ok: true, unit: "612", contract_total_xof: 88_000_000, gross_receipt_xof: 90_000_000, agency_funds_in_xof: 2_000_000, agency_expense_xof: 2_000_000, receivables: receivables.length, receivable_total_xof: 90_550_000 }));
