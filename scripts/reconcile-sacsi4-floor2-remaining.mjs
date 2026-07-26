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

const cny210Rate = 65_000_000 / 735_000;
const specs = {
  "205": {
    buyer: "\u6768\u5c0f\u7ea2",
    signedDate: "2021-07-03",
    oldTotal: 60_000_000,
    total: 60_000_000,
    summary: "\u623f\u6b3e6000\u4e07\uff0c\u5206\u4e24\u7b14\u4ed8\u6e05\uff1b\u65e0\u8f66\u4f4d\u548c\u4ee3\u79df\u8bb0\u5f55\u3002",
    entries: [
      { date: "2021-07-03", amount: 30_000_000, receipt: "WB4-SALE-205-20210703-HOUSE-01", notes: "205\u7b2c\u4e00\u7b14\u623f\u6b3e3000\u4e07\u3002", oldReceipts: ["S4-SALE-205-CONSOLIDATED"] },
      { date: "2021-07-14", amount: 30_000_000, receipt: "WB4-SALE-205-20210714-HOUSE-02", notes: "205\u7b2c\u4e8c\u7b14\u623f\u6b3e3000\u4e07\uff1b\u623f\u6b3e\u5df2\u7ed3\u6e05\u3002" },
    ],
  },
  "206": {
    buyer: "\u6bdb\u6c38\u4f1f",
    signedDate: "2020-10-13",
    oldTotal: 70_000_000,
    total: 70_000_000,
    summary: "\u623f\u6b3e7000\u4e07\uff0c\u5206\u4e09\u7b14\u4ed8\u6e05\uff1b\u65e0\u8f66\u4f4d\u548c\u4ee3\u79df\u8bb0\u5f55\u3002",
    entries: [
      { date: "2020-10-13", amount: 30_000_000, receipt: "WB4-SALE-206-20201013-HOUSE-01", notes: "206\u7b2c\u4e00\u7b14\u623f\u6b3e3000\u4e07\u3002", oldReceipts: ["S4-SALE-206-CONSOLIDATED"] },
      { date: "2020-11-29", amount: 20_000_000, receipt: "WB4-SALE-206-20201129-HOUSE-02", notes: "206\u7b2c\u4e8c\u7b14\u623f\u6b3e2000\u4e07\u3002" },
      { date: "2021-01-03", amount: 20_000_000, receipt: "WB4-SALE-206-20210103-HOUSE-03", notes: "206\u7b2c\u4e09\u7b14\u623f\u6b3e2000\u4e07\uff1b\u623f\u6b3e\u5df2\u7ed3\u6e05\u3002" },
    ],
  },
  "207": {
    buyer: "DOUKOURE YAYA",
    signedDate: "2020-12-09",
    oldTotal: 68_500_000,
    total: 68_500_000,
    summary: "\u623f\u6b3e6850\u4e07\uff0c\u5206\u56db\u7b14\u4ed8\u6e05\uff1b\u6ce8\u518c\u91d125\u4e07\u53e6\u5217\uff1b\u65e0\u8f66\u4f4d\u548c\u4ee3\u79df\u8bb0\u5f55\u3002",
    entries: [
      { date: "2020-12-09", amount: 250_000, sourceType: "sale_registration_fee", category: "sale_registration_fee", receipt: "WB4-SALE-207-20201209-REGISTRATION-01", notes: "207\u6ce8\u518c\u91d125\u4e07\uff1b\u4e0d\u8ba1\u5165\u623f\u6b3e\u548c\u5408\u540c\u603b\u4ef7\u3002" },
      { date: "2022-10-07", amount: 25_000_000, receipt: "WB4-SALE-207-20221007-HOUSE-01", notes: "207\u7b2c\u4e00\u7b14\u623f\u6b3e2500\u4e07\uff1b\u539f\u8868\u6ce8\u8bb0\u5b58\u9ad8\u603b\u8d26\u53f7\u4e0a2\u5355\u3002", oldReceipts: ["S4-SALE-207-CONSOLIDATED"] },
      { date: "2022-11-28", amount: 33_500_000, receipt: "WB4-SALE-207-20221128-HOUSE-02", notes: "207\u7b2c\u4e8c\u7b14\u623f\u6b3e3350\u4e07\uff1b\u539f\u8868\u6ce8\u8bb0\u5b58\u9ad8\u603b\u8d26\u53f7\u4e0a2\u5355\u3002" },
      { date: "2023-01-17", amount: 9_500_000, receipt: "WB4-SALE-207-20230117-HOUSE-03", notes: "207\u7b2c\u4e09\u7b14\u623f\u6b3e950\u4e07\uff1b\u539f\u8868\u6ce8\u8bb0\u5b58\u9ad8\u603b\u8d26\u53f7\u4e0a1\u5355\u3002" },
      { date: "2023-01-21", amount: 500_000, receipt: "WB4-SALE-207-20230121-HOUSE-04", notes: "207\u7b2c\u56db\u7b14\u623f\u6b3e50\u4e07\uff1b\u623f\u6b3e\u5df2\u7ed3\u6e05\u3002" },
    ],
  },
  "208": {
    buyer: "DOUKOURE YAYA",
    signedDate: "2021-12-13",
    oldTotal: 87_000_000,
    total: 87_000_000,
    summary: "\u623f\u6b3e8700\u4e07\uff0c\u5206\u4e94\u7b14\u4ed8\u6e05\uff1b\u4e0e207\u4e3a\u540c\u4e00\u5ba2\u6237\u4f46\u65e0\u5171\u540c\u4ed8\u6b3e\u8bb0\u5f55\uff1b\u65e0\u8f66\u4f4d\u548c\u4ee3\u79df\u8bb0\u5f55\u3002",
    entries: [
      { date: "2021-12-13", amount: 70_000_000, receipt: "WB4-SALE-208-20211213-HOUSE-01", notes: "208\u7b2c\u4e00\u7b14\u623f\u6b3e7000\u4e07\u3002", oldReceipts: ["S4-SALE-208-CONSOLIDATED"] },
      { date: "2021-12-29", amount: 2_000_000, receipt: "WB4-SALE-208-20211229-HOUSE-02", notes: "208\u7b2c\u4e8c\u7b14\u623f\u6b3e200\u4e07\u3002" },
      { date: "2022-01-07", amount: 4_000_000, receipt: "WB4-SALE-208-20220107-HOUSE-03", notes: "208\u7b2c\u4e09\u7b14\u623f\u6b3e400\u4e07\u3002" },
      { date: "2022-01-11", amount: 7_000_000, receipt: "WB4-SALE-208-20220111-HOUSE-04", notes: "208\u7b2c\u56db\u7b14\u623f\u6b3e700\u4e07\u3002" },
      { date: "2022-01-20", amount: 4_000_000, receipt: "WB4-SALE-208-20220120-HOUSE-05", notes: "208\u7b2c\u4e94\u7b14\u623f\u6b3e400\u4e07\uff1b\u623f\u6b3e\u5df2\u7ed3\u6e05\u3002" },
    ],
  },
  "209": {
    buyer: "\u6768\u671b\u94a6",
    signedDate: "2020-05-05",
    oldTotal: 50_000_000,
    total: 55_000_000,
    summary: "\u623f\u6b3e5000\u4e07\u4e0e\u8f66\u4f4d\u6b3e500\u4e07\u5206\u5217\uff0c\u5408\u540c\u603b\u4ef75500\u4e07\uff0c\u5df2\u7ed3\u6e05\uff1b\u65e0\u4ee3\u79df\u8bb0\u5f55\u3002",
    entries: [
      { date: "2020-05-05", amount: 10_000_000, receipt: "WB4-SALE-209-20200505-HOUSE-01", notes: "209\u7b2c\u4e00\u7b14\u623f\u6b3e1000\u4e07\uff1b\u8f66\u4f4d\u6b3e\u53e6\u5217\u3002", oldReceipts: ["S4-SALE-209-CONSOLIDATED"] },
      { date: "2020-05-26", amount: 40_000_000, receipt: "WB4-SALE-209-20200526-HOUSE-02", notes: "209\u7b2c\u4e8c\u7b14\u623f\u6b3e4000\u4e07\uff1b\u623f\u6b3e\u5408\u8ba15000\u4e07\u3002" },
      { date: "2021-03-16", amount: 5_000_000, receipt: "WB4-SALE-209-20210316-PARKING-01", notes: "209\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u623f\u6b3e\u53e6\u5217\uff0c\u5408\u540c\u5df2\u7ed3\u6e05\u3002" },
    ],
  },
  "210": {
    buyer: "\u5b54\u8f89",
    signedDate: "2020-06-10",
    oldTotal: 65_000_000,
    total: 70_000_000,
    summary: "\u623f\u6b3e6500\u4e07\u7531CNY 735000\u652f\u4ed8\uff0c\u5012\u63a8\u6c47\u7387\u7ea688.4354\uff1b\u8f66\u4f4d\u6b3e500\u4e07\u53e6\u5217\uff0c\u5408\u540c\u603b\u4ef77000\u4e07\uff0c\u5df2\u7ed3\u6e05\uff1b\u65e0\u4ee3\u79df\u8bb0\u5f55\u3002",
    entries: [
      { date: "2020-06-10", amount: 735_000, amountXof: 65_000_000, currency: "CNY", rate: cny210Rate, receipt: "WB4-SALE-210-20200610-HOUSE-01", notes: "210\u623f\u6b3eCNY 735000\uff0c\u6298\u54086500\u4e07FCFA\uff1b\u6c47\u7387\u7531\u623f\u6b3e\u6298\u5408\u989d\u5012\u63a8\uff0c\u8f66\u4f4d\u6b3e\u53e6\u5217\u3002", oldReceipts: ["S4-SALE-210-CONSOLIDATED"] },
      { date: "2021-10-21", amount: 5_000_000, receipt: "WB4-SALE-210-20211021-PARKING-01", notes: "210\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u623f\u6b3e\u53e6\u5217\uff0c\u5408\u540c\u5df2\u7ed3\u6e05\u3002" },
    ],
  },
  "212": {
    buyer: "\u9648\u5efa\u4f1f",
    signedDate: "2020-10-13",
    oldTotal: 70_000_000,
    total: 70_000_000,
    summary: "\u623f\u6b3e7000\u4e07\uff0c\u5206\u4e09\u7b14\u4ed8\u6e05\uff1b\u4e0e206\u4ed8\u6b3e\u65e5\u671f\u91d1\u989d\u76f8\u540c\u4f46\u65e0\u8054\u5408\u4ed8\u6b3e\u8bb0\u5f55\uff1b\u65e0\u8f66\u4f4d\u548c\u4ee3\u79df\u8bb0\u5f55\u3002",
    entries: [
      { date: "2020-10-13", amount: 30_000_000, receipt: "WB4-SALE-212-20201013-HOUSE-01", notes: "212\u7b2c\u4e00\u7b14\u623f\u6b3e3000\u4e07\u3002", oldReceipts: ["S4-SALE-212-CONSOLIDATED"] },
      { date: "2020-11-29", amount: 20_000_000, receipt: "WB4-SALE-212-20201129-HOUSE-02", notes: "212\u7b2c\u4e8c\u7b14\u623f\u6b3e2000\u4e07\u3002" },
      { date: "2021-01-03", amount: 20_000_000, receipt: "WB4-SALE-212-20210103-HOUSE-03", notes: "212\u7b2c\u4e09\u7b14\u623f\u6b3e2000\u4e07\uff1b\u623f\u6b3e\u5df2\u7ed3\u6e05\u3002" },
    ],
  },
};

const unitNos = Object.keys(specs);
const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI4").single(), "load building");
const units = await checked(
  supabase.from("units").select("id, unit_no").eq("building_id", building.id).in("unit_no", unitNos),
  "load remaining floor 2 units",
);
if (units.length !== unitNos.length) throw new Error(`Expected ${unitNos.length} units, got ${units.length}`);
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));

async function upsertPayment(sale, unitNo, entry) {
  const rows = await checked(
    supabase.from("payments").select("id").eq("source_id", sale.id).in("receipt_no", [entry.receipt, ...(entry.oldReceipts ?? [])]),
    `find ${entry.receipt}`,
  );
  if (rows.length > 1) throw new Error(`Duplicate payment candidates for ${entry.receipt}`);
  const currency = entry.currency ?? "XOF";
  const rate = entry.rate ?? 1;
  const amountXof = entry.amountXof ?? entry.amount;
  const payload = {
    customer_id: sale.customer_id,
    unit_id: unitByNo[unitNo].id,
    source_type: entry.sourceType ?? "sale_contract",
    source_id: sale.id,
    payment_date: entry.date,
    amount: entry.amount,
    currency,
    exchange_rate_to_xof: rate,
    receipt_no: entry.receipt,
    notes: entry.notes,
  };
  const paymentId = rows.length === 1
    ? rows[0].id
    : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${entry.receipt}`)).id;
  if (rows.length === 1) await checked(supabase.from("payments").update(payload).eq("id", paymentId), `update ${entry.receipt}`);

  const ledgerPayload = {
    building_id: building.id,
    unit_id: unitByNo[unitNo].id,
    payment_id: paymentId,
    entry_date: entry.date,
    direction: "income",
    category: entry.category ?? "sale",
    amount_xof: amountXof,
    amount_cny: currency === "CNY" ? entry.amount : null,
    description: entry.notes,
  };
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${entry.receipt}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledgers for ${entry.receipt}`);
  if (ledgers.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgers[0].id), `update ledger ${entry.receipt}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${entry.receipt}`);
}

const verification = {};
for (const unitNo of unitNos) {
  const spec = specs[unitNo];
  const sale = await checked(
    supabase.from("sale_contracts").select("id, customer_id, signed_date, total_amount_xof").eq("unit_id", unitByNo[unitNo].id).single(),
    `load ${unitNo} sale`,
  );
  if (sale.signed_date !== spec.signedDate || ![spec.oldTotal, spec.total].includes(Number(sale.total_amount_xof))) {
    throw new Error(`Unexpected ${unitNo} sale: ${sale.signed_date} / ${sale.total_amount_xof}`);
  }
  await checked(
    supabase.from("sale_contracts").update({
      contract_no: `WB-SALE-SACSI4-${unitNo}-${spec.signedDate.replaceAll("-", "")}`,
      total_amount_xof: spec.total,
      payment_plan_type: spec.summary,
    }).eq("id", sale.id),
    `update ${unitNo} sale`,
  );
  for (const entry of spec.entries) await upsertPayment(sale, unitNo, entry);

  const receivables = await checked(
    supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum"),
    `load ${unitNo} sale receivable`,
  );
  if (receivables.length !== 1) throw new Error(`Expected one ${unitNo} sale receivable, got ${receivables.length}`);
  await checked(
    supabase.from("receivables").update({
      amount_xof: spec.total,
      paid_amount_xof: spec.total,
      status: "paid",
      notes: `\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx Sheet1\uff1b${spec.summary}`,
    }).eq("id", receivables[0].id),
    `update ${unitNo} sale receivable`,
  );
  await checked(
    supabase.from("units").update({
      status: "sold",
      notes: `\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u4e1a\u4e3b/\u4e70\u65b9\uff1a${spec.buyer}\uff1b${spec.summary}`,
    }).eq("id", unitByNo[unitNo].id),
    `update ${unitNo} unit note`,
  );

  const finalPayments = await checked(
    supabase.from("payments").select("source_type, amount, currency, exchange_rate_to_xof, receipt_no").eq("source_id", sale.id),
    `verify ${unitNo} payments`,
  );
  if (finalPayments.length !== spec.entries.length) throw new Error(`Unexpected ${unitNo} payment count ${finalPayments.length}`);
  const contractPaid = finalPayments
    .filter((payment) => payment.source_type === "sale_contract")
    .reduce((sum, payment) => sum + (payment.currency === "XOF"
      ? Number(payment.amount)
      : Math.round(Number(payment.amount) * Number(payment.exchange_rate_to_xof))), 0);
  if (contractPaid !== spec.total) throw new Error(`Unexpected ${unitNo} contract payment total ${contractPaid}`);
  verification[unitNo] = {
    contract_total_xof: spec.total,
    contract_paid_xof: contractPaid,
    payment_count: finalPayments.length,
    registration_income_xof: finalPayments
      .filter((payment) => payment.source_type === "sale_registration_fee")
      .reduce((sum, payment) => sum + Number(payment.amount), 0),
  };
}

await checked(supabase.from("audit_logs").insert({
  action: "reconcile_floor_sale_data",
  entity_type: "building",
  entity_id: building.id,
  metadata: {
    building_code: "SACSI4",
    floor: "2F",
    units: unitNos,
    verification,
    unit_209_parking_xof: 5_000_000,
    unit_210_house_cny: 735_000,
    unit_210_house_rate_to_xof: cny210Rate,
    unit_210_parking_xof: 5_000_000,
  },
}), "write floor 2 audit log");

console.log(JSON.stringify({ ok: true, floor: "2F", verification }));
