import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function checked(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI4").single(), "load building");
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "111").single(), "load unit 111");
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, signed_date").eq("unit_id", unit.id).single(), "load 111 sale");
if (sale.signed_date !== "2019-12-03") throw new Error(`Unexpected 111 sale date ${sale.signed_date}`);
await checked(
  supabase.from("sale_contracts").update({ contract_no: "WB-SALE-SACSI4-111-20191203", total_amount_xof: 66_000_000, payment_plan_type: "\u5408\u540c\u603b\u4ef76600\u4e07\uff0c\u65e0\u8f66\u4f4d\u8bb0\u5f55\uff1b\u516d\u7b14\u623f\u6b3e\u5df2\u7ed3\u6e05\uff1b\u8fc7\u6237\u7a0e135\u4e07\u53e6\u5217\u4ee3\u6536\u3002" }).eq("id", sale.id),
  "update 111 sale",
);

async function upsertPayment(spec) {
  let rows = await checked(supabase.from("payments").select("id").eq("source_id", sale.id).eq("receipt_no", spec.receipt), `find ${spec.receipt}`);
  if (rows.length === 0 && spec.oldReceipt) rows = await checked(supabase.from("payments").select("id").eq("source_id", sale.id).eq("receipt_no", spec.oldReceipt), `find old ${spec.oldReceipt}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${spec.receipt}`);
  const payload = { customer_id: sale.customer_id, unit_id: unit.id, source_type: spec.sourceType, source_id: sale.id, payment_date: spec.date, amount: spec.amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: spec.receipt, notes: spec.notes };
  let paymentId;
  if (rows.length === 1) {
    paymentId = rows[0].id;
    await checked(supabase.from("payments").update(payload).eq("id", paymentId), `update ${spec.receipt}`);
  } else {
    const inserted = await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${spec.receipt}`);
    paymentId = inserted.id;
  }
  const ledgerPayload = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: spec.date, direction: spec.direction, category: spec.category, amount_xof: spec.amount, amount_cny: null, description: spec.notes };
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${spec.receipt}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${spec.receipt}`);
  if (ledgers.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgers[0].id), `update ledger ${spec.receipt}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${spec.receipt}`);
}

const entries = [
  { date: "2019-12-03", amount: 20_000_000, sourceType: "sale_contract", direction: "income", category: "sale", receipt: "WB4-SALE-111-20191203-HOUSE-01", notes: "111\u7b2c\u4e00\u7b14\u623f\u6b3e2000\u4e07\u3002" },
  { date: "2020-06-09", amount: 10_000_000, sourceType: "sale_contract", direction: "income", category: "sale", receipt: "WB4-SALE-111-20200609-HOUSE-02", notes: "111\u7b2c\u4e8c\u7b14\u623f\u6b3e1000\u4e07\u3002" },
  { date: "2020-07-16", amount: 10_000_000, sourceType: "sale_contract", direction: "income", category: "sale", receipt: "WB4-SALE-111-20200716-HOUSE-03", notes: "111\u7b2c\u4e09\u7b14\u623f\u6b3e1000\u4e07\u3002" },
  { date: "2020-08-20", amount: 7_000_000, sourceType: "sale_contract", direction: "income", category: "sale", receipt: "WB4-SALE-111-20200820-HOUSE-04", notes: "111\u7b2c\u56db\u7b14\u623f\u6b3e700\u4e07\u3002" },
  { date: "2020-09-16", amount: 10_000_000, sourceType: "sale_contract", direction: "income", category: "sale", receipt: "WB4-SALE-111-20200916-HOUSE-05", notes: "111\u7b2c\u4e94\u7b14\u623f\u6b3e1000\u4e07\u3002" },
  { date: "2021-10-28", amount: 9_000_000, sourceType: "sale_contract", direction: "income", category: "sale", receipt: "WB4-SALE-111-20211028-HOUSE-06", oldReceipt: "S4-SALE-111-CONSOLIDATED", notes: "111\u7b2c\u516d\u7b14\u623f\u6b3e900\u4e07\uff1b\u623f\u6b3e\u5df2\u7ed3\u6e05\u3002" },
  { date: "2021-12-14", amount: 1_350_000, sourceType: "sale_other_income", direction: "liability_in", category: "sale_transfer_tax", receipt: "WB4-SALE-111-20211214-TRANSFERTAX-01", notes: "111\u8fc7\u6237\u7a0e\u4ee3\u6536135\u4e07\uff1b\u4e0d\u8ba1\u5165\u623f\u6b3e\u548c\u5408\u540c\u603b\u4ef7\u3002" },
];
for (const entry of entries) await upsertPayment(entry);

const receivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum"), "load 111 receivable");
if (receivables.length !== 1) throw new Error(`Expected one 111 receivable, got ${receivables.length}`);
await checked(
  supabase.from("receivables").update({ amount_xof: 66_000_000, paid_amount_xof: 66_000_000, status: "paid", notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx Sheet1\uff1b\u5408\u540c\u603b\u4ef76600\u4e07\uff0c\u516d\u7b14\u623f\u6b3e\u5df2\u7ed3\u6e05\uff1b\u8fc7\u6237\u7a0e135\u4e07\u53e6\u5217\u4ee3\u6536\u3002" }).eq("id", receivables[0].id),
  "update 111 receivable",
);
await checked(
  supabase.from("units").update({ notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u4e1a\u4e3bDOSSO\uff1b\u5408\u540c\u603b\u4ef76600\u4e07\uff0c\u65e0\u8f66\u4f4d\u8bb0\u5f55\uff1b\u5df2\u7ed3\u6e05\uff1b\u8fc7\u6237\u7a0e135\u4e07\u53e6\u5217\u4ee3\u6536\u3002" }).eq("id", unit.id),
  "update unit 111 note",
);
await checked(
  supabase.from("audit_logs").insert({ action: "reconcile_floor_lease_sale_data", entity_type: "building", entity_id: building.id, metadata: { building_code: "SACSI4", unit: "111", sale_total_xof: 66_000_000, sale_payment_count: 6, sale_settled: true, transfer_tax_collected_xof: 1_350_000 } }),
  "write audit log",
);

console.log(JSON.stringify({ ok: true, unit: "111", saleTotal: 66_000_000, salePaid: 66_000_000, transferTax: 1_350_000, settled: true }));
