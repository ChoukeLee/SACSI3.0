import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
    const i = line.indexOf("=");
    return [line.slice(0, i), line.slice(i + 1)];
  }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI4").single(), "load building");
const unitNos = ["401", "402", "403", "404", "405", "406", "407", "408", "409", "410", "411", "412"];
const units = await checked(supabase.from("units").select("id, unit_no").eq("building_id", building.id).in("unit_no", unitNos), "load units");
if (units.length !== unitNos.length) throw new Error(`Expected ${unitNos.length} units, got ${units.length}`);
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));

async function upsertCustomer(name, notes) {
  const rows = await checked(supabase.from("customers").select("id").eq("name", name), `find customer ${name}`);
  if (rows.length > 1) throw new Error(`Duplicate customer ${name}`);
  if (rows.length === 1) return rows[0].id;
  return (await checked(supabase.from("customers").insert({ name, notes }).select("id").single(), `insert customer ${name}`)).id;
}

async function upsertLedger(paymentId, unitNo, entry) {
  const payload = {
    building_id: building.id,
    unit_id: unitByNo[unitNo].id,
    payment_id: paymentId,
    entry_date: entry.date,
    direction: entry.direction ?? "income",
    category: entry.ledgerCategory ?? (entry.sourceType === "sale_contract" ? "sale" : entry.sourceType),
    amount_xof: entry.amount,
    amount_cny: null,
    description: entry.notes,
  };
  const rows = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${entry.receipt}`);
  if (rows.length > 1) throw new Error(`Duplicate ledger ${entry.receipt}`);
  if (rows.length === 1) await checked(supabase.from("ledger_entries").update(payload).eq("id", rows[0].id), `update ledger ${entry.receipt}`);
  else await checked(supabase.from("ledger_entries").insert(payload), `insert ledger ${entry.receipt}`);
}

async function upsertPayment(sale, unitNo, entry) {
  let rows = await checked(supabase.from("payments").select("id").eq("source_id", sale.id).eq("receipt_no", entry.receipt), `find ${entry.receipt}`);
  if (rows.length === 0 && entry.oldReceipt) rows = await checked(supabase.from("payments").select("id").eq("source_id", sale.id).eq("receipt_no", entry.oldReceipt), `find ${entry.oldReceipt}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${entry.receipt}`);
  const payload = {
    customer_id: sale.customer_id,
    unit_id: unitByNo[unitNo].id,
    source_type: entry.sourceType,
    source_id: sale.id,
    payment_date: entry.date,
    amount: entry.amount,
    currency: "XOF",
    exchange_rate_to_xof: 1,
    receipt_no: entry.receipt,
    notes: entry.notes,
  };
  let paymentId;
  if (rows.length === 1) {
    paymentId = rows[0].id;
    await checked(supabase.from("payments").update(payload).eq("id", paymentId), `update ${entry.receipt}`);
  } else {
    paymentId = (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${entry.receipt}`)).id;
  }
  await upsertLedger(paymentId, unitNo, entry);
}

async function upsertSaleReceivable(sale, unitNo, spec) {
  const rows = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum"), `find ${unitNo} receivable`);
  if (rows.length > 1) throw new Error(`Duplicate ${unitNo} receivables`);
  const payload = {
    building_id: building.id,
    unit_id: unitByNo[unitNo].id,
    customer_id: sale.customer_id,
    source_type: "sale_contract",
    source_id: sale.id,
    category: "sale_lump_sum",
    title: `4# ${unitNo}\u8d2d\u623f\u6b3e`,
    due_date: spec.signedDate,
    amount_xof: spec.total,
    paid_amount_xof: spec.total,
    status: "paid",
    currency: "XOF",
    notes: `\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx Sheet1\uff1b${spec.summary}`,
  };
  if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update ${unitNo} receivable`);
  else await checked(supabase.from("receivables").insert(payload), `insert ${unitNo} receivable`);
}

const saleSpecs = {
  "401": { signedDate: "2024-10-28", total: 72_500_000, summary: "\u623f\u6b3e7250\u4e07\u5206\u4e24\u7b14\u4ed8\u6e05\uff1b\u65e0\u8f66\u4f4d\u3002", house: [["2024-10-28", 60_000_000], ["2024-11-15", 12_500_000]] },
  "402": { signedDate: "2023-04-22", total: 85_000_000, summary: "\u623f\u6b3e8500\u4e07\u5206\u516d\u7b14\u4ed8\u6e05\uff1b\u65e0\u8f66\u4f4d\u3002", house: [["2023-04-22", 20_000_000], ["2023-05-01", 10_000_000], ["2023-05-09", 10_000_000], ["2023-05-10", 5_000_000], ["2023-06-16", 39_000_000], ["2023-06-17", 1_000_000]] },
  "403": { signedDate: "2023-09-20", total: 78_000_000, agency: 1_170_000, summary: "\u623f\u6b3e7800\u4e07\u5df2\u7ed3\u6e05\uff1b\u6ce8\u518c\u91d125\u4e07\u548c\u4e2d\u4ecb\u8d39117\u4e07\u53e6\u5217\u3002", house: [["2023-09-25", 25_000_000], ["2023-10-25", 25_000_000], ["2023-11-16", 28_000_000]], extras: [["2023-09-20", 250_000, "sale_registration_fee", "REGISTRATION", "income", "sale_registration_fee", "403\u6ce8\u518c\u91d125\u4e07\u3002"], ["2023-11-23", 1_170_000, "sale_agency_expense", "AGENCY", "expense", "sale_agency_expense", "403\u51fa\u552e\u4e2d\u4ecb\u8d39117\u4e07\u5df2\u652f\u4ed8\u3002"]] },
  "404": { signedDate: "2024-05-30", total: 96_500_000, summary: "\u623f\u6b3e9650\u4e07\u4e00\u6b21\u4ed8\u6e05\uff1b\u65e0\u8f66\u4f4d\u3002", house: [["2024-05-30", 96_500_000]] },
  "405": { buyer: "\u5019\u7389\u82f1", signedDate: "2022-09-12", total: 70_000_000, summary: "\u4e0e406\u8054\u5408\u8d2d\u4e70\u517114000\u4e07\uff0c\u6309\u4e24\u95f4\u54047000\u4e07\u5206\u644a\uff1b405\u623f\u6b3e6500\u4e07+\u8f66\u4f4d500\u4e07\uff0c\u5df2\u7ed3\u6e05\u3002", house: [["2022-09-12", 65_000_000]], parking: [["2022-09-12", 5_000_000]] },
  "406": { signedDate: "2025-06-02", total: 110_000_000, agency: 2_750_000, summary: "TOURE\u623f\u6b3e11000\u4e07\u5df2\u7ed3\u6e05\uff1b\u6ce8\u518c\u91d125\u4e07\u548c\u4e2d\u4ecb\u8d39275\u4e07\u53e6\u5217\uff1b\u65e0\u8f66\u4f4d\u3002", house: [["2025-06-04", 110_000_000]], extras: [["2025-06-02", 250_000, "sale_registration_fee", "REGISTRATION", "income", "sale_registration_fee", "406\u6ce8\u518c\u91d125\u4e07\u3002"], ["2025-06-17", 2_750_000, "sale_agency_expense", "AGENCY", "expense", "sale_agency_expense", "406 TOURE\u51fa\u552e\u4e2d\u4ecb\u8d39275\u4e07\u5df2\u652f\u4ed8\u3002"]] },
  "407": { signedDate: "2024-04-12", total: 73_000_000, summary: "\u623f\u6b3e7300\u4e07\u4e00\u6b21\u4ed8\u6e05\uff1b\u65e0\u8f66\u4f4d\u3002", house: [["2024-04-12", 73_000_000]] },
  "408": { signedDate: "2024-05-30", total: 96_500_000, summary: "\u623f\u6b3e9650\u4e07\u4e00\u6b21\u4ed8\u6e05\uff1b\u65e0\u8f66\u4f4d\u3002", house: [["2024-05-30", 96_500_000]] },
  "409": { signedDate: "2025-06-12", total: 77_250_000, agency: 2_000_000, summary: "\u623f\u6b3e7725\u4e07\u5df2\u7ed3\u6e05\uff1b\u8fc7\u6237\u7a0e275\u4e07\u548c\u4e2d\u4ecb\u8d39200\u4e07\u53e6\u5217\uff1b\u539f\u8868\u5408\u8ba18000\u4e07\u4e3a\u623f\u6b3e+\u8fc7\u6237\u7a0e\u3002", house: [["2025-06-12", 77_250_000]], extras: [["2025-06-12", 2_750_000, "sale_other_income", "TRANSFERTAX", "liability_in", "sale_transfer_tax", "409\u8fc7\u6237\u7a0e\u4ee3\u6536275\u4e07\u3002"], ["2025-06-21", 2_000_000, "sale_agency_expense", "AGENCY", "expense", "sale_agency_expense", "409\u51fa\u552e\u4e2d\u4ecb\u8d39200\u4e07\u5df2\u652f\u4ed8\u3002"]] },
  "410": { signedDate: "2023-07-21", total: 105_000_000, summary: "\u623f\u6b3e10500\u4e07\u5206\u4e09\u7b14\u4ed8\u6e05\uff1b\u6587\u4ef6\u8d3925\u4e07\u53e6\u5217\uff1b\u65e0\u8f66\u4f4d\u3002", house: [["2023-07-21", 30_000_000], ["2023-08-24", 43_000_000], ["2023-11-06", 32_000_000]], extras: [["2023-07-21", 250_000, "sale_other_income", "DOCUMENT", "income", "sale_document_income", "410\u6587\u4ef6\u8d39\u6536\u516525\u4e07\uff0c\u5355\u5217\u3002"]] },
  "411": { signedDate: "2024-04-29", total: 78_000_000, summary: "\u5408\u540c\u603b\u4ef77800\u4e07\u542b\u8f66\u4f4d\uff1b\u623f\u6b3e7300\u4e07+\u8f66\u4f4d500\u4e07\uff0c\u5df2\u7ed3\u6e05\u3002", house: [["2024-04-29", 50_000_000], ["2024-05-07", 23_000_000]], parking: [["2024-05-07", 5_000_000]] },
  "412": { signedDate: "2021-07-23", total: 85_000_000, summary: "\u623f\u6b3e8500\u4e07\u4e00\u6b21\u4ed8\u6e05\uff1b\u65e0\u8f66\u4f4d\u3002", house: [["2021-07-23", 85_000_000]] },
};

const activeSales = {};
for (const unitNo of unitNos) {
  const spec = saleSpecs[unitNo];
  let rows = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unitByNo[unitNo].id).eq("status", "active"), `find active ${unitNo} sale`);
  if (unitNo === "405" && rows.length === 0) {
    const customerId = await upsertCustomer(spec.buyer, "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b405/406\u8054\u5408\u8d2d\u4e70\u4eba\u3002");
    rows = [await checked(supabase.from("sale_contracts").insert({ unit_id: unitByNo[unitNo].id, customer_id: customerId, contract_no: "WB-SALE-SACSI4-405-20220912", signed_date: spec.signedDate, transfer_status: "not_started", payment_plan_type: spec.summary, total_amount_xof: spec.total, status: "active" }).select("id, customer_id, total_amount_xof").single(), "insert 405 sale")];
  }
  if (rows.length !== 1) throw new Error(`Expected one active ${unitNo} sale, got ${rows.length}`);
  const sale = rows[0];
  const allowed = unitNo === "409" ? [77_250_000, 80_000_000] : [spec.total];
  if (!allowed.includes(Number(sale.total_amount_xof))) throw new Error(`Unexpected ${unitNo} total ${sale.total_amount_xof}`);
  await checked(supabase.from("sale_contracts").update({ contract_no: `WB-SALE-SACSI4-${unitNo}-${spec.signedDate.replaceAll("-", "")}`, signed_date: spec.signedDate, total_amount_xof: spec.total, agency_commission_amount_xof: spec.agency ?? null, agency_commission_paid: Boolean(spec.agency), payment_plan_type: spec.summary }).eq("id", sale.id), `update ${unitNo} sale`);
  let index = 0;
  for (const [date, amount] of spec.house) {
    index += 1;
    await upsertPayment(sale, unitNo, { date, amount, sourceType: "sale_contract", receipt: `WB4-SALE-${unitNo}-${date.replaceAll("-", "")}-HOUSE-${String(index).padStart(2, "0")}`, oldReceipt: index === 1 ? `S4-SALE-${unitNo}-CONSOLIDATED` : undefined, notes: `${unitNo}\u623f\u6b3e${amount / 10_000}\u4e07\u3002` });
  }
  for (const [date, amount, sourceType, suffix, direction, ledgerCategory, notes] of spec.extras ?? []) await upsertPayment(sale, unitNo, { date, amount, sourceType, receipt: `WB4-SALE-${unitNo}-${date.replaceAll("-", "")}-${suffix}-01`, notes, direction, ledgerCategory });
  index = 0;
  for (const [date, amount] of spec.parking ?? []) {
    index += 1;
    await upsertPayment(sale, unitNo, { date, amount, sourceType: "sale_contract", receipt: `WB4-SALE-${unitNo}-${date.replaceAll("-", "")}-PARKING-${String(index).padStart(2, "0")}`, notes: `${unitNo}\u8f66\u4f4d\u6b3e${amount / 10_000}\u4e07\uff0c\u4e0e\u623f\u6b3e\u5206\u5217\u3002` });
  }
  await upsertSaleReceivable(sale, unitNo, spec);
  activeSales[unitNo] = sale;
}

async function upsertHistoricalSale({ unitNo, customerName, contractNo, signedDate, total, status = "terminated", entries, summary }) {
  const customerId = await upsertCustomer(customerName, "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b406\u5386\u53f2\u4e70\u65b9\u3002");
  let rows = await checked(supabase.from("sale_contracts").select("id, customer_id").eq("contract_no", contractNo), `find ${contractNo}`);
  if (rows.length > 1) throw new Error(`Duplicate ${contractNo}`);
  const payload = { unit_id: unitByNo[unitNo].id, customer_id: customerId, contract_no: contractNo, signed_date: signedDate, transfer_status: "not_started", payment_plan_type: summary, total_amount_xof: total, status };
  let sale;
  if (rows.length === 1) {
    sale = rows[0];
    await checked(supabase.from("sale_contracts").update(payload).eq("id", sale.id), `update ${contractNo}`);
  } else sale = await checked(supabase.from("sale_contracts").insert(payload).select("id, customer_id").single(), `insert ${contractNo}`);
  let index = 0;
  for (const entry of entries) {
    index += 1;
    await upsertPayment(sale, unitNo, { date: entry.date, amount: entry.amount, sourceType: "sale_contract", receipt: `${contractNo.replace("WB-SALE-SACSI4", "WB4-SALE")}-HOUSE-${String(index).padStart(2, "0")}`, notes: entry.notes });
  }
  await upsertSaleReceivable(sale, unitNo, { signedDate, total, summary });
}

await upsertHistoricalSale({ unitNo: "406", customerName: "\u5019\u7389\u82f1", contractNo: "WB-SALE-SACSI4-406-20220912-RESOLD", signedDate: "2022-09-12", total: 70_000_000, entries: [{ date: "2022-09-12", amount: 70_000_000, notes: "405/406\u8054\u5408\u6536\u6b3e14000\u4e07\u4e2d\u5206\u644a\u81f3406\u76847000\u4e07\uff1b\u540e\u5df2\u8f6c\u552e\u3002" }], summary: "\u4e0e405\u8054\u5408\u8d2d\u4e70\u54047000\u4e07\u5206\u644a\uff1b406\u65e0\u8f66\u4f4d\uff1b\u540e\u5df2\u8f6c\u552e\u3002" });
await upsertHistoricalSale({ unitNo: "406", customerName: "\u516c\u53f8\uff08\u540d\u79f0\u5f85\u8865\uff09", contractNo: "WB-SALE-SACSI4-406-20231109-RESOLD", signedDate: "2023-11-09", total: 85_000_000, entries: [{ date: "2023-11-09", amount: 85_000_000, notes: "406\u5386\u53f2\u8f6c\u552e\u623f\u6b3e8500\u4e07\uff1b\u540e\u5df2\u518d\u8f6c\u552eTOURE\u3002" }], summary: "\u5386\u53f2\u8f6c\u552e\u4ef78500\u4e07\u5df2\u7ed3\u6e05\uff1b\u4e70\u65b9\u516c\u53f8\u540d\u79f0\u5f85\u8865\uff1b\u540e\u5df2\u518d\u8f6c\u552e\u3002" });

for (const unitNo of unitNos) {
  const spec = saleSpecs[unitNo];
  await checked(supabase.from("units").update({ status: "sold", notes: `\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b${spec.summary}` }).eq("id", unitByNo[unitNo].id), `update unit ${unitNo}`);
  const payments = await checked(supabase.from("payments").select("source_type, amount").eq("source_id", activeSales[unitNo].id), `verify ${unitNo}`);
  const contractPaid = payments.filter((payment) => payment.source_type === "sale_contract").reduce((sum, payment) => sum + Number(payment.amount), 0);
  if (contractPaid !== spec.total) throw new Error(`Unexpected ${unitNo} contract paid ${contractPaid}`);
}

await checked(supabase.from("audit_logs").insert({ action: "reconcile_floor_sale_data", entity_type: "building", entity_id: building.id, metadata: { building_code: "SACSI4", floor: "4F", active_units: unitNos, unit_405_406_joint_purchase_xof: 140_000_000, unit_409_house_xof: 77_250_000, unit_409_transfer_tax_xof: 2_750_000, unit_411_house_xof: 73_000_000, unit_411_parking_xof: 5_000_000 } }), "write audit log");
console.log(JSON.stringify({ ok: true, floor: "4F", active_sales: Object.fromEntries(unitNos.map((unitNo) => [unitNo, saleSpecs[unitNo].total])) }));
