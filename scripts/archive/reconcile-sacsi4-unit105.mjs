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
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "105").single(), "load unit 105");
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, signed_date").eq("unit_id", unit.id).single(), "load 105 sale");
if (sale.signed_date !== "2020-12-24") throw new Error(`Unexpected 105 sale date ${sale.signed_date}`);
await checked(
  supabase.from("sale_contracts").update({
    contract_no: "WB-SALE-SACSI4-105-20201224",
    total_amount_xof: 55_000_000,
    payment_plan_type: "\u623f\u6b3e5000\u4e07+\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5408\u540c\u603b\u4ef75500\u4e07\uff1b\u4e09\u7b14\u6536\u6b3e\u5df2\u7ed3\u6e05\u3002",
  }).eq("id", sale.id),
  "update 105 sale",
);

const consolidated = await checked(supabase.from("payments").select("id").eq("source_id", sale.id).eq("receipt_no", "S4-SALE-105-CONSOLIDATED").single(), "load 105 consolidated payment");
await checked(
  supabase.from("payments").update({ source_type: "sale_contract", payment_date: "2021-03-01", amount: 45_000_000, receipt_no: "WB4-SALE-105-20210301-HOUSE-02", notes: "105\u7b2c\u4e8c\u7b14\u623f\u6b3e4500\u4e07\uff1b\u8f66\u4f4d\u6b3e500\u4e07\u53e6\u5217\u3002" }).eq("id", consolidated.id),
  "update 105 second house payment",
);
await checked(
  supabase.from("ledger_entries").update({ unit_id: unit.id, direction: "income", category: "sale", amount_xof: 45_000_000, amount_cny: null, description: "105\u7b2c\u4e8c\u7b14\u623f\u6b3e4500\u4e07\u3002" }).eq("payment_id", consolidated.id),
  "update 105 second house ledger",
);

const extraPayments = [
  { date: "2020-12-24", amount: 5_000_000, receipt: "WB4-SALE-105-20201224-HOUSE-01", notes: "105\u7b2c\u4e00\u7b14\u623f\u6b3e500\u4e07\u3002" },
  { date: "2021-03-17", amount: 5_000_000, receipt: "WB4-SALE-105-20210317-PARKING-01", notes: "105\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u57285000\u4e07\u623f\u6b3e\u4e4b\u5916\u5355\u5217\uff1b\u5df2\u7ed3\u6e05\u3002" },
];
for (const entry of extraPayments) {
  const payload = { customer_id: sale.customer_id, unit_id: unit.id, source_type: "sale_contract", source_id: sale.id, payment_date: entry.date, amount: entry.amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: entry.receipt, notes: entry.notes };
  const rows = await checked(supabase.from("payments").select("id").eq("source_id", sale.id).eq("receipt_no", entry.receipt), `find ${entry.receipt}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${entry.receipt}`);
  let paymentId;
  if (rows.length === 1) {
    paymentId = rows[0].id;
    await checked(supabase.from("payments").update(payload).eq("id", paymentId), `update ${entry.receipt}`);
  } else {
    const inserted = await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${entry.receipt}`);
    paymentId = inserted.id;
  }
  const ledgerPayload = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: entry.date, direction: "income", category: "sale", amount_xof: entry.amount, amount_cny: null, description: entry.notes };
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${entry.receipt}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${entry.receipt}`);
  if (ledgers.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgers[0].id), `update ledger ${entry.receipt}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${entry.receipt}`);
}

const receivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum"), "load 105 receivable");
if (receivables.length !== 1) throw new Error(`Expected one 105 receivable, got ${receivables.length}`);
await checked(
  supabase.from("receivables").update({ amount_xof: 55_000_000, paid_amount_xof: 55_000_000, status: "paid", notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx Sheet1\uff1b\u623f\u6b3e5000\u4e07+\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5408\u540c\u603b\u4ef75500\u4e07\uff1b\u4e09\u7b14\u6536\u6b3e\u5df2\u7ed3\u6e05\u3002" }).eq("id", receivables[0].id),
  "update 105 receivable",
);
await checked(
  supabase.from("units").update({ notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u4e1a\u4e3b\u5f90\u4fc4\u84c9\uff1b\u623f\u6b3e5000\u4e07+\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5408\u540c\u603b\u4ef75500\u4e07\uff1b\u5df2\u7ed3\u6e05\u3002" }).eq("id", unit.id),
  "update unit 105 note",
);
await checked(
  supabase.from("audit_logs").insert({ action: "reconcile_floor_lease_sale_data", entity_type: "building", entity_id: building.id, metadata: { building_code: "SACSI4", unit: "105", total_xof: 55_000_000, house_xof: 50_000_000, parking_xof: 5_000_000, payment_count: 3, settled: true } }),
  "write audit log",
);

console.log(JSON.stringify({ ok: true, unit: "105", total: 55_000_000, house: 50_000_000, parking: 5_000_000, settled: true }));
