import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
  const i = line.indexOf("=");
  return [line.slice(0, i), line.slice(i + 1)];
}));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI4").single(), "load building");
const units = await checked(supabase.from("units").select("id, unit_no").eq("building_id", building.id), "load units");
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));

const parkingSpecs = [
  ["101", "WB4-SALE-101-20210803-PARKING-01"],
  ["103", "WB4-SALE-103-20220920-PARKING-01"],
  ["105", "WB4-SALE-105-20210317-PARKING-01"],
  ["107", "WB4-SALE-107-20221003-PARKING-01"],
  ["109", "WB4-SALE-109-20210907-PARKING-01"],
  ["110", "WB4-SALE-110-20220528-PARKING-01"],
  ["112", "WB4-SALE-112-20220512-PARKING-01"],
  ["209", "WB4-SALE-209-20210316-PARKING-01"],
  ["210", "WB4-SALE-210-20211021-PARKING-01"],
  ["405", "WB4-SALE-405-20220912-PARKING-01"],
  ["411", "WB4-SALE-411-20240507-PARKING-01"],
];

const saleExtraReceipts = [
  "WB4-SALE-111-20211214-TRANSFERTAX-01",
  "WB4-SALE-201-20230502-REGISTRATION-01",
  "WB4-SALE-201-20230620-TRANSFERTAX-01",
  "WB4-SALE-207-20201209-REGISTRATION-01",
  "WB4-SALE-305-20200724-REGISTRATION-01",
  "WB4-SALE-305-20221123-FURNITURE-01",
  "WB4-SALE-305-20221123-DELIVERY-01",
  "WB4-SALE-305-20221123-INSTALLATION-01",
  "WB4-SALE-307-20200619-REGISTRATION-01",
  "WB4-SALE-307-20200619-DEPOSIT-01",
  "WB4-SALE-307-20220531-FURNITURE-01",
  "WB4-SALE-308-20230620-TRANSFERTAX-01",
  "WB4-SALE-309-20200623-REGISTRATION-01",
  "WB4-SALE-309-20200623-OTHER-01",
  "WB4-SALE-309-20220413-OTHER-02",
  "WB4-SALE-309-20220531-FURNITURE-01",
  "WB4-SALE-403-20230920-REGISTRATION-01",
  "WB4-SALE-406-20250602-REGISTRATION-01",
  "WB4-SALE-409-20250612-TRANSFERTAX-01",
  "WB4-SALE-410-20230721-DOCUMENT-01",
];

const leaseMissingReceipts = [
  "WB4-LEASE-401-20230508-RENT-01",
  "WB4-LEASE-401-20230508-PROP-02",
  "WB4-LEASE-404-20241230-RENT-04",
  "WB4-LEASE-404-20241230-PROP-05",
  "WB4-LEASE-404-20250630-RENT-06",
  "WB4-LEASE-404-20250630-PROP-07",
  "WB4-LEASE-404-20251230-RENT-08",
  "WB4-LEASE-404-20251230-PROP-09",
  "WB4-LEASE-409-20220308-RENT-01",
  "WB4-LEASE-409-20220308-PROP-02",
  "WB4-LEASE-409-20230520-RENT-07",
  "WB4-LEASE-409-20230520-PROP-08",
  "WB4-LEASE-409-20250228-RENT-02",
  "WB4-LEASE-409-20250228-PROP-03",
  "WB4-LEASE-409-20250825-RENT-04",
  "WB4-LEASE-409-20250825-PROP-05",
  "WB4-LEASE-410-20210812-RENT-02",
  "WB4-LEASE-411-20221213-RENT-04",
  "WB4-LEASE-411-20221213-PROP-05",
  "WB4-LEASE-411-20230529-RENT-06",
  "WB4-LEASE-411-20230529-PROP-07",
  "WB4-LEASE-411-20231130-RENT-08",
  "WB4-LEASE-411-20231130-PROP-09",
];

function amountXof(payment) {
  return payment.currency === "XOF" ? Number(payment.amount) : Math.round(Number(payment.amount) * Number(payment.exchange_rate_to_xof));
}

async function loadPayment(receiptNo) {
  return checked(supabase.from("payments").select("id, customer_id, unit_id, source_id, source_type, payment_date, amount, currency, exchange_rate_to_xof, receipt_no, notes").eq("receipt_no", receiptNo).single(), `load ${receiptNo}`);
}

async function upsertReceivableForPayment(payment, { sourceType, category, title }) {
  const amount = amountXof(payment);
  const existing = await checked(supabase.from("receivables").select("id, notes").eq("source_id", payment.source_id).eq("source_type", sourceType).neq("status", "cancelled"), `find receivable ${payment.receipt_no}`);
  const linked = existing.filter((row) => (row.notes ?? "").includes(payment.receipt_no));
  if (linked.length > 1) throw new Error(`Duplicate linked receivables for ${payment.receipt_no}`);
  const notes = `${payment.notes ?? title}\n收据号：${payment.receipt_no}`;
  const payload = {
    building_id: building.id,
    unit_id: payment.unit_id,
    customer_id: payment.customer_id,
    source_type: sourceType,
    source_id: payment.source_id,
    category,
    title,
    due_date: payment.payment_date,
    amount_xof: amount,
    paid_amount_xof: amount,
    status: "paid",
    currency: "XOF",
    notes,
  };
  if (linked.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", linked[0].id), `update receivable ${payment.receipt_no}`);
  else await checked(supabase.from("receivables").insert(payload), `insert receivable ${payment.receipt_no}`);
}

function saleExtraTitle(unitNo, payment) {
  const receipt = payment.receipt_no;
  if (payment.source_type === "sale_registration_fee" || receipt.includes("REGISTRATION")) return `${unitNo}注册金`;
  if (receipt.includes("TRANSFERTAX")) return `${unitNo}过户税代收`;
  if (receipt.includes("FURNITURE")) return `${unitNo}衣柜款`;
  if (receipt.includes("DELIVERY")) return `${unitNo}运费`;
  if (receipt.includes("INSTALLATION")) return `${unitNo}安装费`;
  if (receipt.includes("DOCUMENT")) return `${unitNo}文件费`;
  return `${unitNo}出售其他收入`;
}

for (const [unitNo, receiptNo] of parkingSpecs) {
  const payment = await loadPayment(receiptNo);
  if (payment.unit_id !== unitByNo[unitNo]?.id || amountXof(payment) !== 5_000_000) throw new Error(`Unexpected parking payment ${receiptNo}`);
  await checked(supabase.from("payments").update({ source_type: "sale_other_income", notes: `${unitNo}车位款500万，与房款分列；合同总价保持不变。` }).eq("id", payment.id), `classify parking ${unitNo}`);
  await checked(supabase.from("ledger_entries").update({ direction: "income", category: "sale_other_income", description: `${unitNo}车位款500万，与房款分列；合同总价保持不变。` }).eq("payment_id", payment.id), `classify parking ledger ${unitNo}`);

  const sale = await checked(supabase.from("sale_contracts").select("id, total_amount_xof").eq("id", payment.source_id).single(), `load sale ${unitNo}`);
  const lumpRows = await checked(supabase.from("receivables").select("id, notes").eq("source_id", sale.id).eq("source_type", "sale_contract").eq("category", "sale_lump_sum").neq("status", "cancelled"), `load lump receivable ${unitNo}`);
  if (lumpRows.length !== 1) throw new Error(`Expected one lump receivable for ${unitNo}, got ${lumpRows.length}`);
  const houseAmount = Number(sale.total_amount_xof) - 5_000_000;
  const marker = `全盘复核：合同总价中的车位款500万已单列，房款应收为${houseAmount / 10_000}万。`;
  const lumpNotes = (lumpRows[0].notes ?? "").includes("全盘复核：合同总价中的车位款") ? lumpRows[0].notes : `${lumpRows[0].notes ?? ""}\n${marker}`.trim();
  await checked(supabase.from("receivables").update({ amount_xof: houseAmount, paid_amount_xof: houseAmount, status: "paid", title: `${unitNo}房款`, notes: lumpNotes }).eq("id", lumpRows[0].id), `split house receivable ${unitNo}`);

  const refreshedPayment = { ...payment, source_type: "sale_other_income", notes: `${unitNo}车位款500万，与房款分列；合同总价保持不变。` };
  await upsertReceivableForPayment(refreshedPayment, { sourceType: "sale_contract", category: "other", title: `${unitNo}车位款` });
}

for (const receiptNo of saleExtraReceipts) {
  const payment = await loadPayment(receiptNo);
  const unitNo = units.find((unit) => unit.id === payment.unit_id)?.unit_no;
  if (!unitNo) throw new Error(`Missing unit for ${receiptNo}`);
  await upsertReceivableForPayment(payment, { sourceType: "manual", category: "other", title: saleExtraTitle(unitNo, payment) });
}

for (const receiptNo of leaseMissingReceipts) {
  const payment = await loadPayment(receiptNo);
  const unitNo = units.find((unit) => unit.id === payment.unit_id)?.unit_no;
  if (!unitNo || !["lease_rent", "property_fee"].includes(payment.source_type)) throw new Error(`Unexpected lease payment ${receiptNo}`);
  await upsertReceivableForPayment(payment, {
    sourceType: "lease_contract",
    category: payment.source_type === "lease_rent" ? "lease_rent" : "other",
    title: payment.source_type === "lease_rent" ? `${unitNo}租金` : `${unitNo}物业费`,
  });
}

for (const [unitNo, receiptNo] of parkingSpecs) {
  const payment = await loadPayment(receiptNo);
  const ledger = await checked(supabase.from("ledger_entries").select("category, direction").eq("payment_id", payment.id).single(), `verify parking ledger ${unitNo}`);
  if (payment.source_type !== "sale_other_income" || ledger.category !== "sale_other_income" || ledger.direction !== "income") throw new Error(`Parking classification failed for ${unitNo}`);
  const sale = await checked(supabase.from("sale_contracts").select("total_amount_xof").eq("id", payment.source_id).single(), `verify sale ${unitNo}`);
  const recs = await checked(supabase.from("receivables").select("category, title, amount_xof, paid_amount_xof, status").eq("source_id", payment.source_id).eq("source_type", "sale_contract").neq("status", "cancelled"), `verify sale receivables ${unitNo}`);
  const total = recs.reduce((sum, row) => sum + Number(row.amount_xof), 0);
  const paid = recs.reduce((sum, row) => sum + Number(row.paid_amount_xof), 0);
  const parking = recs.filter((row) => row.title === `${unitNo}车位款` && Number(row.amount_xof) === 5_000_000);
  if (total !== Number(sale.total_amount_xof) || paid !== Number(sale.total_amount_xof) || parking.length !== 1 || recs.some((row) => row.status !== "paid")) throw new Error(`Sale receivable split failed for ${unitNo}`);
}

for (const receiptNo of [...saleExtraReceipts, ...leaseMissingReceipts]) {
  const payment = await loadPayment(receiptNo);
  const expectedSourceType = saleExtraReceipts.includes(receiptNo) ? "manual" : "lease_contract";
  const linked = await checked(supabase.from("receivables").select("id, amount_xof, paid_amount_xof, status").eq("source_id", payment.source_id).eq("source_type", expectedSourceType).neq("status", "cancelled").ilike("notes", `%${receiptNo}%`), `verify ${receiptNo}`);
  if (linked.length !== 1 || Number(linked[0].amount_xof) !== amountXof(payment) || Number(linked[0].paid_amount_xof) !== amountXof(payment) || linked[0].status !== "paid") throw new Error(`Receivable repair failed for ${receiptNo}`);
}

await checked(supabase.from("audit_logs").insert({
  action: "reconcile_full_audit_batch",
  entity_type: "building",
  entity_id: building.id,
  metadata: {
    building_code: "SACSI4",
    batch: 1,
    parking_payments_reclassified: parkingSpecs.length,
    parking_total_xof: 55_000_000,
    sale_extra_receivables_added: saleExtraReceipts.length,
    sale_extra_total_xof: 14_200_000,
    lease_receivables_added: leaseMissingReceipts.length,
    lease_receivable_total_xof: 37_590_000,
    payment_amounts_changed: false,
    contract_totals_changed: false,
  },
}), "write audit log");

console.log(JSON.stringify({
  ok: true,
  parking_payments_reclassified: parkingSpecs.length,
  parking_total_xof: 55_000_000,
  sale_extra_receivables_added: saleExtraReceipts.length,
  sale_extra_total_xof: 14_200_000,
  lease_receivables_added: leaseMissingReceipts.length,
  lease_receivable_total_xof: 37_590_000,
  payment_amounts_changed: false,
  contract_totals_changed: false,
}));
