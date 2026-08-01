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
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "602").single(), "load 602");
const leases = await checked(supabase.from("lease_contracts").select("id, contract_no, customer_id, signer_name").eq("unit_id", unit.id), "load 602 leases");
if (leases.length !== 1 || leases[0].contract_no !== "WB-LEASE-SACSI4-602-20221201" || leases[0].signer_name !== "SOADDA") throw new Error("Unexpected 602 lease");
const lease = leases[0];
await checked(supabase.from("lease_contracts").update({
  status: "terminated",
  actual_end_date: "2023-08-31",
  expected_end_date: "2023-08-31",
  expected_end_confirmed: true,
}).eq("id", lease.id), "confirm 602 lease");

const unresolvedDepositNotes = "602 SOADDA新租约押金100万；Excel未记载退还、扣款或转入房款，处置待核实。";
const unresolvedDepositRows = await checked(supabase.from("payments").select("id").eq("source_id", lease.id).eq("source_type", "lease_deposit").eq("payment_date", "2022-11-23").eq("amount", 1_000_000), "find unresolved deposit");
if (unresolvedDepositRows.length !== 1) throw new Error(`Expected one unresolved 602 deposit, got ${unresolvedDepositRows.length}`);
const unresolvedDepositId = unresolvedDepositRows[0].id;
await checked(supabase.from("payments").update({ notes: unresolvedDepositNotes }).eq("id", unresolvedDepositId), "mark deposit unresolved");
await checked(supabase.from("ledger_entries").update({ description: unresolvedDepositNotes }).eq("payment_id", unresolvedDepositId), "mark deposit ledger unresolved");

function categoryFor(sourceType) {
  if (sourceType === "lease_rent") return "lease_rent";
  if (sourceType === "lease_deposit") return "lease_deposit";
  return "other";
}
function titleFor(sourceType) {
  if (sourceType === "lease_rent") return "602租金";
  if (sourceType === "lease_deposit") return "602押金";
  if (sourceType === "property_fee") return "602物业费";
  if (sourceType === "lease_agency_income") return "602中介费收入";
  return "602其他租赁收入";
}

const incomeTypes = ["lease_rent", "lease_deposit", "property_fee", "lease_agency_income", "lease_other_income"];
const leasePayments = await checked(supabase.from("payments").select("source_type, payment_date, amount, currency, exchange_rate_to_xof, receipt_no, notes").eq("source_id", lease.id).in("source_type", incomeTypes).order("payment_date"), "load 602 lease income");
if (leasePayments.length !== 9 || leasePayments.reduce((sum, payment) => sum + Number(payment.amount) * Number(payment.exchange_rate_to_xof), 0) !== 7_420_000) throw new Error("Unexpected 602 lease income");

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

const leaseReceivables = await checked(supabase.from("receivables").select("id").eq("source_id", lease.id).neq("status", "cancelled"), "verify lease receivables");
if (leaseReceivables.length !== leasePayments.length) throw new Error(`602: ${leasePayments.length} income payments but ${leaseReceivables.length} receivables`);
const depositCloseout = await checked(supabase.from("payments").select("source_type, amount").eq("source_id", lease.id).in("source_type", ["lease_deposit_refund", "lease_deposit_deduction"]), "load deposit closeout");
if (depositCloseout.length !== 1 || depositCloseout[0].source_type !== "lease_deposit_refund" || Number(depositCloseout[0].amount) !== 1_000_000) throw new Error("Unexpected 602 deposit closeout");
const ownerPayouts = await checked(supabase.from("payments").select("amount").eq("source_id", lease.id).eq("source_type", "lease_other_expense"), "load owner payouts");
if (ownerPayouts.length !== 1 || Number(ownerPayouts[0].amount) !== 1_500_000) throw new Error("Unexpected 602 owner payout");

const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).single(), "load 602 sale");
if (Number(sale.total_amount_xof) !== 71_000_000) throw new Error("Unexpected 602 sale total");
const salePayments = await checked(supabase.from("payments").select("source_type, payment_date, amount, receipt_no, notes").eq("source_id", sale.id).order("payment_date"), "load 602 sale payments");
const housePayments = salePayments.filter((payment) => payment.source_type === "sale_contract");
const taxPayment = salePayments.find((payment) => payment.source_type === "sale_other_income");
if (housePayments.length !== 2 || housePayments.reduce((sum, payment) => sum + Number(payment.amount), 0) !== 71_000_000 || !housePayments.some((payment) => Number(payment.amount) === 41_000_000) || !housePayments.some((payment) => Number(payment.amount) === 30_000_000)) throw new Error("Unexpected 602 house payments");
if (!taxPayment || Number(taxPayment.amount) !== 1_950_000 || taxPayment.payment_date !== "2023-07-24") throw new Error("Unexpected 602 transfer tax");

const combined = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum").eq("amount_xof", 71_000_000), "find combined 602 sale receivable");
if (combined.length > 1) throw new Error("Duplicate combined 602 sale receivable");
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
    title: "4# 602购房款",
    due_date: payment.payment_date,
    amount_xof: Number(payment.amount),
    paid_amount_xof: Number(payment.amount),
    status: "paid",
    currency: "XOF",
    notes: `${payment.notes}\n收据号：${payment.receipt_no}`,
  };
  if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update house receivable ${payment.receipt_no}`);
  else if (index === 0 && combined.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", combined[0].id), "split combined house receivable");
  else await checked(supabase.from("receivables").insert(payload), `insert house receivable ${payment.receipt_no}`);
}

const taxRows = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "other").eq("due_date", taxPayment.payment_date).eq("amount_xof", 1_950_000), "find 602 tax receivable");
if (taxRows.length > 1) throw new Error("Duplicate 602 tax receivable");
const taxPayload = {
  building_id: building.id,
  unit_id: unit.id,
  customer_id: sale.customer_id,
  source_type: "sale_contract",
  source_id: sale.id,
  category: "other",
  title: "602过户税代收",
  due_date: taxPayment.payment_date,
  amount_xof: 1_950_000,
  paid_amount_xof: 1_950_000,
  status: "paid",
  currency: "XOF",
  notes: `${taxPayment.notes}\n收据号：${taxPayment.receipt_no}`,
};
if (taxRows.length === 1) await checked(supabase.from("receivables").update(taxPayload).eq("id", taxRows[0].id), "update 602 tax receivable");
else await checked(supabase.from("receivables").insert(taxPayload), "insert 602 tax receivable");

const saleReceivables = await checked(supabase.from("receivables").select("amount_xof").eq("source_id", sale.id).neq("status", "cancelled"), "verify sale receivables");
if (saleReceivables.length !== 3 || saleReceivables.reduce((sum, row) => sum + Number(row.amount_xof), 0) !== 72_950_000) throw new Error("Unexpected 602 sale receivables");

await checked(supabase.from("units").update({ notes: "来源：4号公寓.xlsx；SOADDA先租后买，租约归602；Excel文字“201房换601房”与602-3P行及601既有4P记录冲突，按原表房号笔误处理，不迁移至601。原201定金100万已于2022-12-13退还；602新租约押金100万未见退还、扣款或转入房款，处置待核实。租金三笔各150万、物业费合计42万、中介费50万；2023-08-14房东取租金150万单列支出。房款7100万分为4100万、3000万两笔已结清，过户税代收195万单列。" }).eq("id", unit.id), "update 602 notes");
await checked(supabase.from("audit_logs").insert({ action: "rereview_unit_data", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI4", unit_no: "602", excel_unit_conflict_resolved_as_typo: true, lease_income_payment_count: 9, lease_receivables_rebuilt_per_payment: true, original_201_deposit_refunded_xof: 1_000_000, new_602_deposit_disposition: "pending_verification", owner_payout_xof: 1_500_000, sale_paid_xof: 71_000_000, sale_payment_count: 2, transfer_tax_received_xof: 1_950_000 } }), "write audit");

console.log(JSON.stringify({ ok: true, unit: "602", lease_receivables: leaseReceivables.length, unresolved_deposit_xof: 1_000_000, owner_payout_xof: 1_500_000, sale_receivables: saleReceivables.length }));
