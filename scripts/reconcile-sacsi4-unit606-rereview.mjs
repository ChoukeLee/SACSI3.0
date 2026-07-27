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
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "606").single(), "load 606");
const leases = await checked(supabase.from("lease_contracts").select("id, contract_no, customer_id, signer_name").eq("unit_id", unit.id), "load 606 leases");
if (leases.length !== 1 || leases[0].contract_no !== "WB-LEASE-SACSI4-606-20211015-LILANXIN" || leases[0].signer_name !== "李兰馨") throw new Error("Unexpected 606 lease");
const lease = leases[0];
await checked(supabase.from("lease_contracts").update({ status: "terminated", actual_end_date: "2022-12-14", expected_end_date: "2022-12-14", expected_end_confirmed: true }).eq("id", lease.id), "confirm 606 lease");

const depositNotes = "606李兰馨押金120万；Excel未记载退还、扣款或转入其他合同，处置待核实。";
const depositRows = await checked(supabase.from("payments").select("id").eq("source_id", lease.id).eq("source_type", "lease_deposit").eq("payment_date", "2021-10-06").eq("amount", 1_200_000), "find 606 deposit");
if (depositRows.length !== 1) throw new Error(`Expected one 606 deposit, got ${depositRows.length}`);
await checked(supabase.from("payments").update({ notes: depositNotes }).eq("id", depositRows[0].id), "mark 606 deposit unresolved");
await checked(supabase.from("ledger_entries").update({ description: depositNotes }).eq("payment_id", depositRows[0].id), "mark 606 deposit ledger unresolved");

const leasePayments = await checked(supabase.from("payments").select("source_type, payment_date, amount, currency, exchange_rate_to_xof, receipt_no, notes").eq("source_id", lease.id).in("source_type", ["lease_rent", "lease_deposit", "property_fee", "lease_agency_income", "lease_other_income"]).order("payment_date"), "load 606 lease income");
if (leasePayments.length !== 7 || leasePayments.reduce((sum, payment) => sum + Math.round(Number(payment.amount) * Number(payment.exchange_rate_to_xof)), 0) !== 10_160_000) throw new Error("Unexpected 606 lease income");
for (const payment of leasePayments) {
  const amountXof = Math.round(Number(payment.amount) * Number(payment.exchange_rate_to_xof));
  const category = payment.source_type === "lease_rent" ? "lease_rent" : payment.source_type === "lease_deposit" ? "lease_deposit" : "other";
  const title = payment.source_type === "lease_rent" ? "606租金" : payment.source_type === "lease_deposit" ? "606押金" : payment.source_type === "property_fee" ? "606物业费" : "606其他租赁收入";
  const rows = await checked(supabase.from("receivables").select("id").eq("source_id", lease.id).eq("category", category).eq("due_date", payment.payment_date).eq("amount_xof", amountXof), `find receivable ${payment.receipt_no}`);
  if (rows.length > 1) throw new Error(`Duplicate receivable ${payment.receipt_no}`);
  const payload = { building_id: building.id, unit_id: unit.id, customer_id: lease.customer_id, source_type: "lease_contract", source_id: lease.id, category, title, due_date: payment.payment_date, amount_xof: amountXof, paid_amount_xof: amountXof, status: "paid", currency: "XOF", notes: `${payment.notes}\n收据号：${payment.receipt_no}` };
  if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update receivable ${payment.receipt_no}`);
  else await checked(supabase.from("receivables").insert(payload), `insert receivable ${payment.receipt_no}`);
}
const leaseReceivables = await checked(supabase.from("receivables").select("id").eq("source_id", lease.id).neq("status", "cancelled"), "verify 606 lease receivables");
if (leaseReceivables.length !== 7) throw new Error(`Unexpected 606 lease receivable count: ${leaseReceivables.length}`);
const depositCloseout = await checked(supabase.from("payments").select("id").eq("source_id", lease.id).in("source_type", ["lease_deposit_refund", "lease_deposit_deduction"]), "load 606 deposit closeout");
if (depositCloseout.length !== 0) throw new Error("Unexpected 606 deposit closeout");

const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof, agency_commission_amount_xof, agency_commission_paid").eq("unit_id", unit.id).single(), "load 606 sale");
if (Number(sale.total_amount_xof) !== 95_000_000 || Number(sale.agency_commission_amount_xof) !== 1_425_000 || !sale.agency_commission_paid) throw new Error("Unexpected 606 sale contract");
const buyer = await checked(supabase.from("customers").select("name").eq("id", sale.customer_id).single(), "load 606 buyer");
if (buyer.name !== "KACOU") throw new Error(`Unexpected 606 buyer: ${buyer.name}`);
const salePayments = await checked(supabase.from("payments").select("source_type, payment_date, amount, receipt_no, notes").eq("source_id", sale.id).order("payment_date"), "load 606 sale payments");
if (salePayments.length !== 4) throw new Error(`Unexpected 606 sale payment count: ${salePayments.length}`);
const housePayments = salePayments.filter((payment) => payment.source_type === "sale_contract");
const tax = salePayments.find((payment) => payment.source_type === "sale_other_income");
const agency = salePayments.find((payment) => payment.source_type === "sale_agency_expense");
if (housePayments.length !== 2 || housePayments.reduce((sum, payment) => sum + Number(payment.amount), 0) !== 95_000_000 || !housePayments.some((payment) => payment.payment_date === "2023-02-13" && Number(payment.amount) === 55_000_000) || !housePayments.some((payment) => payment.payment_date === "2023-04-13" && Number(payment.amount) === 40_000_000)) throw new Error("Unexpected 606 house payments");
if (!tax || tax.payment_date !== "2023-04-13" || Number(tax.amount) !== 2_850_000) throw new Error("Unexpected 606 transfer tax");
if (!agency || agency.payment_date !== "2023-04-17" || Number(agency.amount) !== 1_425_000) throw new Error("Unexpected 606 agency expense");

const combined = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum").eq("amount_xof", 95_000_000), "find combined 606 sale receivable");
if (combined.length > 1) throw new Error("Duplicate combined 606 sale receivable");
for (let index = 0; index < housePayments.length; index += 1) {
  const payment = housePayments[index];
  const rows = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum").eq("due_date", payment.payment_date).eq("amount_xof", Number(payment.amount)), `find house receivable ${payment.receipt_no}`);
  if (rows.length > 1) throw new Error(`Duplicate house receivable ${payment.receipt_no}`);
  const payload = { building_id: building.id, unit_id: unit.id, customer_id: sale.customer_id, source_type: "sale_contract", source_id: sale.id, category: "sale_lump_sum", title: "4# 606购房款", due_date: payment.payment_date, amount_xof: Number(payment.amount), paid_amount_xof: Number(payment.amount), status: "paid", currency: "XOF", notes: `${payment.notes}\n收据号：${payment.receipt_no}` };
  if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update house receivable ${payment.receipt_no}`);
  else if (index === 0 && combined.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", combined[0].id), "split combined 606 house receivable");
  else await checked(supabase.from("receivables").insert(payload), `insert house receivable ${payment.receipt_no}`);
}

const taxRows = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "other").eq("due_date", tax.payment_date).eq("amount_xof", 2_850_000), "find 606 tax receivable");
if (taxRows.length > 1) throw new Error("Duplicate 606 tax receivable");
const taxPayload = { building_id: building.id, unit_id: unit.id, customer_id: sale.customer_id, source_type: "sale_contract", source_id: sale.id, category: "other", title: "606过户税代收", due_date: tax.payment_date, amount_xof: 2_850_000, paid_amount_xof: 2_850_000, status: "paid", currency: "XOF", notes: `${tax.notes}\n收据号：${tax.receipt_no}` };
if (taxRows.length === 1) await checked(supabase.from("receivables").update(taxPayload).eq("id", taxRows[0].id), "update 606 tax receivable");
else await checked(supabase.from("receivables").insert(taxPayload), "insert 606 tax receivable");

const saleReceivables = await checked(supabase.from("receivables").select("amount_xof").eq("source_id", sale.id).neq("status", "cancelled"), "verify 606 sale receivables");
if (saleReceivables.length !== 3 || saleReceivables.reduce((sum, row) => sum + Number(row.amount_xof), 0) !== 97_850_000) throw new Error("Unexpected 606 sale receivables");
const agencyReceivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("amount_xof", 1_425_000), "verify no agency receivable");
if (agencyReceivables.length !== 0) throw new Error("606 agency expense must not create a receivable");

await checked(supabase.from("units").update({ notes: "来源：4号公寓.xlsx；李兰馨于2021-10-15至2022-12-14承租606，租金及物业费已按三期逐笔登记；押金120万未见退还、扣款或转入其他合同，处置待核实。买方KACOU，房款9500万分为5500万和4000万两笔已结清；2023-04-13过户税代收285万单列；2023-04-17公司支付出售中介费142.5万单列支出。" }).eq("id", unit.id), "update 606 notes");
await checked(supabase.from("audit_logs").insert({ action: "rereview_unit_data", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI4", unit_no: "606", historical_tenant: "李兰馨", lease_income_payment_count: 7, lease_income_xof: 10_160_000, lease_receivables_rebuilt_per_payment: true, deposit_disposition: "pending_verification", buyer: "KACOU", sale_paid_xof: 95_000_000, sale_payment_count: 2, transfer_tax_xof: 2_850_000, agency_expense_xof: 1_425_000, expense_receivable_created: false } }), "write audit");

console.log(JSON.stringify({ ok: true, unit: "606", lease_receivables: leaseReceivables.length, unresolved_deposit_xof: 1_200_000, sale_receivables: saleReceivables.length, agency_expense_xof: 1_425_000 }));
