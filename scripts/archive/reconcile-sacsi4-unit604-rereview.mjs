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
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "604").single(), "load 604");
const leases = await checked(supabase.from("lease_contracts").select("id, contract_no, customer_id, signer_name").eq("unit_id", unit.id), "load 604 leases");
if (leases.length !== 1 || leases[0].contract_no !== "WB-LEASE-SACSI4-604-20211015-LILANXIN" || leases[0].signer_name !== "李兰馨") throw new Error("Unexpected 604 lease");
const lease = leases[0];
await checked(supabase.from("lease_contracts").update({
  status: "terminated",
  actual_end_date: "2022-12-14",
  expected_end_date: "2022-12-14",
  expected_end_confirmed: true,
}).eq("id", lease.id), "confirm 604 lease");

const unresolvedDepositNotes = "604李兰馨押金120万；Excel未记载退还、扣款或转入其他合同，处置待核实。";
const depositRows = await checked(supabase.from("payments").select("id").eq("source_id", lease.id).eq("source_type", "lease_deposit").eq("payment_date", "2021-10-06").eq("amount", 1_200_000), "find 604 deposit");
if (depositRows.length !== 1) throw new Error(`Expected one 604 deposit, got ${depositRows.length}`);
await checked(supabase.from("payments").update({ notes: unresolvedDepositNotes }).eq("id", depositRows[0].id), "mark 604 deposit unresolved");
await checked(supabase.from("ledger_entries").update({ description: unresolvedDepositNotes }).eq("payment_id", depositRows[0].id), "mark 604 deposit ledger unresolved");

function categoryFor(sourceType) {
  if (sourceType === "lease_rent") return "lease_rent";
  if (sourceType === "lease_deposit") return "lease_deposit";
  return "other";
}
function titleFor(sourceType) {
  if (sourceType === "lease_rent") return "604租金";
  if (sourceType === "lease_deposit") return "604押金";
  if (sourceType === "property_fee") return "604物业费";
  return "604其他租赁收入";
}

const leasePayments = await checked(supabase.from("payments").select("source_type, payment_date, amount, currency, exchange_rate_to_xof, receipt_no, notes").eq("source_id", lease.id).in("source_type", ["lease_rent", "lease_deposit", "property_fee", "lease_agency_income", "lease_other_income"]).order("payment_date"), "load 604 lease income");
if (leasePayments.length !== 7 || leasePayments.reduce((sum, payment) => sum + Math.round(Number(payment.amount) * Number(payment.exchange_rate_to_xof)), 0) !== 10_160_000) throw new Error("Unexpected 604 lease income");
for (const payment of leasePayments) {
  const amountXof = Math.round(Number(payment.amount) * Number(payment.exchange_rate_to_xof));
  const category = categoryFor(payment.source_type);
  const rows = await checked(supabase.from("receivables").select("id").eq("source_id", lease.id).eq("category", category).eq("due_date", payment.payment_date).eq("amount_xof", amountXof), `find receivable ${payment.receipt_no}`);
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
    amount_xof: amountXof,
    paid_amount_xof: amountXof,
    status: "paid",
    currency: "XOF",
    notes: `${payment.notes}\n收据号：${payment.receipt_no}`,
  };
  if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update receivable ${payment.receipt_no}`);
  else await checked(supabase.from("receivables").insert(payload), `insert receivable ${payment.receipt_no}`);
}

const leaseReceivables = await checked(supabase.from("receivables").select("id").eq("source_id", lease.id).neq("status", "cancelled"), "verify 604 lease receivables");
if (leaseReceivables.length !== 7) throw new Error(`Unexpected 604 lease receivable count: ${leaseReceivables.length}`);
const depositCloseout = await checked(supabase.from("payments").select("id").eq("source_id", lease.id).in("source_type", ["lease_deposit_refund", "lease_deposit_deduction"]), "load 604 deposit closeout");
if (depositCloseout.length !== 0) throw new Error("Unexpected 604 deposit closeout");

const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).single(), "load 604 sale");
if (Number(sale.total_amount_xof) !== 95_000_000) throw new Error("Unexpected 604 sale total");
const buyer = await checked(supabase.from("customers").select("name").eq("id", sale.customer_id).single(), "load 604 buyer");
if (buyer.name !== "DIALLO THIERNO") throw new Error(`Unexpected 604 buyer: ${buyer.name}`);
const salePayments = await checked(supabase.from("payments").select("source_type, payment_date, amount, receipt_no, notes").eq("source_id", sale.id).order("payment_date"), "load 604 sale payments");
if (salePayments.length !== 4) throw new Error(`Unexpected 604 sale payment count: ${salePayments.length}`);
const housePayments = salePayments.filter((payment) => payment.source_type === "sale_contract");
const registration = salePayments.find((payment) => payment.source_type === "sale_registration_fee");
const furnitureRefund = salePayments.find((payment) => payment.source_type === "sale_other_expense");
if (housePayments.length !== 2 || housePayments.reduce((sum, payment) => sum + Number(payment.amount), 0) !== 95_000_000 || !housePayments.some((payment) => payment.payment_date === "2023-04-01" && Number(payment.amount) === 9_500_000) || !housePayments.some((payment) => payment.payment_date === "2023-12-22" && Number(payment.amount) === 85_500_000)) throw new Error("Unexpected 604 house payments");
if (!registration || registration.payment_date !== "2022-09-14" || Number(registration.amount) !== 250_000) throw new Error("Unexpected 604 registration payment");
if (!furnitureRefund || furnitureRefund.payment_date !== "2024-01-25" || Number(furnitureRefund.amount) !== 300_000) throw new Error("Unexpected 604 furniture refund");

const combined = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum").eq("amount_xof", 95_000_000), "find combined 604 sale receivable");
if (combined.length > 1) throw new Error("Duplicate combined 604 sale receivable");
for (let index = 0; index < housePayments.length; index += 1) {
  const payment = housePayments[index];
  const rows = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum").eq("due_date", payment.payment_date).eq("amount_xof", Number(payment.amount)), `find house receivable ${payment.receipt_no}`);
  if (rows.length > 1) throw new Error(`Duplicate house receivable ${payment.receipt_no}`);
  const payload = {
    building_id: building.id,
    unit_id: unit.id,
    customer_id: sale.customer_id,
    source_type: "sale_contract",
    source_id: sale.id,
    category: "sale_lump_sum",
    title: "4# 604购房款",
    due_date: payment.payment_date,
    amount_xof: Number(payment.amount),
    paid_amount_xof: Number(payment.amount),
    status: "paid",
    currency: "XOF",
    notes: `${payment.notes}\n收据号：${payment.receipt_no}`,
  };
  if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update house receivable ${payment.receipt_no}`);
  else if (index === 0 && combined.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", combined[0].id), "split combined 604 house receivable");
  else await checked(supabase.from("receivables").insert(payload), `insert house receivable ${payment.receipt_no}`);
}

const registrationRows = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "other").eq("due_date", registration.payment_date).eq("amount_xof", 250_000), "find 604 registration receivable");
if (registrationRows.length > 1) throw new Error("Duplicate 604 registration receivable");
const registrationPayload = {
  building_id: building.id,
  unit_id: unit.id,
  customer_id: sale.customer_id,
  source_type: "sale_contract",
  source_id: sale.id,
  category: "other",
  title: "604注册金",
  due_date: registration.payment_date,
  amount_xof: 250_000,
  paid_amount_xof: 250_000,
  status: "paid",
  currency: "XOF",
  notes: `${registration.notes}\n收据号：${registration.receipt_no}`,
};
if (registrationRows.length === 1) await checked(supabase.from("receivables").update(registrationPayload).eq("id", registrationRows[0].id), "update 604 registration receivable");
else await checked(supabase.from("receivables").insert(registrationPayload), "insert 604 registration receivable");

const saleReceivables = await checked(supabase.from("receivables").select("amount_xof").eq("source_id", sale.id).neq("status", "cancelled"), "verify 604 sale receivables");
if (saleReceivables.length !== 3 || saleReceivables.reduce((sum, row) => sum + Number(row.amount_xof), 0) !== 95_250_000) throw new Error("Unexpected 604 sale receivables");
const refundReceivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("amount_xof", 300_000), "verify no refund receivable");
if (refundReceivables.length !== 0) throw new Error("604 furniture refund must not create a receivable");

await checked(supabase.from("sale_contracts").update({ payment_plan_type: "来源：4号公寓.xlsx；合同总价9500万，分950万和8550万两笔已结清；原表注‘需报8500万方可’，含义待核实，不据此改变合同总价。" }).eq("id", sale.id), "update 604 sale notes");
await checked(supabase.from("units").update({ notes: "来源：4号公寓.xlsx；李兰馨于2021-10-15至2022-12-14承租604，租金及物业费已按三期逐笔登记；押金120万未见退还、扣款或转入其他合同，处置待核实。买方DIALLO THIERNO，房款9500万分为950万和8550万两笔已结清；注册金25万于2022-09-14存入、2023-03-18入账并单列；原表注‘需报8500万方可’，含义待核实，不改变合同总价；2024-01-25退三个衣柜费30万单列支出。" }).eq("id", unit.id), "update 604 notes");
await checked(supabase.from("audit_logs").insert({ action: "rereview_unit_data", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI4", unit_no: "604", historical_tenant: "李兰馨", lease_income_payment_count: 7, lease_income_xof: 10_160_000, lease_receivables_rebuilt_per_payment: true, deposit_disposition: "pending_verification", sale_paid_xof: 95_000_000, sale_payment_count: 2, registration_xof: 250_000, registration_posted_date: "2023-03-18", furniture_refund_xof: 300_000, refund_receivable_created: false } }), "write audit");

console.log(JSON.stringify({ ok: true, unit: "604", lease_receivables: leaseReceivables.length, unresolved_deposit_xof: 1_200_000, sale_receivables: saleReceivables.length, furniture_refund_xof: 300_000 }));
