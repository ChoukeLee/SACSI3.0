import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
  const index = line.indexOf("=");
  return [line.slice(0, index), line.slice(index + 1)];
}));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI3").single(), "load building");
const unitNos = ["B503", "B504", "B601", "B602", "B603"];
const units = await checked(supabase.from("units").select("id, unit_no, area_sqm").eq("building_id", building.id).in("unit_no", unitNos), "load units");
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));
if (units.length !== unitNos.length) throw new Error("Missing target unit");
const sales = await checked(supabase.from("sale_contracts").select("id, unit_id, customer_id, total_amount_xof").in("unit_id", units.map((unit) => unit.id)).eq("status", "active"), "load sales");
const saleByUnitNo = Object.fromEntries(unitNos.map((unitNo) => [unitNo, sales.find((sale) => sale.unit_id === unitByNo[unitNo].id)]));
if (Object.values(saleByUnitNo).some((sale) => !sale)) throw new Error("Missing target sale");
const customers = await checked(supabase.from("customers").select("id, name").in("id", sales.map((sale) => sale.customer_id)), "load buyers");
const customerById = Object.fromEntries(customers.map((customer) => [customer.id, customer]));

const specs = {
  B503: {
    buyer: "SCMAN", area: 115.44, signedDate: "2021-03-03", total: 108_500_000, plan: "lump_sum",
    house: [{ date: "2021-03-03", amount: 108_500_000, amountXof: 108_500_000 }],
    extras: [
      { date: "2021-03-03", amount: 300_000, type: "sale_registration_fee", code: "REGISTRATION-01", category: "sale_registration_fee", notes: "注册金30万FCFA；Excel未记日期，以首笔房款日作为占位日期。" },
      { date: "2021-03-09", amount: 3_255_000, type: "sale_other_income", code: "TRANSFER-TAX-01", category: "sale_transfer_tax", notes: "实际税款325.5万FCFA；按Excel实际金额登记，不计算差额。" },
    ],
    agency: { company: "FULO", paidDate: "2021-04-07" },
  },
  B504: {
    buyer: "SHAKO", area: 173.51, signedDate: "2020-07-09", total: 155_700_000, plan: "lump_sum",
    house: [{ date: "2020-07-09", amount: 155_700_000, amountXof: 155_700_000 }],
    extras: [{ date: "2020-07-22", amount: 4_610_000, type: "sale_other_income", code: "TRANSFER-TAX-01", category: "sale_transfer_tax", notes: "实际税款461万FCFA；按Excel实际金额登记，不计算差额。" }],
    agency: { company: "FULO", paidDate: "2020-11-12" },
  },
  B601: {
    buyer: "孔辉", area: 173.51, signedDate: "2021-06-24", total: 155_700_000, plan: "installment",
    house: [
      { date: "2021-06-24", amount: 20_000_000, amountXof: 20_000_000 },
      { date: "2021-07-23", amount: 40_000_000, amountXof: 40_000_000 },
      { date: "2021-07-23", amount: 68_000_000, amountXof: 68_000_000 },
      { date: "2021-07-28", amount: 27_700_000, amountXof: 27_700_000 },
    ],
    extras: [], agency: null,
  },
  B602: {
    buyer: "ABON", area: 54.99, signedDate: "2020-09-22", total: 50_000_000, plan: "installment",
    house: [
      { date: "2020-09-29", amount: 45_500_000, amountXof: 45_500_000 },
      { date: "2020-09-22", amount: 3_000_000, amountXof: 3_000_000, internal: true, notes: "由2# A8房300万内部转入B602房款；仅结清应收，不重复统计为新增现金收入。" },
      { date: "2020-09-22", amount: 1_500_000, amountXof: 1_500_000, internal: true, notes: "由3# B702税收150万内部转入B602房款；仅结清应收，不重复统计为新增现金收入。" },
    ],
    extras: [{ date: "2020-11-12", amount: 1_500_000, type: "sale_other_income", code: "TRANSFER-TAX-01", category: "sale_transfer_tax", notes: "B602实际税款150万FCFA；与2020-09-22从B702转入房款的150万为不同事项。" }],
    agency: { company: "FULO", paidDate: "2020-11-12" },
  },
  B603: {
    buyer: "法国人（原于洁转售，姓名待补）", area: 115.44, signedDate: "2020-09-30", total: 98_124_000, plan: "lump_sum",
    house: [{ date: "2020-09-30", amount: 1_128_426, currency: "CNY", rate: 98_124_000 / 1_128_426, amountXof: 98_124_000, notes: "原款人民币1128426元转高峰，折合9812.4万FCFA。" }],
    extras: [{ date: "2022-01-14", amount: 2_490_000, type: "sale_other_income", code: "TRANSFER-TAX-01", category: "sale_transfer_tax", notes: "实际税款249万FCFA；按Excel实际金额登记，不计算差额。" }],
    agency: null,
  },
};

async function upsertPayment({ unitNo, sourceId, receiptNo, legacyReceiptNo, date, amount, amountXof, currency = "XOF", rate = 1, sourceType, direction, category, notes, createLedger = true }) {
  const unit = unitByNo[unitNo];
  const customer = customerById[saleByUnitNo[unitNo].customer_id];
  let rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (!rows.length && legacyReceiptNo) rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", legacyReceiptNo), `find ${legacyReceiptNo}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const payload = { customer_id: customer.id, unit_id: unit.id, source_type: sourceType, source_id: sourceId, payment_date: date, amount, currency, exchange_rate_to_xof: rate, receipt_no: receiptNo, notes };
  const paymentId = rows.length
    ? (await checked(supabase.from("payments").update(payload).eq("id", rows[0].id).select("id").single(), `update ${receiptNo}`)).id
    : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  if (!createLedger) {
    if (ledgers.length) await checked(supabase.from("ledger_entries").delete().eq("id", ledgers[0].id), `remove internal-transfer ledger ${receiptNo}`);
    return;
  }
  const ledger = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: date, direction, category, amount_xof: amountXof, amount_cny: currency === "CNY" ? amount : null, description: notes };
  if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), `update ledger ${receiptNo}`);
  else await checked(supabase.from("ledger_entries").insert(ledger), `insert ledger ${receiptNo}`);
}

for (const unitNo of unitNos) {
  const spec = specs[unitNo];
  const unit = unitByNo[unitNo];
  const sale = saleByUnitNo[unitNo];
  const customer = customerById[sale.customer_id];
  if (customer.name !== spec.buyer || Number(unit.area_sqm) !== spec.area || Number(sale.total_amount_xof) !== spec.total) throw new Error(`Unexpected ${unitNo} source data`);
  const houseNotes = `来源：3号公寓.xlsx；${unitNo}买方${spec.buyer}；合同总价${spec.total / 10_000}万FCFA；房款已结清。`;
  await checked(supabase.from("sale_contracts").update({ signed_date: spec.signedDate, payment_plan_type: spec.plan, agency_company: spec.agency?.company ?? null, agency_commission_amount_xof: null, agency_commission_paid: Boolean(spec.agency) }).eq("id", sale.id), `update ${unitNo} sale`);
  for (let index = 0; index < spec.house.length; index += 1) {
    const payment = spec.house[index];
    const notes = `${houseNotes} ${payment.notes ?? `${payment.date}收房款${payment.amountXof / 10_000}万FCFA。`}`;
    await upsertPayment({ unitNo, sourceId: sale.id, receiptNo: `WB3-SALE-${unitNo.slice(1)}-${payment.date.replaceAll("-", "")}-HOUSE-${String(index + 1).padStart(2, "0")}`, legacyReceiptNo: index === 0 ? `S3-SALE-${unitNo}-CONSOLIDATED` : null, date: payment.date, amount: payment.amount, amountXof: payment.amountXof, currency: payment.currency, rate: payment.rate, sourceType: "sale_contract", direction: "income", category: "sale", notes, createLedger: !payment.internal });
  }
  for (const extra of spec.extras) {
    const notes = `来源：3号公寓.xlsx；${unitNo} ${extra.notes} 不计入合同总价。`;
    await upsertPayment({ unitNo, sourceId: sale.id, receiptNo: `WB3-SALE-${unitNo.slice(1)}-${extra.date.replaceAll("-", "")}-${extra.code}`, date: extra.date, amount: extra.amount, amountXof: extra.amount, sourceType: extra.type, direction: "income", category: extra.category, notes });
  }
  const receivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).neq("status", "cancelled"), `load ${unitNo} receivable`);
  if (receivables.length !== 1) throw new Error(`Unexpected ${unitNo} receivable count`);
  await checked(supabase.from("receivables").update({ category: spec.plan === "installment" ? "sale_installment" : "sale_lump_sum", title: `3# ${unitNo}购房款`, due_date: spec.house.at(-1).date, amount_xof: spec.total, paid_amount_xof: spec.total, status: "paid", currency: "XOF", notes: houseNotes }).eq("id", receivables[0].id), `update ${unitNo} receivable`);
  const extraNotes = spec.extras.map((extra) => extra.notes).join("；");
  const agencyNotes = spec.agency ? `FULO提成于${spec.agency.paidDate}支付，金额待补。` : "Excel未记FULO提成。";
  const specialNotes = unitNo === "B602" ? "其中450万为跨房内部转入，仅用于结清房款，不作为本房新增现金收入。" : unitNo === "B603" ? "原款人民币1128426元，折合9812.4万FCFA。" : "";
  await checked(supabase.from("units").update({ status: "sold", notes: `${houseNotes}\n${extraNotes}\n${agencyNotes}\n${specialNotes}\n过户状态不推断。`.trim() }).eq("id", unit.id), `update ${unitNo} unit`);
}

const verifiedPayments = await checked(supabase.from("payments").select("unit_id, source_id, source_type, amount, currency, exchange_rate_to_xof").in("source_id", sales.map((sale) => sale.id)), "verify batch payments");
const verifiedLedgers = await checked(supabase.from("ledger_entries").select("unit_id, payment_id, direction, category, amount_xof").in("unit_id", units.map((unit) => unit.id)), "verify batch ledgers");
for (const unitNo of unitNos) {
  const spec = specs[unitNo];
  const sale = saleByUnitNo[unitNo];
  const rows = verifiedPayments.filter((row) => row.source_id === sale.id);
  const houseRows = rows.filter((row) => row.source_type === "sale_contract");
  const houseXof = houseRows.reduce((sum, row) => sum + (row.currency === "CNY" ? Number(row.amount) * Number(row.exchange_rate_to_xof) : Number(row.amount)), 0);
  if (houseRows.length !== spec.house.length || Math.abs(houseXof - spec.total) > 1) throw new Error(`Unexpected ${unitNo} house total`);
}
const b602InternalReceipts = ["WB3-SALE-602-20200922-HOUSE-02", "WB3-SALE-602-20200922-HOUSE-03"];
const b602InternalPayments = await checked(supabase.from("payments").select("id").in("receipt_no", b602InternalReceipts), "load B602 internal payments");
if (verifiedLedgers.some((ledger) => b602InternalPayments.some((payment) => payment.id === ledger.payment_id))) throw new Error("B602 internal transfers must not create income ledgers");

await checked(supabase.from("audit_logs").insert({ action: "reconcile_sacsi3_b503_b603", entity_type: "building", entity_id: building.id, metadata: { units: { B503: { total_xof: 108_500_000, registration_xof: 300_000, actual_tax_xof: 3_255_000, settled: true }, B504: { total_xof: 155_700_000, actual_tax_xof: 4_610_000, settled: true }, B601: { total_xof: 155_700_000, payment_count: 4, settled: true }, B602: { total_xof: 50_000_000, external_house_cash_xof: 45_500_000, internal_allocation_xof: 4_500_000, internal_sources: ["2# A8", "3# B702税收"], internal_allocation_counted_as_new_income: false, actual_tax_xof: 1_500_000, settled: true }, B603: { buyer_name_pending: true, total_xof: 98_124_000, original_cny: 1_128_426, implied_rate_to_xof: 98_124_000 / 1_128_426, actual_tax_xof: 2_490_000, settled: true } }, actual_tax_difference_tracking: false, transfer_status_inferred: false } }), "write batch audit log");

console.log(JSON.stringify({ ok: true, units: unitNos, settled: unitNos, B602_internal_allocation_xof: 4_500_000, B603_original_cny: 1_128_426 }));
