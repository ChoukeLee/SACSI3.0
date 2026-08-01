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

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI4").single(), "load building");
const units = await checked(
  supabase.from("units").select("id, unit_no").eq("building_id", building.id).in("unit_no", ["204", "211"]),
  "load units 204 and 211",
);
if (units.length !== 2) throw new Error(`Expected two units, got ${units.length}`);
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));

const specs = {
  "204": {
    total: 75_000_000,
    allocation: 37_500_000,
    customer: "\u6768\u745e\u4e66\u3001\u5f20\u6770",
    giftNote: "\uff1b\u8d60\u9001\u505c\u8f66\u4f4d\uff0c\u8f66\u4f4d\u4ef7\u683c\u4e3a0\uff0c\u65e0\u8f66\u4f4d\u6b3e\u6536\u5165",
  },
  "211": {
    total: 55_000_000,
    allocation: 27_500_000,
    customer: "\u6768\u745e\u4e66\u3001\u848b\u53cb\u5e73",
    giftNote: "",
  },
};

async function upsertPayment({ sale, unitNo, date, amount, receipt, oldReceipts = [] }) {
  const spec = specs[unitNo];
  const candidates = await checked(
    supabase.from("payments").select("id").eq("source_id", sale.id).in("receipt_no", [receipt, ...oldReceipts]),
    `find ${receipt}`,
  );
  if (candidates.length > 1) throw new Error(`Duplicate payment candidates for ${receipt}`);
  const notes = `${unitNo}\u4e0e${unitNo === "204" ? "211" : "204"}\u6253\u5305\u8d2d\u4e70\uff0c\u672c\u6b21\u5171\u540c\u4ed8\u6b3e6500\u4e07\uff1b\u6309\u4e24\u95f4\u5408\u540c\u4ef7\u683c7500:5500\u6bd4\u4f8b\u5206\u914d\u81f3${unitNo}\u623f\u6b3e${amount / 10_000}\u4e07${spec.giftNote}\u3002`;
  const payload = {
    customer_id: sale.customer_id,
    unit_id: unitByNo[unitNo].id,
    source_type: "sale_contract",
    source_id: sale.id,
    payment_date: date,
    amount,
    currency: "XOF",
    exchange_rate_to_xof: 1,
    receipt_no: receipt,
    notes,
  };
  const paymentId = candidates.length === 1
    ? candidates[0].id
    : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receipt}`)).id;
  if (candidates.length === 1) await checked(supabase.from("payments").update(payload).eq("id", paymentId), `update ${receipt}`);

  const ledgerPayload = {
    building_id: building.id,
    unit_id: unitByNo[unitNo].id,
    payment_id: paymentId,
    entry_date: date,
    direction: "income",
    category: "sale",
    amount_xof: amount,
    amount_cny: null,
    description: notes,
  };
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receipt}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledgers for ${receipt}`);
  if (ledgers.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgers[0].id), `update ledger ${receipt}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${receipt}`);
}

const saleByNo = {};
for (const unitNo of ["204", "211"]) {
  const spec = specs[unitNo];
  const sale = await checked(
    supabase.from("sale_contracts").select("id, customer_id, signed_date, total_amount_xof").eq("unit_id", unitByNo[unitNo].id).single(),
    `load ${unitNo} sale`,
  );
  if (sale.signed_date !== "2021-02-15" || Number(sale.total_amount_xof) !== spec.total) {
    throw new Error(`Unexpected ${unitNo} sale: ${sale.signed_date} / ${sale.total_amount_xof}`);
  }
  saleByNo[unitNo] = sale;
  const contractNote = `${unitNo}\u4e0e${unitNo === "204" ? "211" : "204"}\u6253\u5305\u8d2d\u4e70\uff0c\u4e24\u95f4\u5408\u8ba113000\u4e07\uff1b2021-02-15\u548c2021-03-09\u5404\u5171\u540c\u4ed86500\u4e07\uff0c\u63097500:5500\u6bd4\u4f8b\u5206\u914d${spec.giftNote}\uff1b\u5df2\u7ed3\u6e05\u3002`;
  await checked(
    supabase.from("sale_contracts").update({
      contract_no: `WB-SALE-SACSI4-${unitNo}-20210215`,
      payment_plan_type: contractNote,
    }).eq("id", sale.id),
    `update ${unitNo} sale`,
  );

  await upsertPayment({
    sale,
    unitNo,
    date: "2021-02-15",
    amount: spec.allocation,
    receipt: `WB4-SALE-${unitNo}-20210215-HOUSE-01`,
    oldReceipts: [`S4-SALE-${unitNo}-CONSOLIDATED`],
  });
  await upsertPayment({
    sale,
    unitNo,
    date: "2021-03-09",
    amount: spec.allocation,
    receipt: `WB4-SALE-${unitNo}-20210309-HOUSE-02`,
  });

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
      notes: `\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx Sheet1\uff1b${unitNo}\u4e0e${unitNo === "204" ? "211" : "204"}\u6253\u5305\u4ed8\u6b3e13000\u4e07\uff0c\u63097500:5500\u6bd4\u4f8b\u5206\u914d\uff0c${unitNo}\u5408\u540c\u5df2\u7ed3\u6e05\u3002`,
    }).eq("id", receivables[0].id),
    `update ${unitNo} sale receivable`,
  );

  await checked(
    supabase.from("units").update({
      status: "sold",
      notes: `\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u4e1a\u4e3b/\u4e70\u65b9\uff1a${spec.customer}\uff1b${unitNo}\u4e0e${unitNo === "204" ? "211" : "204"}\u6253\u5305\u8d2d\u4e70\uff0c\u5408\u540c\u603b\u4ef7${spec.total / 10_000}\u4e07\uff0c\u5df2\u7ed3\u6e05${spec.giftNote}\u3002`,
    }).eq("id", unitByNo[unitNo].id),
    `update ${unitNo} unit note`,
  );
}

const verification = {};
for (const unitNo of ["204", "211"]) {
  const payments = await checked(
    supabase.from("payments").select("payment_date, amount, receipt_no, source_type").eq("source_id", saleByNo[unitNo].id).order("payment_date"),
    `verify ${unitNo} payments`,
  );
  if (payments.length !== 2 || payments.some((payment) => payment.source_type !== "sale_contract")) {
    throw new Error(`Unexpected ${unitNo} payment records: ${payments.length}`);
  }
  const total = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  if (total !== specs[unitNo].total) throw new Error(`Unexpected ${unitNo} payment total ${total}`);
  verification[unitNo] = { total, payments };
}
if (verification["204"].total + verification["211"].total !== 130_000_000) {
  throw new Error("Unexpected combined 204/211 payment total");
}

await checked(supabase.from("audit_logs").insert({
  action: "reconcile_joint_sale_payments",
  entity_type: "building",
  entity_id: building.id,
  metadata: {
    building_code: "SACSI4",
    units: ["204", "211"],
    joint_payment_dates: ["2021-02-15", "2021-03-09"],
    each_joint_payment_xof: 65_000_000,
    unit_204_total_xof: verification["204"].total,
    unit_211_total_xof: verification["211"].total,
    combined_total_xof: 130_000_000,
    unit_204_parking_gift: true,
    parking_income_xof: 0,
  },
}), "write 204/211 audit log");

console.log(JSON.stringify({ ok: true, units: verification }));
