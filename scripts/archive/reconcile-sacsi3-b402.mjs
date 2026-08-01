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
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "B402").single(), "load B402");
if (Number(unit.area_sqm) !== 54.99) throw new Error(`Unexpected B402 area: ${unit.area_sqm}`);
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).eq("status", "active").single(), "load B402 sale");
if (Number(sale.total_amount_xof) !== 50_000_000) throw new Error(`Unexpected B402 total: ${sale.total_amount_xof}`);
const customer = await checked(supabase.from("customers").select("id, name").eq("id", sale.customer_id).single(), "load B402 buyer");
if (customer.name !== "GOULIBALY") throw new Error(`Unexpected B402 buyer: ${customer.name}`);

const houseNotes = "来源：3号公寓.xlsx；B402买方GOULIBALY；合同总价5000万FCFA；2020-09-12收1900万、2020-10-16收2000万、2020-10-28收1100万，合计5000万，已结清。";
const taxNotes = "来源：3号公寓.xlsx；B402于2022-07-11实际收税款150万FCFA；按Excel实际金额登记，不另行计算差额，不计入合同总价。";
const agencyNotes = "FULO提成于2021-04-07支付，金额待补。";
await checked(supabase.from("sale_contracts").update({
  signed_date: "2020-09-12",
  payment_plan_type: "installment",
  agency_company: "FULO",
  agency_commission_amount_xof: null,
  agency_commission_paid: true,
}).eq("id", sale.id), "update B402 sale");
await checked(supabase.from("units").update({ status: "sold", notes: `${houseNotes}\n${taxNotes}\n${agencyNotes}` }).eq("id", unit.id), "update B402 unit");

async function upsertPayment({ receiptNo, legacyReceiptNo, date, amount, sourceType, notes, category }) {
  let rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (!rows.length && legacyReceiptNo) rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", legacyReceiptNo), `find ${legacyReceiptNo}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const payload = { customer_id: customer.id, unit_id: unit.id, source_type: sourceType, source_id: sale.id, payment_date: date, amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
  const paymentId = rows.length
    ? (await checked(supabase.from("payments").update(payload).eq("id", rows[0].id).select("id").single(), `update ${receiptNo}`)).id
    : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledger = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: date, direction: "income", category, amount_xof: amount, amount_cny: null, description: notes };
  if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), `update ledger ${receiptNo}`);
  else await checked(supabase.from("ledger_entries").insert(ledger), `insert ledger ${receiptNo}`);
}

await upsertPayment({ receiptNo: "WB3-SALE-B402-20200912-HOUSE-01", legacyReceiptNo: "S3-SALE-B402-CONSOLIDATED", date: "2020-09-12", amount: 19_000_000, sourceType: "sale_contract", notes: houseNotes, category: "sale" });
await upsertPayment({ receiptNo: "WB3-SALE-B402-20201016-HOUSE-02", date: "2020-10-16", amount: 20_000_000, sourceType: "sale_contract", notes: houseNotes, category: "sale" });
await upsertPayment({ receiptNo: "WB3-SALE-B402-20201028-HOUSE-03", date: "2020-10-28", amount: 11_000_000, sourceType: "sale_contract", notes: houseNotes, category: "sale" });
await upsertPayment({ receiptNo: "WB3-SALE-B402-20220711-TRANSFER-TAX-01", date: "2022-07-11", amount: 1_500_000, sourceType: "sale_other_income", notes: taxNotes, category: "sale_transfer_tax" });

const receivable = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).neq("status", "cancelled").single(), "load B402 receivable");
await checked(supabase.from("receivables").update({
  category: "sale_installment",
  title: "3# B402购房款",
  due_date: "2020-10-28",
  amount_xof: 50_000_000,
  paid_amount_xof: 50_000_000,
  status: "paid",
  currency: "XOF",
  notes: houseNotes,
}).eq("id", receivable.id), "update B402 receivable");

const verified = await checked(supabase.from("payments").select("source_type, amount").eq("source_id", sale.id), "verify B402 payments");
const houseTotal = verified.filter((row) => row.source_type === "sale_contract").reduce((sum, row) => sum + Number(row.amount), 0);
const taxTotal = verified.filter((row) => row.source_type === "sale_other_income").reduce((sum, row) => sum + Number(row.amount), 0);
if (verified.length !== 4 || houseTotal !== 50_000_000 || taxTotal !== 1_500_000) throw new Error("Unexpected verified B402 payments");

await checked(supabase.from("audit_logs").insert({
  action: "reconcile_sacsi3_b402",
  entity_type: "sale_contract",
  entity_id: sale.id,
  metadata: {
    building_code: "SACSI3",
    unit_no: "B402",
    buyer: customer.name,
    total_xof: 50_000_000,
    house_payments: [
      { date: "2020-09-12", amount_xof: 19_000_000 },
      { date: "2020-10-16", amount_xof: 20_000_000 },
      { date: "2020-10-28", amount_xof: 11_000_000 },
    ],
    settled: true,
    transfer_tax: { date: "2022-07-11", actual_amount_xof: 1_500_000, difference_tracking: false },
    agency: { company: "FULO", paid_date: "2021-04-07", amount_pending: true },
    transfer_status_inferred: false,
  },
}), "write B402 audit log");

console.log(JSON.stringify({ ok: true, unit: "B402", house_total_xof: houseTotal, actual_transfer_tax_xof: taxTotal, settled: true }));
