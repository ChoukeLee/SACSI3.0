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
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "B403").single(), "load B403");
if (Number(unit.area_sqm) !== 115.44) throw new Error(`Unexpected B403 area: ${unit.area_sqm}`);
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).eq("status", "active").single(), "load B403 sale");
if (Number(sale.total_amount_xof) !== 107_000_000) throw new Error(`Unexpected B403 total: ${sale.total_amount_xof}`);
const customer = await checked(supabase.from("customers").select("id, name").eq("id", sale.customer_id).single(), "load B403 buyer");
if (customer.name !== "SCI DA") throw new Error(`Unexpected B403 buyer: ${customer.name}`);

const houseNotes = "来源：3号公寓.xlsx；B403买方SCI DA；合同总价10700万FCFA；2021-01-11收1605万、2021-01-12收4815万、2021-01-18收4280万，合计10700万，已结清。";
const agencyNotes = "FULO提成于2021-02-10支付，金额待补。";
await checked(supabase.from("sale_contracts").update({
  signed_date: "2021-01-11",
  payment_plan_type: "installment",
  agency_company: "FULO",
  agency_commission_amount_xof: null,
  agency_commission_paid: true,
}).eq("id", sale.id), "update B403 sale");
await checked(supabase.from("units").update({ status: "sold", notes: `${houseNotes}\n${agencyNotes}\nExcel未记税款，不补造；过户状态不推断。` }).eq("id", unit.id), "update B403 unit");

async function upsertPayment({ receiptNo, legacyReceiptNo, date, amount }) {
  let rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (!rows.length && legacyReceiptNo) rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", legacyReceiptNo), `find ${legacyReceiptNo}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const payload = { customer_id: customer.id, unit_id: unit.id, source_type: "sale_contract", source_id: sale.id, payment_date: date, amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes: houseNotes };
  const paymentId = rows.length
    ? (await checked(supabase.from("payments").update(payload).eq("id", rows[0].id).select("id").single(), `update ${receiptNo}`)).id
    : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledger = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: date, direction: "income", category: "sale", amount_xof: amount, amount_cny: null, description: houseNotes };
  if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), `update ledger ${receiptNo}`);
  else await checked(supabase.from("ledger_entries").insert(ledger), `insert ledger ${receiptNo}`);
}

await upsertPayment({ receiptNo: "WB3-SALE-B403-20210111-HOUSE-01", legacyReceiptNo: "S3-SALE-B403-CONSOLIDATED", date: "2021-01-11", amount: 16_050_000 });
await upsertPayment({ receiptNo: "WB3-SALE-B403-20210112-HOUSE-02", date: "2021-01-12", amount: 48_150_000 });
await upsertPayment({ receiptNo: "WB3-SALE-B403-20210118-HOUSE-03", date: "2021-01-18", amount: 42_800_000 });

const receivable = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).neq("status", "cancelled").single(), "load B403 receivable");
await checked(supabase.from("receivables").update({
  category: "sale_installment",
  title: "3# B403购房款",
  due_date: "2021-01-18",
  amount_xof: 107_000_000,
  paid_amount_xof: 107_000_000,
  status: "paid",
  currency: "XOF",
  notes: houseNotes,
}).eq("id", receivable.id), "update B403 receivable");

const verified = await checked(supabase.from("payments").select("source_type, payment_date, amount").eq("source_id", sale.id).order("payment_date"), "verify B403 payments");
if (verified.length !== 3 || verified.some((row) => row.source_type !== "sale_contract") || verified.reduce((sum, row) => sum + Number(row.amount), 0) !== 107_000_000) throw new Error("Unexpected verified B403 payments");

await checked(supabase.from("audit_logs").insert({
  action: "reconcile_sacsi3_b403",
  entity_type: "sale_contract",
  entity_id: sale.id,
  metadata: {
    building_code: "SACSI3",
    unit_no: "B403",
    buyer: customer.name,
    total_xof: 107_000_000,
    house_payments: [
      { date: "2021-01-11", amount_xof: 16_050_000 },
      { date: "2021-01-12", amount_xof: 48_150_000 },
      { date: "2021-01-18", amount_xof: 42_800_000 },
    ],
    settled: true,
    tax_missing: true,
    agency: { company: "FULO", paid_date: "2021-02-10", amount_pending: true },
    transfer_status_inferred: false,
  },
}), "write B403 audit log");

console.log(JSON.stringify({ ok: true, unit: "B403", house_total_xof: 107_000_000, settled: true }));
