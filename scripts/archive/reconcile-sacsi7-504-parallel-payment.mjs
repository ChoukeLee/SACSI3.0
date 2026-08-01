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

const building = await checked(
  supabase.from("buildings").select("id").eq("code", "SACSI7").single(),
  "load building",
);
const unit = await checked(
  supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "504").single(),
  "load unit",
);
const contract = await checked(
  supabase.from("sale_contracts").select("id, customer_id").eq("unit_id", unit.id).eq("status", "active").single(),
  "load contract",
);

const paymentBase = {
  customer_id: contract.customer_id,
  unit_id: unit.id,
  source_type: "sale_contract",
  source_id: contract.id,
  currency: "XOF",
  exchange_rate_to_xof: 1,
};

async function upsertPayment(receiptNo, data) {
  const rows = await checked(
    supabase.from("payments").select("id").eq("source_id", contract.id).eq("receipt_no", receiptNo).limit(1),
    `find ${receiptNo}`,
  );
  if (rows.length > 0) {
    await checked(supabase.from("payments").update({ ...paymentBase, ...data, receipt_no: receiptNo }).eq("id", rows[0].id), `update ${receiptNo}`);
    return rows[0].id;
  }
  const row = await checked(
    supabase.from("payments").insert({ ...paymentBase, ...data, receipt_no: receiptNo }).select("id").single(),
    `insert ${receiptNo}`,
  );
  return row.id;
}

async function upsertLedger(paymentId, data) {
  const rows = await checked(
    supabase.from("ledger_entries").select("id").eq("payment_id", paymentId).limit(1),
    `find ledger ${paymentId}`,
  );
  const payload = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, direction: "income", category: "sale", amount_cny: null, ...data };
  if (rows.length > 0) {
    await checked(supabase.from("ledger_entries").update(payload).eq("id", rows[0].id), `update ledger ${paymentId}`);
  } else {
    await checked(supabase.from("ledger_entries").insert(payload), `insert ledger ${paymentId}`);
  }
}

const cashReceipt = "WB7-S-504-20241121-SALE-02";
const cashRows = await checked(
  supabase.from("payments").select("id").eq("source_id", contract.id).eq("receipt_no", cashReceipt).single(),
  "load cash payment",
);
await checked(
  supabase.from("payments").update({
    amount: 45_000_000,
    notes: "504\u73b0\u91d1\u623f\u6b3e4500\u4e07\uff1b\u4e0e\u540c\u65e5\u5b58SACSI\u8d26\u62372500\u4e07\u4e3a\u5e76\u5217\u6536\u6b3e",
  }).eq("id", cashRows.id),
  "update cash payment",
);
await upsertLedger(cashRows.id, {
  entry_date: "2024-11-21",
  amount_xof: 45_000_000,
  description: "504 \u73b0\u91d1\u623f\u6b3e4500\u4e07",
});

const accountPaymentId = await upsertPayment("WB7-S-504-20241121-SACSI-01", {
  payment_date: "2024-11-21",
  amount: 25_000_000,
  notes: "504\u5b58\u5165SACSI\u8d26\u6237\u623f\u6b3e2500\u4e07\uff1b\u4e0e\u540c\u65e5\u73b0\u91d14500\u4e07\u4e3a\u5e76\u5217\u6536\u6b3e",
});
await upsertLedger(accountPaymentId, {
  entry_date: "2024-11-21",
  amount_xof: 25_000_000,
  description: "504 \u5b58\u5165SACSI\u8d26\u6237\u623f\u6b3e2500\u4e07",
});

const finalHouseReceipt = "WB7-S-504-20241122-SALE-03";
const finalHouseRows = await checked(
  supabase.from("payments").select("id").eq("source_id", contract.id).eq("receipt_no", finalHouseReceipt).single(),
  "load final house payment",
);
await checked(
  supabase.from("payments").update({
    amount: 19_000_000,
    notes: "504\u672b\u7b14\u623f\u6b3e1900\u4e07\uff1b\u539f2900\u4e07\u6536\u6b3e\u62c6\u5206",
  }).eq("id", finalHouseRows.id),
  "split final house payment",
);
await upsertLedger(finalHouseRows.id, {
  entry_date: "2024-11-22",
  amount_xof: 19_000_000,
  description: "504 \u623f\u6b3e1900\u4e07",
});

const parkingPaymentId = await upsertPayment("WB7-S-504-20241122-PARKING-01", {
  payment_date: "2024-11-22",
  amount: 10_000_000,
  notes: "504\u8f66\u4f4d\u6b3e1000\u4e07\uff1b\u4ece\u539f2900\u4e07\u6536\u6b3e\u4e2d\u62c6\u5206",
});
await upsertLedger(parkingPaymentId, {
  entry_date: "2024-11-22",
  amount_xof: 10_000_000,
  description: "504 \u8f66\u4f4d\u6b3e1000\u4e07",
});

const plan = "\u623f\u6b3e10400\u4e07+\u8f66\u4f4d\u6b3e1000\u4e07\uff1b\u5408\u540c\u603b\u989d11400\u4e07\uff1b\u5df2\u653611400\u4e07\uff0c\u5df2\u7ed3\u6e05\uff1b\u6ce8\u518c\u91d125\u4e07\u548c\u4e2d\u4ecb\u8d3975\u4e07\u53e6\u5217";
await checked(
  supabase.from("sale_contracts").update({ payment_plan_type: plan, total_amount_xof: 114_000_000 }).eq("id", contract.id),
  "update contract",
);
await checked(
  supabase.from("receivables").update({
    paid_amount_xof: 114_000_000,
    status: "paid",
    notes: "\u6765\u6e90\uff1a7\u53f7\u516c\u5bd3.xlsx Sheet1 A1:J100\uff1b\u623f\u6b3e10400\u4e07+\u8f66\u4f4d\u6b3e1000\u4e07\uff1b2024-11-21\u73b0\u91d14500\u4e07\u4e0e\u5b58SACSI\u8d26\u62372500\u4e07\u4e3a\u5e76\u5217\u6536\u6b3e\uff1b\u5df2\u7ed3\u6e05",
  }).eq("source_id", contract.id).eq("category", "sale_lump_sum"),
  "settle receivable",
);

await checked(
  supabase.from("audit_logs").insert({
    action: "reconcile_parallel_sale_payment",
    entity_type: "sale_contract",
    entity_id: contract.id,
    metadata: {
      building_code: "SACSI7",
      unit_no: "504",
      total_amount_xof: 114_000_000,
      house_amount_xof: 104_000_000,
      parking_amount_xof: 10_000_000,
      added_parallel_payment_xof: 25_000_000,
      status: "paid",
    },
  }),
  "write audit log",
);

console.log(JSON.stringify({ ok: true, unit: "504", paid: 114_000_000, status: "paid" }));
