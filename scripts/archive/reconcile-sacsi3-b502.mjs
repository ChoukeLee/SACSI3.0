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
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "B502").single(), "load B502");
if (Number(unit.area_sqm) !== 54.99) throw new Error(`Unexpected B502 area: ${unit.area_sqm}`);
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).eq("status", "active").single(), "load B502 sale");
if (Number(sale.total_amount_xof) !== 50_000_000) throw new Error(`Unexpected B502 total: ${sale.total_amount_xof}`);
const customer = await checked(supabase.from("customers").select("id, name").eq("id", sale.customer_id).single(), "load B502 buyer");
if (customer.name !== "BLAL") throw new Error(`Unexpected B502 customer: ${customer.name}`);

const leaseNotes = "来源：3号公寓.xlsx；B502 BLAL先租后买；月租50万FCFA；2021-01-13押2付3共250万，拆为押金100万和三个月租金150万；另收中介费50万，中介取费25万作为支出，净中介收入25万；租期按付款日及三个月反推为2021-01-13至2021-04-12，日期为推断；押金后续处置待确认。";
const leaseNo = "WB-LEASE-SACSI3-B502-20210113-BLAL";
let leaseRows = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id).eq("contract_no", leaseNo), "find B502 lease");
if (leaseRows.length > 1) throw new Error("Duplicate B502 lease");
const leasePayload = { unit_id: unit.id, customer_id: customer.id, contract_no: leaseNo, start_date: "2021-01-13", expected_end_date: "2021-04-12", actual_end_date: "2021-04-12", payment_cycle: "quarterly", payment_day: 13, monthly_rent_xof: 500_000, deposit_amount_xof: 1_000_000, deposit_received: true, rent_free_days: 0, signer_name: "BLAL", attachment_url: null, status: "terminated", expected_end_confirmed: false, paid_through_date: "2021-04-12" };
const leaseId = leaseRows.length
  ? (await checked(supabase.from("lease_contracts").update(leasePayload).eq("id", leaseRows[0].id).select("id").single(), "update B502 lease")).id
  : (await checked(supabase.from("lease_contracts").insert(leasePayload).select("id").single(), "insert B502 lease")).id;

async function upsertPayment({ sourceId, sourceType, date, amount, receiptNo, legacyReceiptNo, direction, category, notes }) {
  let rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (!rows.length && legacyReceiptNo) rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", legacyReceiptNo), `find ${legacyReceiptNo}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const payload = { customer_id: customer.id, unit_id: unit.id, source_type: sourceType, source_id: sourceId, payment_date: date, amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
  const paymentId = rows.length
    ? (await checked(supabase.from("payments").update(payload).eq("id", rows[0].id).select("id").single(), `update ${receiptNo}`)).id
    : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledger = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: date, direction, category, amount_xof: amount, amount_cny: null, description: notes };
  if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), `update ledger ${receiptNo}`);
  else await checked(supabase.from("ledger_entries").insert(ledger), `insert ledger ${receiptNo}`);
}

async function upsertReceivable({ sourceId, category, legacyCategory, title, dueDate, amount, notes }) {
  let rows = await checked(supabase.from("receivables").select("id").eq("source_id", sourceId).eq("category", category).neq("status", "cancelled"), `find receivable ${title}`);
  if (!rows.length && legacyCategory) rows = await checked(supabase.from("receivables").select("id").eq("source_id", sourceId).eq("category", legacyCategory).neq("status", "cancelled"), `find legacy receivable ${title}`);
  if (rows.length > 1) throw new Error(`Duplicate receivable ${title}`);
  const payload = { building_id: building.id, unit_id: unit.id, customer_id: customer.id, source_type: sourceId === sale.id ? "sale_contract" : "lease_contract", source_id: sourceId, category, title, due_date: dueDate, amount_xof: amount, paid_amount_xof: amount, status: "paid", currency: "XOF", notes };
  if (rows.length) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update receivable ${title}`);
  else await checked(supabase.from("receivables").insert(payload), `insert receivable ${title}`);
}

for (const item of [
  { sourceType: "lease_deposit", amount: 1_000_000, code: "DEPOSIT-01", direction: "liability_in", category: "lease_deposit" },
  { sourceType: "lease_rent", amount: 1_500_000, code: "RENT-01", direction: "income", category: "lease_rent" },
  { sourceType: "lease_agency_income", amount: 500_000, code: "AGENCY-IN-01", direction: "income", category: "lease_agency_income" },
  { sourceType: "lease_agency_expense", amount: 250_000, code: "AGENCY-OUT-01", direction: "expense", category: "lease_agency_expense" },
]) await upsertPayment({ sourceId: leaseId, sourceType: item.sourceType, date: "2021-01-13", amount: item.amount, receiptNo: `WB3-LEASE-B502-20210113-${item.code}`, direction: item.direction, category: item.category, notes: leaseNotes });
await upsertReceivable({ sourceId: leaseId, category: "lease_rent", title: "3# B502 BLAL历史租金", dueDate: "2021-01-13", amount: 1_500_000, notes: leaseNotes });
await upsertReceivable({ sourceId: leaseId, category: "lease_deposit", title: "3# B502 BLAL历史押金", dueDate: "2021-01-13", amount: 1_000_000, notes: `${leaseNotes} 押金处置待确认。` });
await upsertReceivable({ sourceId: leaseId, category: "other", title: "3# B502 BLAL租赁中介费", dueDate: "2021-01-13", amount: 500_000, notes: leaseNotes });

const houseNotes = "来源：3号公寓.xlsx；B502买方BLAL；合同总价5000万FCFA；2021-03-08和2021-04-02各收2500万，合计5000万，已结清。";
const registrationNotes = "来源：3号公寓.xlsx；B502实际收注册金30万FCFA；Excel未记日期，以首笔房款日2021-03-08作为系统占位日期；不计入合同总价。";
const taxNotes = "来源：3号公寓.xlsx；B502于2021-04-16实际收税款120万FCFA；按Excel实际金额登记，不另行计算差额，不计入合同总价。";
await checked(supabase.from("sale_contracts").update({ signed_date: "2021-03-08", payment_plan_type: "installment", agency_company: "FULO", agency_commission_amount_xof: null, agency_commission_paid: true }).eq("id", sale.id), "update B502 sale");
await upsertPayment({ sourceId: sale.id, sourceType: "sale_contract", date: "2021-03-08", amount: 25_000_000, receiptNo: "WB3-SALE-B502-20210308-HOUSE-01", legacyReceiptNo: "S3-SALE-B502-CONSOLIDATED", direction: "income", category: "sale", notes: houseNotes });
await upsertPayment({ sourceId: sale.id, sourceType: "sale_contract", date: "2021-04-02", amount: 25_000_000, receiptNo: "WB3-SALE-B502-20210402-HOUSE-02", direction: "income", category: "sale", notes: houseNotes });
await upsertPayment({ sourceId: sale.id, sourceType: "sale_registration_fee", date: "2021-03-08", amount: 300_000, receiptNo: "WB3-SALE-B502-20210308-REGISTRATION-01", direction: "income", category: "sale_registration_fee", notes: registrationNotes });
await upsertPayment({ sourceId: sale.id, sourceType: "sale_other_income", date: "2021-04-16", amount: 1_200_000, receiptNo: "WB3-SALE-B502-20210416-TRANSFER-TAX-01", direction: "income", category: "sale_transfer_tax", notes: taxNotes });
await upsertReceivable({ sourceId: sale.id, category: "sale_installment", legacyCategory: "sale_lump_sum", title: "3# B502购房款", dueDate: "2021-04-02", amount: 50_000_000, notes: houseNotes });

await checked(supabase.from("units").update({ status: "sold", notes: `${houseNotes}\n${registrationNotes}\n${taxNotes}\nFULO提成于2021-04-07支付，金额待补。\n历史：${leaseNotes}` }).eq("id", unit.id), "update B502 unit");

const [leasePayments, salePayments, verifiedLease] = await Promise.all([
  checked(supabase.from("payments").select("source_type, amount").eq("source_id", leaseId), "verify B502 lease payments"),
  checked(supabase.from("payments").select("source_type, amount").eq("source_id", sale.id), "verify B502 sale payments"),
  checked(supabase.from("lease_contracts").select("status, paid_through_date").eq("id", leaseId).single(), "verify B502 lease"),
]);
const sum = (rows, type) => rows.filter((row) => row.source_type === type).reduce((total, row) => total + Number(row.amount), 0);
if (verifiedLease.status !== "terminated" || verifiedLease.paid_through_date !== "2021-04-12") throw new Error("Unexpected B502 lease state");
if (leasePayments.length !== 4 || sum(leasePayments, "lease_rent") !== 1_500_000 || sum(leasePayments, "lease_deposit") !== 1_000_000 || sum(leasePayments, "lease_agency_income") !== 500_000 || sum(leasePayments, "lease_agency_expense") !== 250_000) throw new Error("Unexpected B502 lease payments");
if (salePayments.length !== 4 || sum(salePayments, "sale_contract") !== 50_000_000 || sum(salePayments, "sale_registration_fee") !== 300_000 || sum(salePayments, "sale_other_income") !== 1_200_000) throw new Error("Unexpected B502 sale payments");

await checked(supabase.from("audit_logs").insert({ action: "reconcile_sacsi3_b502", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI3", unit_no: "B502", lease: { tenant: "BLAL", inferred_dates: true, start: "2021-01-13", end: "2021-04-12", rent_xof: 1_500_000, deposit_xof: 1_000_000, deposit_disposition_pending: true, agency_income_xof: 500_000, agency_expense_xof: 250_000, net_agency_income_xof: 250_000 }, sale: { buyer: "BLAL", total_xof: 50_000_000, house_payments: [{ date: "2021-03-08", amount_xof: 25_000_000 }, { date: "2021-04-02", amount_xof: 25_000_000 }], settled: true, registration: { amount_xof: 300_000, date_pending: true, placeholder_date: "2021-03-08" }, transfer_tax: { date: "2021-04-16", actual_amount_xof: 1_200_000, difference_tracking: false }, agency: { company: "FULO", paid_date: "2021-04-07", amount_pending: true }, transfer_status_inferred: false } } }), "write B502 audit log");

console.log(JSON.stringify({ ok: true, unit: "B502", lease_net_agency_income_xof: 250_000, sale_total_xof: 50_000_000, registration_xof: 300_000, actual_transfer_tax_xof: 1_200_000, settled: true }));
