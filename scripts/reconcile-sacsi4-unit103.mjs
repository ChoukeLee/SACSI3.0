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
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "103").single(), "load unit 103");
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, signed_date").eq("unit_id", unit.id).single(), "load 103 sale");
if (sale.signed_date !== "2022-09-20") throw new Error(`Unexpected 103 sale date ${sale.signed_date}`);

await checked(
  supabase.from("sale_contracts").update({
    contract_no: "WB-SALE-SACSI4-103-20220920",
    total_amount_xof: 65_000_000,
    payment_plan_type: "\u5408\u540c\u603b\u4ef76500\u4e07\u5df2\u5305\u542b\u8f66\u4f4d\uff1b\u623f\u6b3e6000\u4e07+\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5df2\u7ed3\u6e05\u3002",
  }).eq("id", sale.id),
  "update 103 sale",
);

const consolidated = await checked(supabase.from("payments").select("id").eq("source_id", sale.id).eq("receipt_no", "S4-SALE-103-CONSOLIDATED").single(), "load 103 consolidated payment");
await checked(
  supabase.from("payments").update({
    source_type: "sale_contract",
    payment_date: "2022-09-20",
    amount: 60_000_000,
    receipt_no: "WB4-SALE-103-20220920-HOUSE-01",
    notes: "103\u623f\u6b3e6000\u4e07\uff1b\u539f6500\u4e07\u6c47\u603b\u6536\u6b3e\u62c6\u5206\uff1b\u5408\u540c\u603b\u4ef76500\u4e07\u5df2\u5305\u542b\u8f66\u4f4d\u3002",
  }).eq("id", consolidated.id),
  "split 103 house payment",
);
await checked(
  supabase.from("ledger_entries").update({
    unit_id: unit.id,
    direction: "income",
    category: "sale",
    amount_xof: 60_000_000,
    amount_cny: null,
    description: "103\u623f\u6b3e6000\u4e07\uff1b\u5408\u540c\u603b\u4ef7\u5df2\u5305\u542b\u8f66\u4f4d\u3002",
  }).eq("payment_id", consolidated.id),
  "update 103 house ledger",
);

const parkingReceipt = "WB4-SALE-103-20220920-PARKING-01";
const parkingPayload = {
  customer_id: sale.customer_id,
  unit_id: unit.id,
  source_type: "sale_contract",
  source_id: sale.id,
  payment_date: "2022-09-20",
  amount: 5_000_000,
  currency: "XOF",
  exchange_rate_to_xof: 1,
  receipt_no: parkingReceipt,
  notes: "103\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5df2\u5305\u542b\u57286500\u4e07\u5408\u540c\u603b\u4ef7\u5185\uff1b\u5df2\u7ed3\u6e05\u3002",
};
const parkingRows = await checked(supabase.from("payments").select("id").eq("source_id", sale.id).eq("receipt_no", parkingReceipt), "find 103 parking payment");
if (parkingRows.length > 1) throw new Error(`Duplicate 103 parking payments: ${parkingRows.length}`);
let parkingId;
if (parkingRows.length === 1) {
  parkingId = parkingRows[0].id;
  await checked(supabase.from("payments").update(parkingPayload).eq("id", parkingId), "update 103 parking payment");
} else {
  const inserted = await checked(supabase.from("payments").insert(parkingPayload).select("id").single(), "insert 103 parking payment");
  parkingId = inserted.id;
}
const parkingLedgerPayload = {
  building_id: building.id,
  unit_id: unit.id,
  payment_id: parkingId,
  entry_date: "2022-09-20",
  direction: "income",
  category: "sale",
  amount_xof: 5_000_000,
  amount_cny: null,
  description: "103\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5df2\u5305\u542b\u5728\u5408\u540c\u603b\u4ef7\u5185\u3002",
};
const parkingLedgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", parkingId), "find 103 parking ledger");
if (parkingLedgers.length > 1) throw new Error(`Duplicate 103 parking ledgers: ${parkingLedgers.length}`);
if (parkingLedgers.length === 1) await checked(supabase.from("ledger_entries").update(parkingLedgerPayload).eq("id", parkingLedgers[0].id), "update 103 parking ledger");
else await checked(supabase.from("ledger_entries").insert(parkingLedgerPayload), "insert 103 parking ledger");

const receivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum"), "load 103 receivable");
if (receivables.length !== 1) throw new Error(`Expected one 103 receivable, got ${receivables.length}`);
await checked(
  supabase.from("receivables").update({
    amount_xof: 65_000_000,
    paid_amount_xof: 65_000_000,
    status: "paid",
    notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx Sheet1\uff1b\u5408\u540c\u603b\u4ef76500\u4e07\u5df2\u5305\u542b\u8f66\u4f4d\uff1b\u623f\u6b3e6000\u4e07+\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5df2\u7ed3\u6e05\u3002",
  }).eq("id", receivables[0].id),
  "update 103 receivable",
);
await checked(
  supabase.from("units").update({ notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u4e1a\u4e3b\u5218\u4e03\u82b9\uff1b\u5408\u540c\u603b\u4ef76500\u4e07\u5df2\u5305\u542b\u8f66\u4f4d\uff1b\u623f\u6b3e6000\u4e07+\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5df2\u7ed3\u6e05\u3002" }).eq("id", unit.id),
  "update unit 103 note",
);
await checked(
  supabase.from("audit_logs").insert({
    action: "reconcile_floor_lease_sale_data",
    entity_type: "building",
    entity_id: building.id,
    metadata: { building_code: "SACSI4", unit: "103", total_xof: 65_000_000, house_xof: 60_000_000, parking_xof: 5_000_000, settled: true },
  }),
  "write audit log",
);

console.log(JSON.stringify({ ok: true, unit: "103", total: 65_000_000, house: 60_000_000, parking: 5_000_000, settled: true }));
