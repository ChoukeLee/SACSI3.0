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
  supabase.from("buildings").select("id").eq("code", "SACSI6").single(),
  "load building",
);
const units = await checked(
  supabase.from("units").select("id, unit_no").eq("building_id", building.id).in("unit_no", ["6F", "601", "602"]),
  "load floor 6 units",
);
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));
for (const unitNo of ["6F", "601", "602"]) {
  if (!unitByNo[unitNo]) throw new Error(`Missing unit ${unitNo}`);
}

// The zero-value 601 lease has no workbook basis. Refuse deletion if financial data was attached later.
const placeholderLeases = await checked(
  supabase.from("lease_contracts").select("id").eq("contract_no", "LEGACY-LEASE-SACSI6-601"),
  "load 601 placeholder lease",
);
if (placeholderLeases.length > 1) throw new Error(`Expected at most one 601 placeholder lease, got ${placeholderLeases.length}`);
if (placeholderLeases.length === 1) {
  const placeholderId = placeholderLeases[0].id;
  const [payments, receivables] = await Promise.all([
    checked(supabase.from("payments").select("id").eq("source_id", placeholderId), "check 601 payments"),
    checked(supabase.from("receivables").select("id").eq("source_id", placeholderId), "check 601 receivables"),
  ]);
  if (payments.length || receivables.length) {
    throw new Error(`601 placeholder has financial references: payments=${payments.length}, receivables=${receivables.length}`);
  }
  await checked(supabase.from("lease_contracts").delete().eq("id", placeholderId), "delete 601 placeholder lease");
}

const aiRows = await checked(
  supabase
    .from("sale_contracts")
    .select("id, customer_id, contract_no, signed_date, total_amount_xof")
    .in("contract_no", ["WB6-SALE-602-TERMINATED", "WB-SALE-SACSI6-602-20211220"]),
  "load AI QI sale",
);
if (aiRows.length !== 1) throw new Error(`Expected one AI QI sale, got ${aiRows.length}`);
const aiSale = aiRows[0];
if (aiSale.signed_date !== "2021-12-20" || Number(aiSale.total_amount_xof) !== 76_000_000) {
  throw new Error(`Unexpected AI QI contract values: ${aiSale.signed_date}, ${aiSale.total_amount_xof}`);
}

await checked(
  supabase.from("sale_contracts").update({
    unit_id: unitByNo["602"].id,
    contract_no: "WB-SALE-SACSI6-602-20211220",
    payment_plan_type: "\u5408\u540c\u603b\u989d7600\u4e07\uff1b\u5df2\u65362900\u4e07\uff1b2023-04-14\u7ec8\u6b62\u5408\u540c\uff0c\u9000\u623f\u6b3e2900\u4e07+\u8d54\u507f600\u4e07\uff0c\u5206\u522b\u5217\u793a",
  }).eq("id", aiSale.id),
  "move and normalize AI QI sale",
);
await Promise.all([
  checked(supabase.from("payments").update({ unit_id: unitByNo["602"].id }).eq("source_id", aiSale.id), "move AI QI payments"),
  checked(supabase.from("receivables").update({ unit_id: unitByNo["602"].id }).eq("source_id", aiSale.id), "move AI QI receivables"),
]);
const aiPayments = await checked(
  supabase.from("payments").select("id, payment_date, amount, receipt_no, source_type").eq("source_id", aiSale.id),
  "load AI QI payments",
);
const refundReceipt = "WB6-SALE-602-20230414-REFUND-01";
let refund = aiPayments.find((payment) => payment.receipt_no === refundReceipt);
if (!refund) refund = aiPayments.find((payment) => payment.payment_date === "2023-04-14" && Number(payment.amount) === 35_000_000);
if (!refund) throw new Error("Missing AI QI 3500万 termination payment");
await checked(
  supabase.from("payments").update({
    unit_id: unitByNo["602"].id,
    source_type: "sale_other_expense",
    amount: 29_000_000,
    receipt_no: refundReceipt,
    notes: "602 AI QI\u5408\u540c\u7ec8\u6b62\u9000\u623f\u6b3e2900\u4e07\uff1b\u4e0e\u8d54\u507f600\u4e07\u5206\u522b\u5217\u793a",
  }).eq("id", refund.id),
  "split AI QI refund",
);
await checked(
  supabase.from("ledger_entries").update({
    unit_id: unitByNo["602"].id,
    direction: "expense",
    category: "sale_other_expense",
    amount_xof: 29_000_000,
    description: "602 AI QI\u5408\u540c\u7ec8\u6b62\u9000\u623f\u6b3e2900\u4e07",
  }).eq("payment_id", refund.id),
  "update AI QI refund ledger",
);

const compensationReceipt = "WB6-SALE-602-20230414-COMP-01";
const compensationPayload = {
  customer_id: aiSale.customer_id,
  unit_id: unitByNo["602"].id,
  source_type: "sale_other_expense",
  source_id: aiSale.id,
  payment_date: "2023-04-14",
  amount: 6_000_000,
  currency: "XOF",
  exchange_rate_to_xof: 1,
  receipt_no: compensationReceipt,
  notes: "602 AI QI\u5408\u540c\u7ec8\u6b62\u8d54\u507f600\u4e07\uff1b\u4e0e\u9000\u623f\u6b3e2900\u4e07\u5206\u522b\u5217\u793a",
};
let compensationRows = await checked(
  supabase.from("payments").select("id").eq("source_id", aiSale.id).eq("receipt_no", compensationReceipt),
  "find AI QI compensation",
);
if (compensationRows.length > 1) throw new Error(`Duplicate AI QI compensation rows: ${compensationRows.length}`);
let compensationId;
if (compensationRows.length === 1) {
  compensationId = compensationRows[0].id;
  await checked(supabase.from("payments").update(compensationPayload).eq("id", compensationId), "update AI QI compensation");
} else {
  const inserted = await checked(supabase.from("payments").insert(compensationPayload).select("id").single(), "insert AI QI compensation");
  compensationId = inserted.id;
}
const compensationLedger = {
  building_id: building.id,
  unit_id: unitByNo["602"].id,
  payment_id: compensationId,
  entry_date: "2023-04-14",
  direction: "expense",
  category: "sale_other_expense",
  amount_xof: 6_000_000,
  amount_cny: null,
  description: "602 AI QI\u5408\u540c\u7ec8\u6b62\u8d54\u507f600\u4e07",
};
const compensationLedgers = await checked(
  supabase.from("ledger_entries").select("id").eq("payment_id", compensationId),
  "find AI QI compensation ledger",
);
if (compensationLedgers.length > 1) throw new Error(`Duplicate AI QI compensation ledgers: ${compensationLedgers.length}`);
if (compensationLedgers.length === 1) {
  await checked(supabase.from("ledger_entries").update(compensationLedger).eq("id", compensationLedgers[0].id), "update AI QI compensation ledger");
} else {
  await checked(supabase.from("ledger_entries").insert(compensationLedger), "insert AI QI compensation ledger");
}

// Every ledger row for this historical contract must now point to the historical 602 unit.
const paymentIds = (await checked(supabase.from("payments").select("id").eq("source_id", aiSale.id), "reload AI QI payment ids")).map((row) => row.id);
if (paymentIds.length > 0) {
  await checked(supabase.from("ledger_entries").update({ unit_id: unitByNo["602"].id }).in("payment_id", paymentIds), "move AI QI ledgers");
}

const wholeFloorSales = await checked(
  supabase.from("sale_contracts").select("id, signed_date, total_amount_xof").in("contract_no", ["WB6-SALE-6F", "WB-SALE-SACSI6-6F-20250818"]),
  "load Li Liang whole-floor sale",
);
if (wholeFloorSales.length !== 1) throw new Error(`Expected one Li Liang 6F sale, got ${wholeFloorSales.length}`);
if (wholeFloorSales[0].signed_date !== "2025-08-18" || Number(wholeFloorSales[0].total_amount_xof) !== 250_000_000) {
  throw new Error(`Unexpected 6F contract values: ${wholeFloorSales[0].signed_date}, ${wholeFloorSales[0].total_amount_xof}`);
}
await checked(
  supabase.from("sale_contracts").update({ contract_no: "WB-SALE-SACSI6-6F-20250818" }).eq("id", wholeFloorSales[0].id),
  "normalize Li Liang whole-floor sale",
);

await checked(
  supabase.from("audit_logs").insert({
    action: "reconcile_floor_lease_sale_data",
    entity_type: "building",
    entity_id: building.id,
    metadata: {
      building_code: "SACSI6",
      floor: "6F",
      deleted_unit_601_placeholder_lease: placeholderLeases.length === 1,
      historical_sale_unit: "602",
      historical_sale_refund_xof: 29_000_000,
      historical_sale_compensation_xof: 6_000_000,
      normalized_contracts: ["WB-SALE-SACSI6-602-20211220", "WB-SALE-SACSI6-6F-20250818"],
    },
  }),
  "write audit log",
);

console.log(JSON.stringify({
  ok: true,
  deleted601Placeholder: placeholderLeases.length === 1,
  aiQi: { unit: "602", refund: 29_000_000, compensation: 6_000_000 },
  wholeFloor: { unit: "6F", total: 250_000_000 },
}));
