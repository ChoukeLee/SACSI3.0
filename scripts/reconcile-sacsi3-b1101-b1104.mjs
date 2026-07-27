import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(query, label) { const { data, error } = await query; if (error) throw new Error(`${label}: ${error.message}`); return data; }

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI3").single(), "load building");
const unitNos = ["B1101", "B1102", "B1103", "B1104"];
const units = await checked(supabase.from("units").select("id, unit_no, area_sqm, layout").eq("building_id", building.id).in("unit_no", unitNos), "load B1101-B1104");
if (units.length !== unitNos.length) throw new Error("Missing B11F unit");
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));
const sales = await checked(supabase.from("sale_contracts").select("id, unit_id, customer_id, total_amount_xof").in("unit_id", units.map((unit) => unit.id)).eq("status", "active"), "load B11F sales");
if (sales.length !== unitNos.length) throw new Error("Missing B11F sale");
const saleByNo = Object.fromEntries(unitNos.map((unitNo) => [unitNo, sales.find((sale) => sale.unit_id === unitByNo[unitNo].id)]));
const customers = await checked(supabase.from("customers").select("id, name").in("id", [...new Set(sales.map((sale) => sale.customer_id))]), "load B11F buyers");
const customerById = Object.fromEntries(customers.map((customer) => [customer.id, customer]));

const specs = {
  B1101: { buyer: "陈海滨", layout: "三室", benchmark: 160_000_000, total: 137_380_000 },
  B1102: { buyer: "汪涛", layout: "一室", benchmark: 50_000_000, total: 42_930_000 },
  B1103: { buyer: "白永海", layout: "二室", benchmark: 107_500_000, total: 92_310_000 },
  B1104: { buyer: "汪涛", layout: "三室", benchmark: 160_000_000, total: 137_380_000 },
};
const packageTotal = 410_000_000;
const benchmarkTotal = Object.values(specs).reduce((sum, spec) => sum + spec.benchmark, 0);
const packageFactor = packageTotal / benchmarkTotal;
if (Object.values(specs).reduce((sum, spec) => sum + spec.total, 0) !== packageTotal) throw new Error("Invalid B11F target allocation");
for (const unitNo of unitNos) {
  const spec = specs[unitNo]; const unit = unitByNo[unitNo]; const sale = saleByNo[unitNo]; const customer = customerById[sale.customer_id];
  if (customer?.name !== spec.buyer || unit.layout !== spec.layout || ![0, spec.total].includes(Number(sale.total_amount_xof))) throw new Error(`Unexpected ${unitNo} source data`);
}

const packagePayments = [["2020-05-08", 20_000_000], ["2020-05-11", 170_000_000], ["2020-05-14", 190_000_000], ["2020-05-16", 30_000_000]];
const allocatedByUnit = Object.fromEntries(unitNos.map((unitNo) => [unitNo, []]));
for (let paymentIndex = 0; paymentIndex < packagePayments.length - 1; paymentIndex += 1) {
  const [, packageAmount] = packagePayments[paymentIndex]; let allocated = 0;
  for (let unitIndex = 0; unitIndex < unitNos.length; unitIndex += 1) {
    const unitNo = unitNos[unitIndex];
    const amount = unitIndex === unitNos.length - 1 ? packageAmount - allocated : Math.round((packageAmount * specs[unitNo].total / packageTotal) / 10_000) * 10_000;
    allocatedByUnit[unitNo].push(amount); allocated += amount;
  }
  if (allocated !== packageAmount) throw new Error(`Invalid allocation for payment ${paymentIndex + 1}`);
}
for (const unitNo of unitNos) allocatedByUnit[unitNo].push(specs[unitNo].total - allocatedByUnit[unitNo].reduce((sum, amount) => sum + amount, 0));
for (let paymentIndex = 0; paymentIndex < packagePayments.length; paymentIndex += 1) {
  const allocated = unitNos.reduce((sum, unitNo) => sum + allocatedByUnit[unitNo][paymentIndex], 0);
  if (allocated !== packagePayments[paymentIndex][1] || unitNos.some((unitNo) => allocatedByUnit[unitNo][paymentIndex] <= 0)) throw new Error(`Invalid final allocation for payment ${paymentIndex + 1}`);
}

async function upsertPayment({ unitNo, receiptNo, date, amount, notes }) {
  const unit = unitByNo[unitNo]; const sale = saleByNo[unitNo]; const customer = customerById[sale.customer_id];
  const rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const payload = { customer_id: customer.id, unit_id: unit.id, source_type: "sale_contract", source_id: sale.id, payment_date: date, amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
  const paymentId = rows.length ? (await checked(supabase.from("payments").update(payload).eq("id", rows[0].id).select("id").single(), `update ${receiptNo}`)).id : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledger = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: date, direction: "income", category: "sale", amount_xof: amount, amount_cny: null, description: notes };
  if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), `update ledger ${receiptNo}`); else await checked(supabase.from("ledger_entries").insert(ledger), `insert ledger ${receiptNo}`);
}

for (const unitNo of unitNos) {
  const spec = specs[unitNo]; const unit = unitByNo[unitNo]; const sale = saleByNo[unitNo];
  const notes = `来源：3号公寓.xlsx；B座11层四套打包总价41000万FCFA，Excel未列单套价格；经用户确认，按3号楼B座同户型已确认售价中位数（三室16000万、一室5000万、二室10750万）作为基准，再统一应用整层折扣系数${packageFactor.toFixed(8)}推算；${unitNo}${spec.layout}合同价为${spec.total / 10_000}万FCFA。此金额为推算分摊价，不是Excel原始单套价格。`;
  await checked(supabase.from("sale_contracts").update({ signed_date: "2020-05-08", payment_plan_type: "installment", total_amount_xof: spec.total }).eq("id", sale.id), `update ${unitNo} sale`);
  for (let index = 0; index < packagePayments.length; index += 1) {
    const [date, packageAmount] = packagePayments[index]; const amount = allocatedByUnit[unitNo][index];
    await upsertPayment({ unitNo, receiptNo: `WB3-SALE-${unitNo.slice(1)}-${date.replaceAll("-", "")}-PACKAGE-${String(index + 1).padStart(2, "0")}`, date, amount, notes: `${notes} 本笔由${date}整层原始收款${packageAmount / 10_000}万FCFA按相同比例分摊，本房分摊${amount / 10_000}万FCFA。` });
  }
  const receivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).neq("status", "cancelled"), `load ${unitNo} receivable`);
  if (receivables.length > 1) throw new Error(`Unexpected ${unitNo} receivable count`);
  const receivable = { building_id: building.id, unit_id: unit.id, customer_id: sale.customer_id, source_type: "sale_contract", source_id: sale.id, category: "sale_installment", title: `3# ${unitNo}购房款（11层打包分摊）`, due_date: "2020-05-16", amount_xof: spec.total, paid_amount_xof: spec.total, status: "paid", currency: "XOF", notes };
  if (receivables.length) await checked(supabase.from("receivables").update(receivable).eq("id", receivables[0].id), `update ${unitNo} receivable`); else await checked(supabase.from("receivables").insert(receivable), `insert ${unitNo} receivable`);
  await checked(supabase.from("units").update({ status: "sold", notes: `${notes}\n四笔整层付款已按同一比例分摊；本房分摊合计${spec.total / 10_000}万FCFA，已结清；Excel未记注册金、税款、FULO提成或过户状态。` }).eq("id", unit.id), `update ${unitNo} unit`);
}

const verified = await checked(supabase.from("payments").select("source_id, payment_date, amount, source_type").in("source_id", sales.map((sale) => sale.id)), "verify B11F payments");
if (verified.length !== 16 || verified.some((payment) => payment.source_type !== "sale_contract") || verified.reduce((sum, payment) => sum + Number(payment.amount), 0) !== packageTotal) throw new Error("Unexpected B11F payment total");
for (const unitNo of unitNos) {
  const rows = verified.filter((payment) => payment.source_id === saleByNo[unitNo].id);
  if (rows.length !== 4 || rows.reduce((sum, payment) => sum + Number(payment.amount), 0) !== specs[unitNo].total) throw new Error(`Unexpected ${unitNo} payment total`);
}
for (const [date, amount] of packagePayments) {
  const rows = verified.filter((payment) => payment.payment_date === date);
  if (rows.length !== 4 || rows.reduce((sum, payment) => sum + Number(payment.amount), 0) !== amount) throw new Error(`Unexpected package total on ${date}`);
}
await checked(supabase.from("audit_logs").insert({ action: "reconcile_sacsi3_b1101_b1104", entity_type: "building", entity_id: building.id, metadata: { building_code: "SACSI3", floor: "B11F", package_total_xof: packageTotal, benchmark: { method: "confirmed_same_layout_median", three_bed_xof: 160_000_000, one_bed_xof: 50_000_000, two_bed_xof: 107_500_000, benchmark_total_xof: benchmarkTotal, package_factor: packageFactor }, inferred_unit_prices: Object.fromEntries(unitNos.map((unitNo) => [unitNo, { buyer: specs[unitNo].buyer, layout: specs[unitNo].layout, total_xof: specs[unitNo].total }])), original_package_payments: packagePayments.map(([date, amount]) => ({ date, amount_xof: amount })), payment_allocation_preserves_each_original_date_total: true, inferred_not_original_unit_prices: true, settled: true } }), "write B11F audit");
console.log(JSON.stringify({ ok: true, floor: "B11F", package_total_xof: packageTotal, allocations: Object.fromEntries(unitNos.map((unitNo) => [unitNo, specs[unitNo].total])), payment_count: 16, settled: true }));
