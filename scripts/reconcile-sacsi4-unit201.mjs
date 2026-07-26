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
const unit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "201").single(), "load unit 201");
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, signed_date").eq("unit_id", unit.id).single(), "load 201 sale");
if (!["2023-05-02", "2023-05-15"].includes(sale.signed_date)) throw new Error(`Unexpected 201 sale date ${sale.signed_date}`);
await checked(
  supabase.from("sale_contracts").update({
    contract_no: "WB-SALE-SACSI4-201-20230515",
    signed_date: "2023-05-15",
    total_amount_xof: 75_000_000,
    agency_company: "FULO",
    agency_commission_amount_xof: 1_125_000,
    agency_commission_paid: true,
    payment_plan_type: "\u5408\u540c\u603b\u4ef77500\u4e07\uff0c\u65e0\u8f66\u4f4d\u8bb0\u5f55\uff1b\u5df2\u7ed3\u6e05\u3002\u6ce8\u518c\u91d125\u4e07\u3001FULO\u4e2d\u4ecb\u8d39112.5\u4e07\u3001\u8fc7\u6237\u7a0e225\u4e07\u5747\u53e6\u5217\u3002",
  }).eq("id", sale.id),
  "update 201 sale",
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
  { date: "2023-05-02", amount: 250_000, sourceType: "sale_registration_fee", direction: "income", category: "sale_registration_fee", receipt: "WB4-SALE-201-20230502-REGISTRATION-01", notes: "201\u6ce8\u518c\u91d1\u6536\u516525\u4e07\uff1b\u4e0d\u8ba1\u5165\u623f\u6b3e\u548c\u5408\u540c\u603b\u4ef7\u3002" },
  { date: "2023-05-15", amount: 75_000_000, sourceType: "sale_contract", direction: "income", category: "sale", receipt: "WB4-SALE-201-20230515-HOUSE-01", oldReceipt: "S4-SALE-201-CONSOLIDATED", notes: "201\u623f\u6b3e7500\u4e07\uff1b\u5df2\u7ed3\u6e05\u3002" },
  { date: "2023-06-20", amount: 2_250_000, sourceType: "sale_other_income", direction: "liability_in", category: "sale_transfer_tax", receipt: "WB4-SALE-201-20230620-TRANSFERTAX-01", notes: "201\u8fc7\u6237\u7a0e\u4ee3\u6536225\u4e07\uff1b\u4ece201/308/506\u8054\u5408\u7a0e\u6b3e675\u4e07\u4e2d\u5e73\u5747\u5206\u644a\uff1b308\u3001506\u5404225\u4e07\u5f85\u5404\u81ea\u5ba1\u6838\u65f6\u5f55\u5165\u3002" },
  { date: "2023-06-22", amount: 1_125_000, sourceType: "sale_agency_expense", direction: "expense", category: "sale_agency_expense", receipt: "WB4-SALE-201-20230622-AGENCY-01", notes: "201\u652f\u4ed8FULO\u51fa\u552e\u4e2d\u4ecb\u8d39112.5\u4e07\uff1b\u5df2\u652f\u4ed8\u3002" },
];
for (const entry of entries) await upsertPayment(entry);

const receivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum"), "load 201 receivable");
if (receivables.length !== 1) throw new Error(`Expected one 201 receivable, got ${receivables.length}`);
await checked(
  supabase.from("receivables").update({ amount_xof: 75_000_000, paid_amount_xof: 75_000_000, status: "paid", notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx Sheet1\uff1b\u5408\u540c\u603b\u4ef77500\u4e07\uff0c\u65e0\u8f66\u4f4d\u8bb0\u5f55\uff1b\u5df2\u7ed3\u6e05\uff1b\u6ce8\u518c\u91d1\u3001\u8fc7\u6237\u7a0e\u548c\u4e2d\u4ecb\u8d39\u5747\u53e6\u5217\u3002" }).eq("id", receivables[0].id),
  "update 201 receivable",
);
await checked(
  supabase.from("units").update({ notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u4e1a\u4e3bREBIERE\uff1b\u623f\u6b3e7500\u4e07\uff0c\u65e0\u8f66\u4f4d\u8bb0\u5f55\uff0c\u5df2\u7ed3\u6e05\uff1b\u6ce8\u518c\u91d125\u4e07\u3001\u8fc7\u6237\u7a0e225\u4e07\u3001FULO\u4e2d\u4ecb\u8d39112.5\u4e07\u53e6\u5217\u3002" }).eq("id", unit.id),
  "update unit 201 note",
);
await checked(
  supabase.from("audit_logs").insert({ action: "reconcile_floor_lease_sale_data", entity_type: "building", entity_id: building.id, metadata: { building_code: "SACSI4", unit: "201", sale_total_xof: 75_000_000, sale_settled: true, registration_income_xof: 250_000, agency_expense_xof: 1_125_000, joint_transfer_tax_total_xof: 6_750_000, transfer_tax_allocated_xof: 2_250_000, pending_transfer_tax_units: ["308", "506"] } }),
  "write audit log",
);

console.log(JSON.stringify({ ok: true, unit: "201", sale: 75_000_000, registration: 250_000, transferTax: 2_250_000, agencyExpense: 1_125_000, settled: true }));
