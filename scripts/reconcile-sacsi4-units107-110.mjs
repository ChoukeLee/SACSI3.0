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
const units = await checked(supabase.from("units").select("id, unit_no").eq("building_id", building.id).in("unit_no", ["107", "108", "109", "110"]), "load units");
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));
for (const unitNo of ["107", "108", "109", "110"]) if (!unitByNo[unitNo]) throw new Error(`Missing unit ${unitNo}`);

const existingSales = await checked(supabase.from("sale_contracts").select("id, unit_id, customer_id").in("unit_id", units.map((unit) => unit.id)), "load existing sales");
const saleByNo = Object.fromEntries(existingSales.map((sale) => [units.find((unit) => unit.id === sale.unit_id)?.unit_no, sale]));
if (!saleByNo["107"] || !saleByNo["109"]) throw new Error("Missing existing sale 107 or 109");

async function ensureSale(unitNo, customerId, payload) {
  const current = saleByNo[unitNo];
  if (current) {
    if (current.customer_id !== customerId) throw new Error(`${unitNo} buyer mismatch`);
    await checked(supabase.from("sale_contracts").update(payload).eq("id", current.id), `update sale ${unitNo}`);
    return current.id;
  }
  const inserted = await checked(
    supabase.from("sale_contracts").insert({ unit_id: unitByNo[unitNo].id, customer_id: customerId, ...payload }).select("id").single(),
    `insert sale ${unitNo}`,
  );
  return inserted.id;
}

const wangId = saleByNo["107"].customer_id;
const songId = saleByNo["109"].customer_id;
const saleIds = {
  "107": await ensureSale("107", wangId, { contract_no: "WB-SALE-SACSI4-107-20200510", signed_date: "2020-05-10", transfer_status: "not_started", agency_commission_paid: false, payment_plan_type: "\u623f\u6b3e5000\u4e07+\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5408\u540c\u603b\u4ef75500\u4e07\uff1b\u4e0e108\u8054\u5408\u6536\u6b3e\u5df2\u62c6\u5206\uff1b\u5df2\u7ed3\u6e05\u3002", total_amount_xof: 55_000_000, status: "active" }),
  "108": await ensureSale("108", wangId, { contract_no: "WB-SALE-SACSI4-108-20200510", signed_date: "2020-05-10", transfer_status: "not_started", agency_commission_paid: false, payment_plan_type: "\u623f\u6b3e6500\u4e07\uff1b\u4e0e107\u8054\u5408\u6536\u6b3e\u5df2\u62c6\u5206\uff1b\u5df2\u7ed3\u6e05\u3002", total_amount_xof: 65_000_000, status: "active" }),
  "109": await ensureSale("109", songId, { contract_no: "WB-SALE-SACSI4-109-20210808", signed_date: "2021-08-08", transfer_status: "not_started", agency_commission_paid: false, payment_plan_type: "\u5408\u540c\u603b\u4ef76000\u4e07\u5df2\u5305\u542b\u8f66\u4f4d\uff1b\u623f\u6b3e5500\u4e07+\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5df2\u7ed3\u6e05\u3002", total_amount_xof: 60_000_000, status: "active" }),
  "110": await ensureSale("110", songId, { contract_no: "WB-SALE-SACSI4-110-20200509", signed_date: "2020-05-09", transfer_status: "not_started", agency_commission_paid: false, payment_plan_type: "\u623f\u6b3e6500\u4e07+\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5408\u540c\u603b\u4ef77000\u4e07\uff1b\u4e09\u7b14\u6536\u6b3e\u5df2\u7ed3\u6e05\u3002", total_amount_xof: 70_000_000, status: "active" }),
};

async function upsertPayment(spec) {
  let rows = await checked(supabase.from("payments").select("id").eq("source_id", saleIds[spec.unitNo]).eq("receipt_no", spec.receipt), `find ${spec.receipt}`);
  if (rows.length === 0 && spec.oldReceipts) rows = await checked(supabase.from("payments").select("id").eq("source_id", saleIds[spec.unitNo]).in("receipt_no", spec.oldReceipts), `find old ${spec.receipt}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${spec.receipt}`);
  const customerId = ["107", "108"].includes(spec.unitNo) ? wangId : songId;
  const payload = { customer_id: customerId, unit_id: unitByNo[spec.unitNo].id, source_type: "sale_contract", source_id: saleIds[spec.unitNo], payment_date: spec.date, amount: spec.amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: spec.receipt, notes: spec.notes };
  let paymentId;
  if (rows.length === 1) {
    paymentId = rows[0].id;
    await checked(supabase.from("payments").update(payload).eq("id", paymentId), `update ${spec.receipt}`);
  } else {
    const inserted = await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${spec.receipt}`);
    paymentId = inserted.id;
  }
  const ledgerPayload = { building_id: building.id, unit_id: unitByNo[spec.unitNo].id, payment_id: paymentId, entry_date: spec.date, direction: "income", category: "sale", amount_xof: spec.amount, amount_cny: null, description: spec.notes };
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${spec.receipt}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${spec.receipt}`);
  if (ledgers.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgers[0].id), `update ledger ${spec.receipt}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${spec.receipt}`);
}

const paymentSpecs = [
  { unitNo: "107", date: "2020-05-10", amount: 20_000_000, receipt: "WB4-SALE-107-20200510-HOUSE-01", notes: "107\u7b2c\u4e00\u7b14\u623f\u6b3e2000\u4e07\uff1b\u4e0e108\u5408\u5e76\u6838\u7b97\u3002" },
  { unitNo: "107", date: "2020-05-16", amount: 30_000_000, receipt: "WB4-SALE-107-20200516-HOUSE-02", notes: "107\u623f\u6b3e3000\u4e07\uff1b\u4ece107/108\u8054\u54085000\u4e07\u6536\u6b3e\u4e2d\u62c6\u5206\u3002" },
  { unitNo: "108", date: "2020-05-16", amount: 20_000_000, receipt: "WB4-SALE-108-20200516-HOUSE-01", notes: "108\u623f\u6b3e2000\u4e07\uff1b\u4ece107/108\u8054\u54085000\u4e07\u6536\u6b3e\u4e2d\u62c6\u5206\u3002" },
  { unitNo: "108", date: "2020-05-26", amount: 45_000_000, receipt: "WB4-SALE-108-20200526-HOUSE-02", notes: "108\u623f\u6b3e4500\u4e07\uff1b\u5df2\u7ed3\u6e05\u3002" },
  { unitNo: "107", date: "2022-10-03", amount: 5_000_000, receipt: "WB4-SALE-107-20221003-PARKING-01", notes: "107\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u623f\u6b3e\u4e4b\u5916\u5355\u5217\uff1b\u5df2\u7ed3\u6e05\u3002" },
  { unitNo: "109", date: "2021-08-08", amount: 24_000_000, receipt: "WB4-SALE-109-20210808-HOUSE-01", oldReceipts: ["WB4-SALE-109-20210808-CONTRACT-01"], notes: "109\u7b2c\u4e00\u7b14\u623f\u6b3e2400\u4e07\u3002" },
  { unitNo: "109", date: "2021-08-12", amount: 15_000_000, receipt: "WB4-SALE-109-20210812-HOUSE-02", oldReceipts: ["WB4-SALE-109-20210812-CONTRACT-02"], notes: "109\u7b2c\u4e8c\u7b14\u623f\u6b3e1500\u4e07\u3002" },
  { unitNo: "109", date: "2021-08-15", amount: 11_000_000, receipt: "WB4-SALE-109-20210815-HOUSE-03", oldReceipts: ["WB4-SALE-109-20210815-CONTRACT-03"], notes: "109\u7b2c\u4e09\u7b14\u623f\u6b3e1100\u4e07\u3002" },
  { unitNo: "109", date: "2021-09-07", amount: 5_000_000, receipt: "WB4-SALE-109-20210907-HOUSE-04", oldReceipts: ["S4-SALE-109-CONSOLIDATED", "WB4-SALE-109-20210907-CONTRACT-04"], notes: "109\u7b2c\u56db\u7b14\u623f\u6b3e500\u4e07\uff1b\u623f\u6b3e\u5408\u8ba15500\u4e07\u3002" },
  { unitNo: "109", date: "2021-09-07", amount: 5_000_000, receipt: "WB4-SALE-109-20210907-PARKING-01", notes: "109\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5df2\u5305\u542b\u57286000\u4e07\u5408\u540c\u603b\u4ef7\u5185\uff1b\u5df2\u7ed3\u6e05\u3002" },
  { unitNo: "110", date: "2020-05-09", amount: 25_000_000, receipt: "WB4-SALE-110-20200509-HOUSE-01", notes: "110\u7b2c\u4e00\u7b14\u623f\u6b3e2500\u4e07\u3002" },
  { unitNo: "110", date: "2020-05-13", amount: 40_000_000, receipt: "WB4-SALE-110-20200513-HOUSE-02", notes: "110\u7b2c\u4e8c\u7b14\u623f\u6b3e4000\u4e07\u3002" },
  { unitNo: "110", date: "2022-05-28", amount: 5_000_000, receipt: "WB4-SALE-110-20220528-PARKING-01", notes: "110\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u623f\u6b3e\u4e4b\u5916\u5355\u5217\uff1b\u5df2\u7ed3\u6e05\u3002" },
];
for (const spec of paymentSpecs) await upsertPayment(spec);

const receivableSpecs = {
  "107": { total: 55_000_000, notes: "\u623f\u6b3e5000\u4e07+\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u4e0e108\u8054\u5408\u6536\u6b3e\u5df2\u62c6\u5206\uff1b\u5df2\u7ed3\u6e05\u3002" },
  "108": { total: 65_000_000, notes: "\u623f\u6b3e6500\u4e07\uff1b\u4e0e107\u8054\u5408\u6536\u6b3e\u5df2\u62c6\u5206\uff1b\u5df2\u7ed3\u6e05\u3002" },
  "109": { total: 60_000_000, notes: "\u5408\u540c\u603b\u4ef76000\u4e07\u5df2\u5305\u542b\u8f66\u4f4d\uff1b\u623f\u6b3e5500\u4e07+\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5df2\u7ed3\u6e05\u3002" },
  "110": { total: 70_000_000, notes: "\u623f\u6b3e6500\u4e07+\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5df2\u7ed3\u6e05\u3002" },
};
for (const [unitNo, spec] of Object.entries(receivableSpecs)) {
  const rows = await checked(supabase.from("receivables").select("id").eq("source_id", saleIds[unitNo]).eq("category", "sale_lump_sum"), `find receivable ${unitNo}`);
  if (rows.length > 1) throw new Error(`Duplicate receivables for ${unitNo}`);
  const payload = { building_id: building.id, unit_id: unitByNo[unitNo].id, customer_id: ["107", "108"].includes(unitNo) ? wangId : songId, source_type: "sale_contract", source_id: saleIds[unitNo], category: "sale_lump_sum", title: `4\u53f7\u697c${unitNo}\u8d2d\u623f\u6b3e`, due_date: { "107": "2020-05-10", "108": "2020-05-10", "109": "2021-08-08", "110": "2020-05-09" }[unitNo], amount_xof: spec.total, paid_amount_xof: spec.total, status: "paid", currency: "XOF", notes: `\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx Sheet1\uff1b${spec.notes}` };
  if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update receivable ${unitNo}`);
  else await checked(supabase.from("receivables").insert(payload), `insert receivable ${unitNo}`);
}

const unitNotes = {
  "107": "\u4e1a\u4e3b\u738b\u6625\u534e\uff1b\u623f\u6b3e5000\u4e07+\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u4e0e108\u8054\u5408\u6838\u7b97\uff1b\u5df2\u7ed3\u6e05\u3002",
  "108": "\u4e1a\u4e3b\u738b\u6625\u534e\uff1b\u623f\u6b3e6500\u4e07\uff1b\u4e0e107\u8054\u5408\u6838\u7b97\uff1b\u5df2\u7ed3\u6e05\u3002",
  "109": "\u4e1a\u4e3b\u5b8b\u7559\u6210\uff1b\u5408\u540c\u603b\u4ef76000\u4e07\u5df2\u5305\u542b\u8f66\u4f4d\uff1b\u623f\u6b3e5500\u4e07+\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u4e0e110\u540c\u4e00\u4e1a\u4e3b\uff1b\u5df2\u7ed3\u6e05\u3002",
  "110": "\u4e1a\u4e3b\u5b8b\u7559\u6210\uff1b\u623f\u6b3e6500\u4e07+\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u4e0e109\u540c\u4e00\u4e1a\u4e3b\uff1b\u5df2\u7ed3\u6e05\u3002",
};
for (const [unitNo, notes] of Object.entries(unitNotes)) {
  await checked(supabase.from("units").update({ status: "sold", notes: `\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b${notes}` }).eq("id", unitByNo[unitNo].id), `update unit ${unitNo}`);
}
await checked(
  supabase.from("audit_logs").insert({ action: "reconcile_floor_lease_sale_data", entity_type: "building", entity_id: building.id, metadata: { building_code: "SACSI4", units: ["107", "108", "109", "110"], pair_107_108_buyer_shared: true, pair_107_108_total_xof: 120_000_000, pair_107_108_settled: true, pair_109_110_buyer_shared: true, pair_109_110_total_xof: 130_000_000, pair_109_110_settled: true } }),
  "write audit log",
);

console.log(JSON.stringify({ ok: true, pair107108: { total: 120_000_000, settled: true }, pair109110: { total: 130_000_000, settled: true } }));
