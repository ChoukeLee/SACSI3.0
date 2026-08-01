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
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "B404").single(), "load B404");
if (Number(unit.area_sqm) !== 173.51) throw new Error(`Unexpected B404 area: ${unit.area_sqm}`);

let customers = await checked(supabase.from("customers").select("id").eq("name", "TOURE ISSIAKA"), "find TOURE ISSIAKA");
if (customers.length > 1) throw new Error("Duplicate TOURE ISSIAKA customer");
const customerNotes = "来源：3号公寓.xlsx；3# B404购房办理人；Excel列示总价15900万FCFA，仅见2021-09-28注册金30万，未见房款。";
const customerId = customers[0]?.id ?? (await checked(supabase.from("customers").insert({ name: "TOURE ISSIAKA", notes: customerNotes, is_blacklisted: false }).select("id").single(), "insert TOURE ISSIAKA")).id;
await checked(supabase.from("customers").update({ notes: customerNotes }).eq("id", customerId), "update TOURE ISSIAKA");

const contractNo = "WB-SALE-SACSI3-B404-20210928-TOURE-ISSIAKA";
const existingSales = await checked(supabase.from("sale_contracts").select("id").eq("unit_id", unit.id), "find B404 sale");
if (existingSales.length > 1) throw new Error("Duplicate B404 sale");
const salePayload = {
  unit_id: unit.id,
  customer_id: customerId,
  contract_no: contractNo,
  signed_date: "2021-09-28",
  transfer_date: null,
  transfer_status: "pending",
  title_certificate_no: null,
  agency_company: null,
  agent_name: null,
  agency_commission_amount_xof: null,
  agency_commission_paid: false,
  payment_plan_type: "pending",
  total_amount_xof: 0,
  attachment_url: null,
  status: "active",
};
const saleId = existingSales.length
  ? (await checked(supabase.from("sale_contracts").update(salePayload).eq("id", existingSales[0].id).select("id").single(), "update B404 sale")).id
  : (await checked(supabase.from("sale_contracts").insert(salePayload).select("id").single(), "insert B404 sale")).id;

const registrationNotes = "来源：3号公寓.xlsx；B404 TOURE ISSIAKA于2021-09-28支付注册金30万FCFA；未见购房款，不把Excel列示的15900万合同总价推定为欠款。";
const receiptNo = "WB3-SALE-B404-20210928-REGISTRATION-01";
let paymentRows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", receiptNo), "find B404 registration");
if (paymentRows.length > 1) throw new Error("Duplicate B404 registration");
const paymentPayload = { customer_id: customerId, unit_id: unit.id, source_type: "sale_registration_fee", source_id: saleId, payment_date: "2021-09-28", amount: 300_000, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes: registrationNotes };
const paymentId = paymentRows.length
  ? (await checked(supabase.from("payments").update(paymentPayload).eq("id", paymentRows[0].id).select("id").single(), "update B404 registration")).id
  : (await checked(supabase.from("payments").insert(paymentPayload).select("id").single(), "insert B404 registration")).id;
const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), "find B404 registration ledger");
if (ledgers.length > 1) throw new Error("Duplicate B404 registration ledger");
const ledger = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: "2021-09-28", direction: "income", category: "sale_registration_fee", amount_xof: 300_000, amount_cny: null, description: registrationNotes };
if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), "update B404 registration ledger");
else await checked(supabase.from("ledger_entries").insert(ledger), "insert B404 registration ledger");

const activeHuaweiNotes = "当前占用推定：Excel最后一条租赁记录为华为于2022-12-15入住，之后无退租或新租户记录；按用户确认参照B204登记为华为当前占用。月租、押金、已缴至日期和合同到期日均待补，因此不生成0金额或虚假到期日的生效合同。";
const historyNotes = "历史：宁椿欢租约已终止；已知租金1440万FCFA、押金240万FCFA；2021-06-01与B401同收的首期六个月租金金额缺失；押金处置待确认。";
const saleNotes = "购房办理：TOURE ISSIAKA；Excel列示总价15900万FCFA；2021-09-28仅收注册金30万；未见房款，不生成欠款；签约日暂以注册金日期占位，过户状态待确认。";
await checked(supabase.from("units").update({ status: "locked", notes: `${activeHuaweiNotes}\n${historyNotes}\n${saleNotes}` }).eq("id", unit.id), "update B404 unit");
await checked(supabase.from("unit_business_flags").update({ is_enabled: true }).eq("unit_id", unit.id).eq("business_type", "sale"), "enable B404 sale flag");

const [saleReceivables, schedules, verifiedSale, verifiedRegistration, activeLeases] = await Promise.all([
  checked(supabase.from("receivables").select("id").eq("source_id", saleId).neq("status", "cancelled"), "verify B404 sale receivables"),
  checked(supabase.from("sale_payment_schedule").select("id").eq("sale_contract_id", saleId), "verify B404 schedules"),
  checked(supabase.from("sale_contracts").select("customer_id, total_amount_xof, status, transfer_status").eq("id", saleId).single(), "verify B404 sale"),
  checked(supabase.from("payments").select("source_type, amount").eq("source_id", saleId), "verify B404 registration"),
  checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id).eq("status", "active"), "verify B404 active leases"),
]);
if (saleReceivables.length || schedules.length || Number(verifiedSale.total_amount_xof) !== 0 || verifiedSale.status !== "active" || verifiedSale.transfer_status !== "pending") throw new Error("Unexpected B404 sale state");
if (verifiedRegistration.length !== 1 || verifiedRegistration[0].source_type !== "sale_registration_fee" || Number(verifiedRegistration[0].amount) !== 300_000) throw new Error("Unexpected B404 registration");
if (activeLeases.length) throw new Error("B404 should not have a fabricated active lease");

await checked(supabase.from("audit_logs").insert({
  action: "reconcile_sacsi3_b404",
  entity_type: "unit",
  entity_id: unit.id,
  metadata: {
    building_code: "SACSI3",
    unit_no: "B404",
    current_occupancy: { tenant: "华为", inferred_from_last_workbook_record: true, move_in: "2022-12-15", finance_pending: true, active_contract_fabricated: false, reference_unit: "B204" },
    historical_lease: { tenant: "中轻／宁椿欢", recorded: true, known_rent_xof: 14_400_000, deposit_xof: 2_400_000, first_rent_amount_pending: true, deposit_disposition_pending: true },
    sale_process: { buyer: "TOURE ISSIAKA", workbook_listed_total_xof: 159_000_000, structured_total_xof: 0, registration_date: "2021-09-28", registration_xof: 300_000, house_payments_found: false, debt_inferred: false, signed_date_placeholder: true, transfer_pending: true },
  },
}), "write B404 audit log");

console.log(JSON.stringify({ ok: true, unit: "B404", current_occupant: "华为", historical_lease_recorded: true, registration_xof: 300_000, house_debt_inferred: false }));
