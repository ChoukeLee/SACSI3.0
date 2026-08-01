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
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "202").single(), "load unit 202");
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, signed_date").eq("unit_id", unit.id).single(), "load 202 sale");
if (sale.signed_date !== "2024-11-23") throw new Error(`Unexpected 202 sale date ${sale.signed_date}`);
await checked(
  supabase.from("sale_contracts").update({ contract_no: "WB-SALE-SACSI4-202-20241123", total_amount_xof: 100_000_000, payment_plan_type: "\u5408\u540c\u603b\u4ef710000\u4e07\uff0c\u65e0\u8f66\u4f4d\u8bb0\u5f55\uff1b2024-11-23\u4e00\u6b21\u4ed8\u6e05\u3002" }).eq("id", sale.id),
  "update 202 sale",
);
const salePayment = await checked(supabase.from("payments").select("id").eq("source_id", sale.id).eq("receipt_no", "S4-SALE-202-CONSOLIDATED").single(), "load 202 sale payment");
await checked(
  supabase.from("payments").update({ source_type: "sale_contract", payment_date: "2024-11-23", amount: 100_000_000, receipt_no: "WB4-SALE-202-20241123-HOUSE-01", notes: "202\u623f\u6b3e10000\u4e07\uff0c\u65e0\u8f66\u4f4d\u8bb0\u5f55\uff0c\u5df2\u7ed3\u6e05\u3002" }).eq("id", salePayment.id),
  "update 202 sale payment",
);
await checked(
  supabase.from("ledger_entries").update({ unit_id: unit.id, direction: "income", category: "sale", amount_xof: 100_000_000, amount_cny: null, description: "202\u623f\u6b3e10000\u4e07\uff0c\u5df2\u7ed3\u6e05\u3002" }).eq("payment_id", salePayment.id),
  "update 202 sale ledger",
);
const saleReceivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum"), "load 202 sale receivable");
if (saleReceivables.length !== 1) throw new Error(`Expected one 202 sale receivable, got ${saleReceivables.length}`);
await checked(
  supabase.from("receivables").update({ amount_xof: 100_000_000, paid_amount_xof: 100_000_000, status: "paid", notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx Sheet1\uff1b\u5408\u540c\u603b\u4ef710000\u4e07\uff0c\u65e0\u8f66\u4f4d\u8bb0\u5f55\uff1b\u5df2\u7ed3\u6e05\u3002" }).eq("id", saleReceivables[0].id),
  "update 202 sale receivable",
);

const lease = await checked(supabase.from("lease_contracts").select("id, customer_id, start_date").eq("unit_id", unit.id).single(), "load 202 lease");
if (lease.start_date !== "2022-08-18") throw new Error(`Unexpected 202 lease date ${lease.start_date}`);
await checked(
  supabase.from("lease_contracts").update({ contract_no: "WB-LEASE-SACSI4-202-20220818", expected_end_date: "2026-08-17", actual_end_date: null, payment_cycle: "semiannual", payment_day: 18, monthly_rent_xof: 600_000, deposit_amount_xof: 1_200_000, deposit_received: true, status: "active", expected_end_confirmed: false, paid_through_date: "2026-08-17" }).eq("id", lease.id),
  "update 202 lease",
);

const entries = [
  { date: "2022-08-18", amount: 1_200_000, type: "lease_deposit", direction: "liability_in", ledgerCategory: "lease_deposit", recCategory: "lease_deposit", receipt: "WB4-LEASE-202-20220818-DEPOSIT-01", title: "202\u62bc\u91d1", notes: "202\u62bc\u91d1120\u4e07\uff1b\u9996\u65e5\u4e24\u7b14\u6536\u6b3e300\u4e07+204\u4e07\u5408\u8ba1504\u4e07\u4e2d\u62c6\u5206\uff1b\u5f53\u524d\u4ecd\u5728\u79df\uff0c\u672a\u9000\u3002" },
];
const cycles = [
  { date: "2022-08-18", end: "2023-02-17", index: "01" },
  { date: "2023-03-01", end: "2023-08-17", index: "02" },
  { date: "2023-08-21", end: "2024-02-17", index: "03" },
  { date: "2024-02-14", end: "2024-08-17", index: "04" },
  { date: "2024-08-15", end: "2025-02-17", index: "05" },
  { date: "2025-02-17", end: "2025-08-17", index: "06" },
  { date: "2025-08-13", end: "2026-02-17", index: "07" },
  { date: "2026-02-11", end: "2026-08-17", index: "08", oldReceipt: "WB4-L-202-20260211-RENT" },
];
for (const cycle of cycles) {
  const compact = cycle.date.replaceAll("-", "");
  entries.push(
    { date: cycle.date, amount: 3_600_000, type: "lease_rent", direction: "income", ledgerCategory: "lease_rent", recCategory: "lease_rent", receipt: `WB4-LEASE-202-${compact}-RENT-${cycle.index}`, oldReceipt: cycle.oldReceipt, title: "202\u5386\u53f2\u79df\u91d1", notes: `202\u79df\u91d1360\u4e07\uff0c\u5df2\u7f34\u81f3${cycle.end}\u3002` },
    { date: cycle.date, amount: 240_000, type: "property_fee", direction: "income", ledgerCategory: "property_fee", recCategory: "other", receipt: `WB4-LEASE-202-${compact}-PROP-${cycle.index}`, title: "202\u5386\u53f2\u7269\u4e1a\u8d39", notes: `202\u7269\u4e1a\u8d3924\u4e07\uff0c\u5df2\u7f34\u81f3${cycle.end}\u3002` },
  );
}

for (const entry of entries) {
  let rows = await checked(supabase.from("payments").select("id").eq("source_id", lease.id).eq("receipt_no", entry.receipt), `find ${entry.receipt}`);
  if (rows.length === 0 && entry.oldReceipt) rows = await checked(supabase.from("payments").select("id").eq("source_id", lease.id).eq("receipt_no", entry.oldReceipt), `find old ${entry.oldReceipt}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${entry.receipt}`);
  const paymentPayload = { customer_id: lease.customer_id, unit_id: unit.id, source_type: entry.type, source_id: lease.id, payment_date: entry.date, amount: entry.amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: entry.receipt, notes: entry.notes };
  let paymentId;
  if (rows.length === 1) {
    paymentId = rows[0].id;
    await checked(supabase.from("payments").update(paymentPayload).eq("id", paymentId), `update ${entry.receipt}`);
  } else {
    const inserted = await checked(supabase.from("payments").insert(paymentPayload).select("id").single(), `insert ${entry.receipt}`);
    paymentId = inserted.id;
  }
  const ledgerPayload = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: entry.date, direction: entry.direction, category: entry.ledgerCategory, amount_xof: entry.amount, amount_cny: null, description: entry.notes };
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${entry.receipt}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${entry.receipt}`);
  if (ledgers.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgers[0].id), `update ledger ${entry.receipt}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${entry.receipt}`);
  const recPayload = { building_id: building.id, unit_id: unit.id, customer_id: lease.customer_id, source_type: "lease_contract", source_id: lease.id, category: entry.recCategory, title: entry.title, due_date: entry.date, amount_xof: entry.amount, paid_amount_xof: entry.amount, status: "paid", currency: "XOF", notes: entry.notes };
  const recs = await checked(supabase.from("receivables").select("id").eq("source_id", lease.id).eq("notes", entry.notes), `find receivable ${entry.receipt}`);
  if (recs.length > 1) throw new Error(`Duplicate receivable ${entry.receipt}`);
  if (recs.length === 1) await checked(supabase.from("receivables").update(recPayload).eq("id", recs[0].id), `update receivable ${entry.receipt}`);
  else await checked(supabase.from("receivables").insert(recPayload), `insert receivable ${entry.receipt}`);
}

await checked(
  supabase.from("units").update({ status: "sold", notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u4e1a\u4e3bBAMARA BABA\uff0c\u51fa\u552e10000\u4e07\u65e0\u8f66\u4f4d\uff0c\u5df2\u7ed3\u6e05\uff1b\u59da\u4e3d\u6615\uff0f\u6df1\u5733\u597d\u5229\u822a\u4ecd\u5728\u79df\uff0c\u6708\u79df60\u4e07\u3001\u7269\u4e1a\u8d394\u4e07\uff0c\u5df2\u7f34\u81f32026-08-17\u3002" }).eq("id", unit.id),
  "update unit 202 note",
);
await checked(
  supabase.from("audit_logs").insert({ action: "reconcile_floor_lease_sale_data", entity_type: "building", entity_id: building.id, metadata: { building_code: "SACSI4", unit: "202", sale_total_xof: 100_000_000, sale_settled: true, lease_active: true, lease_rent_received_xof: 28_800_000, property_fee_received_xof: 1_920_000, deposit_held_xof: 1_200_000, paid_through_date: "2026-08-17" } }),
  "write audit log",
);

console.log(JSON.stringify({ ok: true, sale: { total: 100_000_000, settled: true }, lease: { rent: 28_800_000, property: 1_920_000, depositHeld: 1_200_000, paidThrough: "2026-08-17" } }));
