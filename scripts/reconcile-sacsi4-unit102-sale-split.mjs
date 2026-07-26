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
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function checked(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI4").single(), "load building");
const unit = await checked(
  supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "102").single(),
  "load unit 102",
);
const sale = await checked(
  supabase.from("sale_contracts").select("id, customer_id, signed_date, total_amount_xof").eq("unit_id", unit.id).single(),
  "load 102 sale",
);
if (sale.signed_date !== "2023-12-28" || Number(sale.total_amount_xof) !== 88_000_000) {
  throw new Error(`Unexpected 102 sale: ${sale.signed_date} / ${sale.total_amount_xof}`);
}

await checked(
  supabase.from("sale_contracts").update({
    payment_plan_type: "\u5408\u540c\u603b\u4ef78800\u4e07\uff0c\u5df2\u7ed3\u6e05\uff1b\u4eba\u6c11\u5e0120\u4e07\u5b9a\u91d1\u6298\u54081808\u4e07XOF\uff0c\u6c47\u738790.4\u4e3a\u6309\u5408\u540c\u603b\u4ef7\u4e0e6992\u4e07XOF\u623f\u6b3e\u5012\u63a8\u503c\u3002",
  }).eq("id", sale.id),
  "update 102 payment plan note",
);

const knownReceipts = ["WB4-SALE-102-CONSOLIDATED", "WB4-SALE-102-20231228-DEPOSIT-01"];
const depositRows = await checked(
  supabase.from("payments").select("id").eq("source_id", sale.id).in("receipt_no", knownReceipts),
  "find 102 deposit payment",
);
if (depositRows.length !== 1) throw new Error(`Expected one 102 deposit candidate, got ${depositRows.length}`);
const depositId = depositRows[0].id;
const depositNotes = "102\u8d2d\u623f\u5b9a\u91d1CNY 200000\uff0c\u6298\u54081808\u4e07FCFA\uff1b\u6c47\u738790.4\u7531\u5408\u540c\u603b\u4ef78800\u4e07\u51cf\u53bb\u7b2c\u4e8c\u7b146992\u4e07\u5012\u63a8\u3002";
await checked(
  supabase.from("payments").update({
    customer_id: sale.customer_id,
    unit_id: unit.id,
    source_type: "sale_contract",
    source_id: sale.id,
    payment_date: "2023-12-28",
    amount: 200_000,
    currency: "CNY",
    exchange_rate_to_xof: 90.4,
    receipt_no: "WB4-SALE-102-20231228-DEPOSIT-01",
    notes: depositNotes,
  }).eq("id", depositId),
  "update 102 deposit payment",
);
const depositLedgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", depositId), "load 102 deposit ledger");
if (depositLedgers.length !== 1) throw new Error(`Expected one 102 deposit ledger, got ${depositLedgers.length}`);
await checked(
  supabase.from("ledger_entries").update({
    building_id: building.id,
    unit_id: unit.id,
    entry_date: "2023-12-28",
    direction: "income",
    category: "sale",
    amount_xof: 18_080_000,
    amount_cny: 200_000,
    description: depositNotes,
  }).eq("id", depositLedgers[0].id),
  "update 102 deposit ledger",
);

const houseReceipt = "WB4-SALE-102-20240130-HOUSE-02";
const houseNotes = "102\u7b2c\u4e8c\u7b14\u623f\u6b3e6992\u4e07FCFA\uff1b\u4e0e\u4eba\u6c11\u5e0120\u4e07\u5b9a\u91d1\u6298\u5408\u989d\u5171\u8ba18800\u4e07\uff0c\u5df2\u7ed3\u6e05\u3002";
const housePayload = {
  customer_id: sale.customer_id,
  unit_id: unit.id,
  source_type: "sale_contract",
  source_id: sale.id,
  payment_date: "2024-01-30",
  amount: 69_920_000,
  currency: "XOF",
  exchange_rate_to_xof: 1,
  receipt_no: houseReceipt,
  notes: houseNotes,
};
const houseRows = await checked(supabase.from("payments").select("id").eq("source_id", sale.id).eq("receipt_no", houseReceipt), "find 102 house payment");
if (houseRows.length > 1) throw new Error(`Duplicate 102 house payments: ${houseRows.length}`);
const houseId = houseRows.length === 1
  ? houseRows[0].id
  : (await checked(supabase.from("payments").insert(housePayload).select("id").single(), "insert 102 house payment")).id;
if (houseRows.length === 1) await checked(supabase.from("payments").update(housePayload).eq("id", houseId), "update 102 house payment");

const houseLedgerPayload = {
  building_id: building.id,
  unit_id: unit.id,
  payment_id: houseId,
  entry_date: "2024-01-30",
  direction: "income",
  category: "sale",
  amount_xof: 69_920_000,
  amount_cny: null,
  description: houseNotes,
};
const houseLedgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", houseId), "find 102 house ledger");
if (houseLedgers.length > 1) throw new Error(`Duplicate 102 house ledgers: ${houseLedgers.length}`);
if (houseLedgers.length === 1) await checked(supabase.from("ledger_entries").update(houseLedgerPayload).eq("id", houseLedgers[0].id), "update 102 house ledger");
else await checked(supabase.from("ledger_entries").insert(houseLedgerPayload), "insert 102 house ledger");

const receivables = await checked(
  supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum"),
  "load 102 sale receivable",
);
if (receivables.length !== 1) throw new Error(`Expected one 102 sale receivable, got ${receivables.length}`);
await checked(
  supabase.from("receivables").update({
    amount_xof: 88_000_000,
    paid_amount_xof: 88_000_000,
    status: "paid",
    notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx Sheet1\uff1b\u5b9a\u91d1CNY 200000\u4e0e\u623f\u6b3e6992\u4e07FCFA\u5206\u5217\uff0c\u5408\u540c\u5df2\u7ed3\u6e05\u3002",
  }).eq("id", receivables[0].id),
  "update 102 sale receivable",
);

const finalPayments = await checked(
  supabase.from("payments").select("receipt_no, amount, currency, exchange_rate_to_xof").eq("source_id", sale.id).order("payment_date"),
  "verify 102 payments",
);
if (finalPayments.length !== 2) throw new Error(`Expected two 102 sale payments, got ${finalPayments.length}`);
const paidXof = finalPayments.reduce((sum, payment) => sum + (payment.currency === "XOF"
  ? Number(payment.amount)
  : Math.round(Number(payment.amount) * Number(payment.exchange_rate_to_xof))), 0);
if (paidXof !== 88_000_000) throw new Error(`Unexpected 102 converted payment total ${paidXof}`);

await checked(supabase.from("audit_logs").insert({
  action: "reconcile_sale_payment_split",
  entity_type: "sale_contract",
  entity_id: sale.id,
  metadata: {
    building_code: "SACSI4",
    unit: "102",
    contract_total_xof: 88_000_000,
    deposit_cny: 200_000,
    inferred_deposit_rate_to_xof: 90.4,
    deposit_xof: 18_080_000,
    house_payment_xof: 69_920_000,
    settled: true,
  },
}), "write 102 audit log");

console.log(JSON.stringify({ ok: true, unit: "102", paidXof, payments: finalPayments }));
