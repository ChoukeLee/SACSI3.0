import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(query, label) { const { data, error } = await query; if (error) throw new Error(`${label}: ${error.message}`); return data; }

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI3").single(), "load building");
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "B1202").single(), "load B1202");
if (Number(unit.area_sqm) !== 54.99) throw new Error(`Unexpected B1202 area: ${unit.area_sqm}`);
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).eq("status", "active").single(), "load B1202 sale");
if (Number(sale.total_amount_xof) !== 55_000_000) throw new Error(`Unexpected B1202 total: ${sale.total_amount_xof}`);
const customer = await checked(supabase.from("customers").select("id, name").eq("id", sale.customer_id).single(), "load KOMENAN");
if (customer.name !== "KOMENAN") throw new Error(`Unexpected B1202 customer: ${customer.name}`);

async function upsertPayment({ sourceId, sourceType, receiptNo, legacyReceiptNo, date, amount, direction, category, notes }) {
  let rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (!rows.length && legacyReceiptNo) rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", legacyReceiptNo), `find ${legacyReceiptNo}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const payload = { customer_id: customer.id, unit_id: unit.id, source_type: sourceType, source_id: sourceId, payment_date: date, amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
  const paymentId = rows.length ? (await checked(supabase.from("payments").update(payload).eq("id", rows[0].id).select("id").single(), `update ${receiptNo}`)).id : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledger = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: date, direction, category, amount_xof: amount, amount_cny: null, description: notes };
  if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), `update ledger ${receiptNo}`); else await checked(supabase.from("ledger_entries").insert(ledger), `insert ledger ${receiptNo}`);
}
async function upsertReceivable({ sourceId, category, title, dueDate, amount, notes }) {
  const rows = await checked(supabase.from("receivables").select("id").eq("source_id", sourceId).eq("category", category).neq("status", "cancelled"), `find receivable ${title}`);
  if (rows.length > 1) throw new Error(`Duplicate receivable ${title}`);
  const payload = { building_id: building.id, unit_id: unit.id, customer_id: customer.id, source_type: category.startsWith("sale_") ? "sale_contract" : "lease_contract", source_id: sourceId, category, title, due_date: dueDate, amount_xof: amount, paid_amount_xof: amount, status: "paid", currency: "XOF", notes };
  if (rows.length) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update receivable ${title}`); else await checked(supabase.from("receivables").insert(payload), `insert receivable ${title}`);
}

const leaseContractNo = "WB-LEASE-SACSI3-B1202-20210517-KOMENAN";
const leaseNotes = "来源：3号公寓.xlsx；B1202 KOMENAN历史租约，2021-05-17至2021-08-16，月租50万FCFA；2021-05-11共收300万，拆为押金100万、三个月租金150万、中介费50万；2021-07-21押金100万已退；合同按已终止、已清登记。";
let leases = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id).eq("contract_no", leaseContractNo), "find B1202 lease");
if (leases.length > 1) throw new Error("Duplicate B1202 lease");
const leasePayload = { unit_id: unit.id, customer_id: customer.id, contract_no: leaseContractNo, start_date: "2021-05-17", expected_end_date: "2021-08-16", actual_end_date: "2021-08-16", payment_cycle: "quarterly", payment_day: 17, monthly_rent_xof: 500_000, deposit_amount_xof: 1_000_000, deposit_received: true, rent_free_days: 0, signer_name: "KOMENAN", attachment_url: null, status: "terminated", expected_end_confirmed: true, paid_through_date: "2021-08-16" };
const leaseId = leases.length ? (await checked(supabase.from("lease_contracts").update(leasePayload).eq("id", leases[0].id).select("id").single(), "update B1202 lease")).id : (await checked(supabase.from("lease_contracts").insert(leasePayload).select("id").single(), "insert B1202 lease")).id;
const leasePayments = [["2021-05-11", 1_000_000, "lease_deposit", "DEPOSIT-01", "liability_in", "lease_deposit"], ["2021-05-11", 1_500_000, "lease_rent", "RENT-01", "income", "lease_rent"], ["2021-05-11", 500_000, "lease_agency_income", "AGENCY-01", "income", "lease_agency_income"], ["2021-07-21", 1_000_000, "lease_deposit_refund", "DEPREF-01", "liability_out", "lease_deposit_refund"]];
for (const [date, amount, type, code, direction, category] of leasePayments) await upsertPayment({ sourceId: leaseId, sourceType: type, receiptNo: `WB3-LEASE-B1202-${date.replaceAll("-", "")}-${code}`, date, amount, direction, category, notes: leaseNotes });
await upsertReceivable({ sourceId: leaseId, category: "lease_rent", title: "3# B1202 KOMENAN历史租金", dueDate: "2021-05-11", amount: 1_500_000, notes: leaseNotes });
await upsertReceivable({ sourceId: leaseId, category: "lease_deposit", title: "3# B1202 KOMENAN历史押金", dueDate: "2021-05-11", amount: 1_000_000, notes: `${leaseNotes} 押金已全额退还。` });
await upsertReceivable({ sourceId: leaseId, category: "other", title: "3# B1202 KOMENAN租赁中介费", dueDate: "2021-05-11", amount: 500_000, notes: leaseNotes });

const saleNotes = "来源：3号公寓.xlsx；B1202买方KOMENAN；合同总价5500万FCFA；2021-02-10支票支付2500万、2021-07-08支票支付3000万，已结清。";
const registrationNotes = "来源：3号公寓.xlsx；B1202于2021-02-10支票支付注册金30万FCFA；单独列账，不计入合同总价。";
await checked(supabase.from("sale_contracts").update({ signed_date: "2021-02-10", payment_plan_type: "installment", agency_company: "FULO", agency_commission_amount_xof: null, agency_commission_paid: true }).eq("id", sale.id), "update B1202 sale");
await upsertPayment({ sourceId: sale.id, sourceType: "sale_contract", receiptNo: "WB3-SALE-1202-20210210-HOUSE-01", legacyReceiptNo: "S3-SALE-B1202-CONSOLIDATED", date: "2021-02-10", amount: 25_000_000, direction: "income", category: "sale", notes: `${saleNotes} 本笔支付方式：支票。` });
await upsertPayment({ sourceId: sale.id, sourceType: "sale_registration_fee", receiptNo: "WB3-SALE-1202-20210210-REGISTRATION-01", date: "2021-02-10", amount: 300_000, direction: "income", category: "sale_registration_fee", notes: registrationNotes });
await upsertPayment({ sourceId: sale.id, sourceType: "sale_contract", receiptNo: "WB3-SALE-1202-20210708-HOUSE-02", date: "2021-07-08", amount: 30_000_000, direction: "income", category: "sale", notes: `${saleNotes} 本笔支付方式：支票。` });
const saleReceivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).neq("status", "cancelled"), "load B1202 sale receivable");
if (saleReceivables.length !== 1) throw new Error(`Unexpected B1202 sale receivable count: ${saleReceivables.length}`);
await checked(supabase.from("receivables").update({ category: "sale_installment", title: "3# B1202购房款", due_date: "2021-07-08", amount_xof: 55_000_000, paid_amount_xof: 55_000_000, status: "paid", currency: "XOF", notes: saleNotes }).eq("id", saleReceivables[0].id), "update B1202 sale receivable");
await checked(supabase.from("units").update({ status: "sold", notes: `${saleNotes}\n${registrationNotes}\n历史：${leaseNotes}\nFULO提成于2021-12-14支付，金额待补；Excel未记实际税款；过户状态不推断。` }).eq("id", unit.id), "update B1202 unit");

const [leaseVerified, saleVerified] = await Promise.all([checked(supabase.from("payments").select("source_type, amount").eq("source_id", leaseId), "verify lease payments"), checked(supabase.from("payments").select("source_type, amount").eq("source_id", sale.id), "verify sale payments")]);
const sum = (rows, type) => rows.filter((row) => row.source_type === type).reduce((total, row) => total + Number(row.amount), 0);
if (leaseVerified.length !== 4 || sum(leaseVerified, "lease_rent") !== 1_500_000 || sum(leaseVerified, "lease_deposit") !== 1_000_000 || sum(leaseVerified, "lease_agency_income") !== 500_000 || sum(leaseVerified, "lease_deposit_refund") !== 1_000_000) throw new Error("Unexpected B1202 lease totals");
if (saleVerified.length !== 3 || sum(saleVerified, "sale_contract") !== 55_000_000 || sum(saleVerified, "sale_registration_fee") !== 300_000) throw new Error("Unexpected B1202 sale totals");
await checked(supabase.from("audit_logs").insert({ action: "reconcile_sacsi3_b1202", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI3", unit_no: "B1202", customer: "KOMENAN", lease: { start: "2021-05-17", end: "2021-08-16", monthly_rent_xof: 500_000, rent_xof: 1_500_000, deposit_xof: 1_000_000, deposit_refund_date: "2021-07-21", agency_income_xof: 500_000, status: "terminated" }, sale: { total_xof: 55_000_000, payment_count: 2, settled: true, registration_xof: 300_000, agency: { company: "FULO", paid_date: "2021-12-14", amount_pending: true } } } }), "write B1202 audit");
console.log(JSON.stringify({ ok: true, unit: "B1202", customer: "KOMENAN", lease_settled: true, sale_settled: true, registration_xof: 300_000 }));
