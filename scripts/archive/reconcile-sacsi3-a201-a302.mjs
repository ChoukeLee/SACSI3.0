import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(query, label) { const { data, error } = await query; if (error) throw new Error(`${label}: ${error.message}`); return data; }

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI3").single(), "load building");
const unitNos = ["A201", "A202", "A301", "A302"];
const units = await checked(supabase.from("units").select("id, unit_no").eq("building_id", building.id).in("unit_no", unitNos), "load A201-A302");
if (units.length !== unitNos.length) throw new Error("Missing A201-A302 unit");
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));
const sales = await checked(supabase.from("sale_contracts").select("id, unit_id, customer_id, total_amount_xof").in("unit_id", units.map((unit) => unit.id)).eq("status", "active"), "load A201-A302 sales");
if (sales.length !== unitNos.length) throw new Error("Missing A201-A302 sale");
const saleByNo = Object.fromEntries(unitNos.map((unitNo) => [unitNo, sales.find((sale) => sale.unit_id === unitByNo[unitNo].id)]));
const customerIds = [...new Set(sales.map((sale) => sale.customer_id))];
if (customerIds.length !== 1) throw new Error("A201-A302 must share one buyer");
const customer = await checked(supabase.from("customers").select("id, name").eq("id", customerIds[0]).single(), "load CORRADETTI");
if (customer.name !== "CORRADETTI") throw new Error(`Unexpected buyer: ${customer.name}`);

const specs = {
  A201: { total: 141_000_000, payments: [["2019-12-16", 43_000_000, "支票"], ["2020-03-27", 7_000_000, "现金"], ["2020-04-16", 50_000_000, "支票"], ["2020-06-10", 41_000_000, "支票"]] },
  A202: { total: 109_000_000, payments: [["2020-03-27", 50_000_000, "支票"], ["2020-04-29", 13_000_000, "现金"], ["2020-06-10", 6_000_000, "现金"], ["2020-07-24", 40_000_000, "方式未记"]] },
  A301: { total: 100_000_000, payments: [["2020-08-28", 40_000_000, "支票"], ["2020-09-16", 20_000_000, "现金"], ["2020-09-16", 20_000_000, "支票"], ["2020-10-27", 20_000_000, "方式未记"]] },
  A302: { total: 282_000_000, payments: [["2020-10-27", 20_000_000, "支票"], ["2020-12-04", 10_000_000, "现金"], ["2020-12-04", 30_000_000, "支票，原始日期缺失，以相邻前笔日期占位"], ["2020-12-04", 53_000_000, "支票，原始日期缺失，以相邻前笔日期占位"], ["2021-02-04", 20_000_000, "现金"], ["2021-02-04", 20_000_000, "支票"], ["2021-03-05", 19_000_000, "现金"], ["2021-03-05", 10_000_000, "支票"], ["2021-03-23", 5_000_000, "现金"], ["2021-03-23", 10_000_000, "支票"], ["2021-05-08", 16_000_000, "支票"], ["2021-05-08", 4_000_000, "现金"], ["2021-06-30", 10_000_000, "支票"], ["2021-06-30", 20_000_000, "现金"], ["2021-07-28", 20_000_000, "现金"], ["2021-07-28", 15_000_000, "支票"]] },
};
const packageTotal = Object.values(specs).reduce((sum, spec) => sum + spec.total, 0);
if (packageTotal !== 632_000_000) throw new Error("Invalid package total");
for (const unitNo of unitNos) {
  const sale = saleByNo[unitNo]; const spec = specs[unitNo];
  if (![0, spec.total].includes(Number(sale.total_amount_xof)) || spec.payments.reduce((sum, payment) => sum + payment[1], 0) !== spec.total) throw new Error(`Unexpected ${unitNo} source state`);
}

async function upsertPayment({ unitNo, receiptNo, date, amount, sourceType, category, notes }) {
  const unit = unitByNo[unitNo]; const sale = saleByNo[unitNo];
  const rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const payload = { customer_id: customer.id, unit_id: unit.id, source_type: sourceType, source_id: sale.id, payment_date: date, amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
  const paymentId = rows.length ? (await checked(supabase.from("payments").update(payload).eq("id", rows[0].id).select("id").single(), `update ${receiptNo}`)).id : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledger = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: date, direction: "income", category, amount_xof: amount, amount_cny: null, description: notes };
  if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), `update ledger ${receiptNo}`); else await checked(supabase.from("ledger_entries").insert(ledger), `insert ledger ${receiptNo}`);
}

for (const unitNo of unitNos) {
  const spec = specs[unitNo]; const sale = saleByNo[unitNo]; const unit = unitByNo[unitNo];
  const notes = `来源：3号公寓.xlsx；A201、A202、A301、A302由CORRADETTI打包购买，总价63200万FCFA；Excel付款已明确归入各房，${unitNo}付款合计${spec.total / 10_000}万FCFA，直接作为本房合同价，不再按面积推算；已结清。`;
  await checked(supabase.from("sale_contracts").update({ signed_date: "2019-12-16", payment_plan_type: "installment", total_amount_xof: spec.total }).eq("id", sale.id), `update ${unitNo} sale`);
  for (let index = 0; index < spec.payments.length; index += 1) {
    const [date, amount, method] = spec.payments[index];
    await upsertPayment({ unitNo, receiptNo: `WB3-SALE-${unitNo}-${date.replaceAll("-", "")}-HOUSE-${String(index + 1).padStart(2, "0")}`, date, amount, sourceType: "sale_contract", category: "sale", notes: `${notes} 本笔${amount / 10_000}万FCFA，方式：${method}。` });
  }
  const receivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).neq("status", "cancelled"), `load ${unitNo} receivable`);
  if (receivables.length > 1) throw new Error(`Unexpected ${unitNo} receivable count`);
  const receivable = { building_id: building.id, unit_id: unit.id, customer_id: customer.id, source_type: "sale_contract", source_id: sale.id, category: "sale_installment", title: `3# ${unitNo}购房款`, due_date: spec.payments.at(-1)[0], amount_xof: spec.total, paid_amount_xof: spec.total, status: "paid", currency: "XOF", notes };
  if (receivables.length) await checked(supabase.from("receivables").update(receivable).eq("id", receivables[0].id), `update ${unitNo} receivable`); else await checked(supabase.from("receivables").insert(receivable), `insert ${unitNo} receivable`);
  await checked(supabase.from("units").update({ status: "sold", notes: `${notes}\nExcel未记本房单独FULO提成或过户状态。` }).eq("id", unit.id), `update ${unitNo} unit`);
}

const taxNotes = "来源：3号公寓.xlsx；A201-A302四套打包交易于2023-02-10实际支付税款952.86万FCFA，支票号9075257；Excel仅在A201行记录，作为打包实际税款挂A201，不向A202-A302重复分摊，不计算理论差额。";
await upsertPayment({ unitNo: "A201", receiptNo: "WB3-SALE-A201-20230210-PACKAGE-TAX-01", date: "2023-02-10", amount: 9_528_600, sourceType: "sale_other_income", category: "sale_transfer_tax", notes: taxNotes });
await checked(supabase.from("units").update({ notes: `来源：3号公寓.xlsx；A201-A302由CORRADETTI打包购买；A201付款合计14100万FCFA，作为本房合同价，已结清。\n${taxNotes}\nExcel未记FULO提成或过户状态。` }).eq("id", unitByNo.A201.id), "append A201 tax notes");

const verified = await checked(supabase.from("payments").select("source_id, source_type, amount").in("source_id", sales.map((sale) => sale.id)), "verify A201-A302 payments");
if (verified.reduce((sum, row) => sum + (row.source_type === "sale_contract" ? Number(row.amount) : 0), 0) !== packageTotal || verified.filter((row) => row.source_type === "sale_other_income").reduce((sum, row) => sum + Number(row.amount), 0) !== 9_528_600) throw new Error("Unexpected A201-A302 package totals");
for (const unitNo of unitNos) { const rows = verified.filter((row) => row.source_id === saleByNo[unitNo].id && row.source_type === "sale_contract"); if (rows.length !== specs[unitNo].payments.length || rows.reduce((sum, row) => sum + Number(row.amount), 0) !== specs[unitNo].total) throw new Error(`Unexpected ${unitNo} payments`); }
await checked(supabase.from("audit_logs").insert({ action: "reconcile_sacsi3_a201_a302", entity_type: "building", entity_id: building.id, metadata: { building_code: "SACSI3", units: Object.fromEntries(unitNos.map((unitNo) => [unitNo, { buyer: "CORRADETTI", total_xof: specs[unitNo].total, payment_count: specs[unitNo].payments.length, settled: true }])), package_total_xof: packageTotal, unit_prices_derived_from_explicit_unit_payment_totals_not_area: true, A302_undated_checks: { amounts_xof: [30_000_000, 53_000_000], accounting_date_placeholder: "2020-12-04" }, package_tax: { holder_unit: "A201", date: "2023-02-10", actual_amount_xof: 9_528_600, check_no: "9075257", allocated_to_other_units: false, difference_tracking: false } } }), "write A201-A302 audit");
console.log(JSON.stringify({ ok: true, units: unitNos, allocations: Object.fromEntries(unitNos.map((unitNo) => [unitNo, specs[unitNo].total])), package_total_xof: packageTotal, actual_tax_xof: 9_528_600, settled: true }));
