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
const unitNos = ["303", "304", "305", "306", "307", "308", "309", "310", "311", "312"];
const units = await checked(
  supabase.from("units").select("id, unit_no").eq("building_id", building.id).in("unit_no", unitNos),
  "load floor 3 units",
);
if (units.length !== unitNos.length) throw new Error(`Expected ${unitNos.length} units, got ${units.length}`);
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));

async function upsertLedger(paymentId, unitNo, entry) {
  const payload = {
    building_id: building.id,
    unit_id: unitByNo[unitNo].id,
    payment_id: paymentId,
    entry_date: entry.date,
    direction: entry.direction ?? "income",
    category: entry.ledgerCategory ?? (entry.sourceType === "sale_contract" ? "sale" : entry.sourceType),
    amount_xof: entry.amountXof ?? entry.amount,
    amount_cny: entry.currency === "CNY" ? entry.amount : null,
    description: entry.notes,
  };
  const rows = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${entry.receipt}`);
  if (rows.length > 1) throw new Error(`Duplicate ledger ${entry.receipt}`);
  if (rows.length === 1) await checked(supabase.from("ledger_entries").update(payload).eq("id", rows[0].id), `update ledger ${entry.receipt}`);
  else await checked(supabase.from("ledger_entries").insert(payload), `insert ledger ${entry.receipt}`);
}

async function upsertPayment(sourceId, customerId, unitNo, entry) {
  let rows = await checked(supabase.from("payments").select("id").eq("source_id", sourceId).eq("receipt_no", entry.receipt), `find ${entry.receipt}`);
  if (rows.length === 0 && entry.oldReceipt) {
    rows = await checked(supabase.from("payments").select("id").eq("source_id", sourceId).eq("receipt_no", entry.oldReceipt), `find ${entry.oldReceipt}`);
  }
  if (rows.length > 1) throw new Error(`Duplicate payment ${entry.receipt}`);
  const currency = entry.currency ?? "XOF";
  const payload = {
    customer_id: customerId,
    unit_id: unitByNo[unitNo].id,
    source_type: entry.sourceType,
    source_id: sourceId,
    payment_date: entry.date,
    amount: entry.amount,
    currency,
    exchange_rate_to_xof: entry.rate ?? 1,
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
  return paymentId;
}

const saleSpecs = {
  "303": {
    buyer: "DOUKOURE YAYA",
    signedDate: "2021-09-07",
    total: 87_250_000,
    summary: "\u6309Excel\u539f\u503c\u767b\u8bb0\u5408\u540c\u603b\u4ef78725\u4e07\uff0c\u516d\u7b14\u623f\u6b3e\u5df2\u7ed3\u6e05\uff1b\u4e0d\u62c6\u6ce8\u518c\u91d1\uff0c\u65e0\u8f66\u4f4d\u548c\u4ee3\u79df\u8bb0\u5f55\u3002",
    entries: [
      ["2021-09-07", 1_250_000, "HOUSE-01", "303\u623f\u6b3e125\u4e07\uff0c\u6309Excel\u539f\u503c\u767b\u8bb0\u3002", "S4-SALE-303-CONSOLIDATED"],
      ["2021-09-08", 59_000_000, "HOUSE-02", "303\u623f\u6b3e5900\u4e07\uff0c\u652f\u7968\u3002"],
      ["2021-09-09", 10_000_000, "HOUSE-03", "303\u623f\u6b3e1000\u4e07\u3002"],
      ["2021-09-24", 4_500_000, "HOUSE-04", "303\u623f\u6b3e450\u4e07\u3002"],
      ["2021-09-25", 2_000_000, "HOUSE-05", "303\u623f\u6b3e200\u4e07\u3002"],
      ["2021-09-30", 10_500_000, "HOUSE-06", "303\u623f\u6b3e1050\u4e07\uff0c\u6309Excel\u540c\u4e00\u5355\u5143\u683c\u76841000\u4e07\u652f\u7968\u4e0e50\u4e07\u5408\u5e76\u767b\u8bb0\uff1b\u5df2\u7ed3\u6e05\u3002"],
    ],
  },
  "304": {
    buyer: "\u79e6\u5fb7\u4eae",
    signedDate: "2026-06-12",
    total: 60_000_000,
    summary: "\u5408\u540c\u603b\u4ef76000\u4e07\uff0c2026-06-12\u548c2026-06-15\u5404\u65363000\u4e07\uff0c\u5df2\u7ed3\u6e05\uff1b\u65e0\u8f66\u4f4d\u8bb0\u5f55\u3002",
    entries: [
      ["2026-06-12", 30_000_000, "HOUSE-01", "304\u7b2c\u4e00\u7b14\u623f\u6b3e3000\u4e07\u3002", "S4-SALE-304-CONSOLIDATED"],
      ["2026-06-15", 30_000_000, "HOUSE-02", "304\u7b2c\u4e8c\u7b14\u623f\u6b3e3000\u4e07\uff1b\u5df2\u7ed3\u6e05\u3002"],
    ],
  },
  "305": {
    buyer: "VOUL JUST",
    signedDate: "2020-07-24",
    total: 66_600_000,
    summary: "\u623f\u6b3e6660\u4e07\u5df2\u7ed3\u6e05\uff1b\u6ce8\u518c\u91d125\u4e07\u3001\u8863\u67dc18\u4e07\u3001\u8fd0\u8d392\u4e07\u548c\u5b89\u88c5\u8d392\u4e07\u5747\u53e6\u5217\uff1b\u65e0\u8f66\u4f4d\u548c\u4ee3\u79df\u8bb0\u5f55\u3002",
    entries: [["2022-11-07", 66_600_000, "HOUSE-01", "305\u623f\u6b3e6660\u4e07\uff0c\u652f\u7968\uff1b\u5df2\u7ed3\u6e05\u3002", "S4-SALE-305-CONSOLIDATED"]],
    extras: [
      ["2020-07-24", 250_000, "sale_registration_fee", "REGISTRATION-01", "305\u6ce8\u518c\u91d125\u4e07\uff0c\u4e0d\u8ba1\u5165\u5408\u540c\u603b\u4ef7\u3002"],
      ["2022-11-23", 180_000, "sale_other_income", "FURNITURE-01", "305\u8863\u67dc\u6536\u6b3e18\u4e07\uff0c\u4e0e\u623f\u6b3e\u5206\u5217\u3002", "income", "sale_furniture_income"],
      ["2022-11-23", 20_000, "sale_other_income", "DELIVERY-01", "305\u8863\u67dc\u8fd0\u8d39\u6536\u51652\u4e07\uff0c\u5355\u5217\u3002", "income", "sale_delivery_income"],
      ["2022-11-23", 20_000, "sale_other_income", "INSTALLATION-01", "305\u8863\u67dc\u5b89\u88c5\u8d39\u6536\u51652\u4e07\uff0c\u5355\u5217\u3002", "income", "sale_installation_income"],
    ],
  },
  "306": {
    buyer: "\u502a\u5c0f\u4f1f",
    signedDate: "2020-10-13",
    total: 70_000_000,
    summary: "\u623f\u6b3e7000\u4e07\u5206\u4e09\u7b14\u4ed8\u6e05\uff1b\u65e0\u8f66\u4f4d\u548c\u4ee3\u79df\u8bb0\u5f55\u3002",
    entries: [
      ["2020-10-13", 30_000_000, "HOUSE-01", "306\u7b2c\u4e00\u7b14\u623f\u6b3e3000\u4e07\u3002", "S4-SALE-306-CONSOLIDATED"],
      ["2020-11-29", 20_000_000, "HOUSE-02", "306\u7b2c\u4e8c\u7b14\u623f\u6b3e2000\u4e07\u3002"],
      ["2021-01-03", 20_000_000, "HOUSE-03", "306\u7b2c\u4e09\u7b14\u623f\u6b3e2000\u4e07\uff1b\u5df2\u7ed3\u6e05\u3002"],
    ],
  },
  "307": {
    buyer: "OUATTARA",
    signedDate: "2020-06-19",
    total: 66_600_000,
    summary: "\u623f\u6b3e6660\u4e07\u5df2\u7ed3\u6e05\uff1b\u6ce8\u518c\u91d125\u4e07\u3001\u8863\u67dc19\u4e07\u53e6\u5217\uff1b\u4e34\u65f6\u6536\u6b3e75\u4e07\u5df2\u9000\uff1b\u65e0\u8f66\u4f4d\u548c\u4ee3\u79df\u8bb0\u5f55\u3002",
    entries: [["2022-05-31", 66_600_000, "HOUSE-01", "307\u623f\u6b3e6660\u4e07\uff0c\u652f\u7968\uff1b\u5df2\u7ed3\u6e05\u3002", "S4-SALE-307-CONSOLIDATED"]],
    extras: [
      ["2020-06-19", 250_000, "sale_registration_fee", "REGISTRATION-01", "307\u6ce8\u518c\u91d125\u4e07\uff0c\u5355\u5217\u3002"],
      ["2020-06-19", 750_000, "sale_other_income", "DEPOSIT-01", "307\u4e34\u65f6\u6536\u6b3e75\u4e07\uff1b2022-06-07\u5df2\u5168\u989d\u9000\u56de\u3002", "liability_in", "sale_deposit"],
      ["2022-05-31", 190_000, "sale_other_income", "FURNITURE-01", "307\u8863\u67dc\u6536\u6b3e19\u4e07\uff0c\u5b9e\u9645\u6536\u6b3e\u65e5\u671f\u672a\u8bb0\u8f7d\uff0c\u4ee5\u623f\u6b3e\u7ed3\u6e05\u65e5\u4f5c\u8d26\u52a1\u65e5\u3002", "income", "sale_furniture_income"],
      ["2022-06-07", 750_000, "sale_other_expense", "DEPREF-01", "307\u4e34\u65f6\u6536\u6b3e75\u4e07\u5df2\u9000\u3002", "liability_out", "sale_deposit_refund"],
    ],
  },
  "308": {
    buyer: "KOUROUMA",
    signedDate: "2019-11-14",
    total: 93_000_000,
    summary: "\u539f\u6807\u4ef79310\u4e07\uff0c\u51cf\u514d10\u4e07\u540e\u5408\u540c\u603b\u4ef79300\u4e07\uff0c\u5df2\u7ed3\u6e05\uff1b\u51fa\u552e\u4e2d\u4ecb\u8d39451.5\u4e07\u548c\u8fc7\u6237\u7a0e225\u4e07\u53e6\u5217\uff1bExcel\u6709\u4ee3\u79df\u6807\u8bb0\u4f46\u65e0\u53ef\u5f55\u79df\u7ea6\u6216\u79df\u91d1\u8bb0\u5f55\uff0c\u4e0d\u5efa\u7acb\u4ee3\u79df\u5408\u540c\u3002",
    agency: 4_515_000,
    entries: [
      ["2019-11-14", 30_000_000, "HOUSE-01", "308\u7b2c\u4e00\u7b14\u623f\u6b3e3000\u4e07\uff1b\u5176\u4e2d\u652f\u4ed8\u4e2d\u4ecb\u8d39451.5\u4e07\u53e6\u5217\u4e3a\u652f\u51fa\u3002", "S4-SALE-308-CONSOLIDATED"],
      ["2020-02-06", 23_000_000, "HOUSE-02", "308\u7b2c\u4e8c\u7b14\u623f\u6b3e2300\u4e07\u3002"],
      ["2020-08-27", 40_000_000, "HOUSE-03", "308\u7b2c\u4e09\u7b14\u623f\u6b3e4000\u4e07\uff1b\u51cf\u514d10\u4e07\u540e\u5df2\u7ed3\u6e05\u3002"],
    ],
    extras: [
      ["2019-11-14", 4_515_000, "sale_agency_expense", "AGENCY-01", "308\u51fa\u552e\u4e2d\u4ecb\u8d39451.5\u4e07\uff0c\u4ece\u9996\u7b143000\u4e07\u4e2d\u6263\u9664\uff0c\u5df2\u652f\u4ed8\u3002", "expense"],
      ["2023-06-20", 2_250_000, "sale_other_income", "TRANSFERTAX-01", "308\u8fc7\u6237\u7a0e\u4ee3\u6536225\u4e07\uff0c\u4ece201/308/506\u8054\u5408\u7a0e\u6b3e675\u4e07\u4e2d\u5e73\u5747\u5206\u644a\u3002", "liability_in", "sale_transfer_tax"],
    ],
  },
  "309": {
    buyer: "PAGNI",
    signedDate: "2020-06-23",
    total: 66_600_000,
    summary: "\u623f\u6b3e6660\u4e07\u5df2\u7ed3\u6e05\uff1b\u6ce8\u518c\u91d125\u4e07\u3001\u5176\u4ed6\u4e34\u65f6\u6536\u6b3e225\u4e07\u3001\u9000\u6b3e125\u4e07\u548c\u8863\u67dc19\u4e07\u5747\u53e6\u5217\uff1b\u539f\u8868\u8bb0\u8f7d\u4ece109\u8f6c\u5165\uff0c\u65e0\u4ee3\u79df\u8bb0\u5f55\u3002",
    entries: [["2022-05-31", 66_600_000, "HOUSE-01", "309\u623f\u6b3e6660\u4e07\uff0c\u652f\u7968\uff1b\u5df2\u7ed3\u6e05\u3002", "S4-SALE-309-CONSOLIDATED"]],
    extras: [
      ["2020-06-23", 250_000, "sale_registration_fee", "REGISTRATION-01", "309\u6ce8\u518c\u91d125\u4e07\uff0c\u5355\u5217\u3002"],
      ["2020-06-23", 1_750_000, "sale_other_income", "OTHER-01", "309\u539f\u8868\u540c\u65e5\u8bb0\u8f7d\u5176\u4ed6\u6536\u6b3e175\u4e07\uff0c\u7528\u9014\u672a\u6807\u660e\uff0c\u4e0d\u8ba1\u5165\u623f\u6b3e\u3002"],
      ["2022-04-13", 500_000, "sale_other_income", "OTHER-02", "309 PAGNI\u5176\u4ed6\u6536\u6b3e50\u4e07\uff0c\u7528\u9014\u672a\u6807\u660e\uff0c\u4e0d\u8ba1\u5165\u623f\u6b3e\u3002"],
      ["2022-05-31", 190_000, "sale_other_income", "FURNITURE-01", "309\u8863\u67dc\u6536\u6b3e19\u4e07\uff0c\u5b9e\u9645\u6536\u6b3e\u65e5\u671f\u672a\u8bb0\u8f7d\uff0c\u4ee5\u623f\u6b3e\u7ed3\u6e05\u65e5\u4f5c\u8d26\u52a1\u65e5\u3002", "income", "sale_furniture_income"],
      ["2022-06-07", 1_250_000, "sale_other_expense", "REFUND-01", "309\u9000\u6b3e125\u4e07\uff1b\u539f\u8868\u672a\u8bf4\u660e\u5bf9\u5e94\u54ea\u7b14\u4e34\u65f6\u6536\u6b3e\uff0c\u5355\u5217\u9000\u6b3e\u3002", "expense", "sale_other_refund"],
    ],
  },
  "310": {
    buyer: "\u9648\u798f\u6709",
    signedDate: "2020-10-05",
    total: 70_000_000,
    summary: "\u623f\u6b3e7000\u4e07\u5206\u4e09\u7b14\u4ed8\u6e05\uff1b\u65e0\u8f66\u4f4d\u548c\u4ee3\u79df\u8bb0\u5f55\u3002",
    entries: [
      ["2020-10-05", 30_000_000, "HOUSE-01", "310\u7b2c\u4e00\u7b14\u623f\u6b3e3000\u4e07\u3002", "S4-SALE-310-CONSOLIDATED"],
      ["2020-11-29", 20_000_000, "HOUSE-02", "310\u7b2c\u4e8c\u7b14\u623f\u6b3e2000\u4e07\u3002"],
      ["2021-01-03", 20_000_000, "HOUSE-03", "310\u7b2c\u4e09\u7b14\u623f\u6b3e2000\u4e07\uff1b\u5df2\u7ed3\u6e05\u3002"],
    ],
  },
  "311": {
    buyer: "DLABY",
    signedDate: "2020-09-08",
    total: 99_030_000,
    summary: "\u4e0e312\u4e3aDLABY\u6253\u5305\u8d2d\u4e70\uff1b\u6309Excel\u884c\u754c\u7ebf\u5206\u644a\uff0c311\u5408\u540c\u603b\u4ef79903\u4e07\uff0c\u56db\u7b14\u4ed8\u6e05\uff1b\u65e0\u8f66\u4f4d\u548c\u4ee3\u79df\u8bb0\u5f55\u3002",
    entries: [
      ["2020-09-08", 40_000_000, "HOUSE-01", "311\u7b2c\u4e00\u7b14\u623f\u6b3e4000\u4e07\uff1b\u4e0e312\u6253\u5305\u8d2d\u4e70\u3002", "S4-SALE-311-CONSOLIDATED"],
      ["2020-10-19", 20_000_000, "HOUSE-02", "311\u7b2c\u4e8c\u7b14\u623f\u6b3e2000\u4e07\u3002"],
      ["2020-10-30", 32_480_000, "HOUSE-03", "311\u7b2c\u4e09\u7b14\u623f\u6b3e3248\u4e07\uff0c\u652f\u7968\u3002"],
      ["2020-12-30", 6_550_000, "HOUSE-04", "311\u7b2c\u56db\u7b14\u623f\u6b3e655\u4e07\uff1b311\u623f\u6b3e\u5df2\u7ed3\u6e05\u3002"],
    ],
  },
  "312": {
    buyer: "DLABY",
    signedDate: "2021-02-17",
    total: 64_827_900,
    summary: "\u4e0e311\u4e3aDLABY\u6253\u5305\u8d2d\u4e70\uff1b\u6309Excel\u884c\u754c\u7ebf\u5206\u644a\uff0c312\u5408\u540c\u603b\u4ef76482.79\u4e07\uff0c\u516d\u7b14\u4ed8\u6e05\uff1b\u6700\u540e\u4e00\u7b14\u6309\u5408\u540c\u603b\u989d\u7531458.5\u4e07\u5f52\u4e00\u4e3a458.49\u4e07\u3002",
    entries: [
      ["2021-02-17", 26_240_000, "HOUSE-01", "312\u7b2c\u4e00\u7b14\u623f\u6b3e2624\u4e07\uff0c\u652f\u7968\u3002"],
      ["2021-03-08", 14_957_000, "HOUSE-02", "312\u7b2c\u4e8c\u7b14\u623f\u6b3e1495.7\u4e07\uff0c\u652f\u7968\u3002"],
      ["2021-04-20", 5_000_000, "HOUSE-03", "312\u7b2c\u4e09\u7b14\u623f\u6b3e500\u4e07\uff0c\u73b0\u91d1\u3002"],
      ["2021-06-09", 4_725_000, "HOUSE-04", "312\u7b2c\u56db\u7b14\u623f\u6b3e472.5\u4e07\uff0c\u652f\u7968\u3002"],
      ["2021-08-24", 9_321_000, "HOUSE-05", "312\u7b2c\u4e94\u7b14\u623f\u6b3e932.1\u4e07\uff0c\u652f\u7968\u3002"],
      ["2021-10-02", 4_584_900, "HOUSE-06", "312\u7b2c\u516d\u7b14\u623f\u6b3e458.49\u4e07\uff1bExcel\u663e\u793a458.5\u4e07\uff0c\u6309\u6253\u5305\u5408\u540c\u603b\u4ef716385.79\u4e07\u5f52\u4e00\uff1b\u5df2\u7ed3\u6e05\u3002"],
    ],
  },
};

function houseEntry(unitNo, raw) {
  const [date, amount, suffix, notes, oldReceipt] = raw;
  return { date, amount, sourceType: "sale_contract", receipt: `WB4-SALE-${unitNo}-${date.replaceAll("-", "")}-${suffix}`, notes, oldReceipt };
}

function extraEntry(unitNo, raw) {
  const [date, amount, sourceType, suffix, notes, direction = "income", ledgerCategory] = raw;
  return { date, amount, sourceType, receipt: `WB4-SALE-${unitNo}-${date.replaceAll("-", "")}-${suffix}`, notes, direction, ledgerCategory };
}

const saleIds = {};
for (const unitNo of Object.keys(saleSpecs)) {
  const spec = saleSpecs[unitNo];
  let sales = await checked(supabase.from("sale_contracts").select("id, customer_id, signed_date, total_amount_xof").eq("unit_id", unitByNo[unitNo].id), `load ${unitNo} sale`);
  if (unitNo === "312" && sales.length === 0) {
    const buyerId = saleIds["311"].customerId;
    const inserted = await checked(
      supabase.from("sale_contracts").insert({
        unit_id: unitByNo[unitNo].id,
        customer_id: buyerId,
        contract_no: `WB-SALE-SACSI4-${unitNo}-${spec.signedDate.replaceAll("-", "")}`,
        signed_date: spec.signedDate,
        transfer_status: "not_started",
        payment_plan_type: spec.summary,
        total_amount_xof: spec.total,
        status: "active",
      }).select("id, customer_id, signed_date, total_amount_xof").single(),
      "insert 312 sale",
    );
    sales = [inserted];
  }
  if (sales.length !== 1) throw new Error(`Expected one ${unitNo} sale, got ${sales.length}`);
  const sale = sales[0];
  const allowedTotals = unitNo === "308" ? [93_000_000, 93_100_000] : unitNo === "311" ? [99_030_000, 163_857_900] : [spec.total];
  if (!allowedTotals.includes(Number(sale.total_amount_xof))) throw new Error(`Unexpected ${unitNo} total ${sale.total_amount_xof}`);
  await checked(
    supabase.from("sale_contracts").update({
      contract_no: `WB-SALE-SACSI4-${unitNo}-${spec.signedDate.replaceAll("-", "")}`,
      signed_date: spec.signedDate,
      total_amount_xof: spec.total,
      agency_commission_amount_xof: spec.agency ?? null,
      agency_commission_paid: spec.agency ? true : false,
      payment_plan_type: spec.summary,
    }).eq("id", sale.id),
    `update ${unitNo} sale`,
  );
  for (const raw of spec.entries) await upsertPayment(sale.id, sale.customer_id, unitNo, houseEntry(unitNo, raw));
  for (const raw of spec.extras ?? []) await upsertPayment(sale.id, sale.customer_id, unitNo, extraEntry(unitNo, raw));
  const receivables = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum"), `load ${unitNo} receivable`);
  const receivablePayload = {
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
  if (receivables.length > 1) throw new Error(`Duplicate ${unitNo} sale receivables`);
  if (receivables.length === 1) await checked(supabase.from("receivables").update(receivablePayload).eq("id", receivables[0].id), `update ${unitNo} receivable`);
  else await checked(supabase.from("receivables").insert(receivablePayload), `insert ${unitNo} receivable`);
  saleIds[unitNo] = { id: sale.id, customerId: sale.customer_id };
}

async function upsertCustomer(name, notes) {
  const rows = await checked(supabase.from("customers").select("id").eq("name", name), `find customer ${name}`);
  if (rows.length > 1) throw new Error(`Duplicate customer ${name}`);
  if (rows.length === 1) return rows[0].id;
  return (await checked(supabase.from("customers").insert({ name, notes }).select("id").single(), `insert customer ${name}`)).id;
}

async function upsertLease(contractNo, payload) {
  const rows = await checked(supabase.from("lease_contracts").select("id").eq("contract_no", contractNo), `find ${contractNo}`);
  if (rows.length > 1) throw new Error(`Duplicate lease ${contractNo}`);
  if (rows.length === 1) {
    await checked(supabase.from("lease_contracts").update(payload).eq("id", rows[0].id), `update ${contractNo}`);
    return rows[0].id;
  }
  return (await checked(supabase.from("lease_contracts").insert(payload).select("id").single(), `insert ${contractNo}`)).id;
}

async function upsertLeaseEntry(leaseId, customerId, entry) {
  const paymentId = await upsertPayment(leaseId, customerId, "304", entry);
  if (entry.receivable === false) return;
  const payload = {
    building_id: building.id,
    unit_id: unitByNo["304"].id,
    customer_id: customerId,
    source_type: "lease_contract",
    source_id: leaseId,
    category: entry.receivableCategory,
    title: entry.title,
    due_date: entry.date,
    amount_xof: entry.amountXof ?? entry.amount,
    paid_amount_xof: entry.amountXof ?? entry.amount,
    status: "paid",
    currency: "XOF",
    notes: entry.notes,
  };
  const rows = await checked(supabase.from("receivables").select("id").eq("source_id", leaseId).eq("notes", entry.notes), `find receivable ${entry.receipt}`);
  if (rows.length > 1) throw new Error(`Duplicate receivable ${entry.receipt}`);
  if (rows.length === 1) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update receivable ${entry.receipt}`);
  else await checked(supabase.from("receivables").insert(payload), `insert receivable ${entry.receipt}`);
}

const sunName = "\u5b59\u5349";
const sunId = await upsertCustomer(sunName, "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b304\u5386\u53f2\u79df\u6237\u3002");
const sunLeaseNo = "WB-LEASE-SACSI4-304-20220805";
const sunLeaseId = await upsertLease(sunLeaseNo, {
  unit_id: unitByNo["304"].id,
  customer_id: sunId,
  contract_no: sunLeaseNo,
  start_date: "2022-08-05",
  expected_end_date: "2025-08-04",
  actual_end_date: "2025-06-16",
  payment_cycle: "semiannual",
  payment_day: 5,
  monthly_rent_xof: 500_000,
  deposit_amount_xof: 1_000_000,
  deposit_received: true,
  rent_free_days: 0,
  signer_name: sunName,
  status: "terminated",
  expected_end_confirmed: true,
  paid_through_date: "2025-08-04",
});
const leaseEntry = (date, amount, sourceType, suffix, title, notes, extra = {}) => ({
  date,
  amount,
  sourceType,
  receipt: `WB4-LEASE-304-${date.replaceAll("-", "")}-${suffix}`,
  title,
  notes,
  direction: extra.direction ?? (sourceType === "lease_deposit" ? "liability_in" : "income"),
  ledgerCategory: extra.ledgerCategory,
  receivableCategory: sourceType === "lease_rent" ? "lease_rent" : sourceType === "lease_deposit" ? "lease_deposit" : "other",
  ...extra,
});
const sunEntries = [
  leaseEntry("2022-08-02", 1_000_000, "lease_deposit", "DEPOSIT-01", "304\u5b59\u5349\u62bc\u91d1", "304\u5b59\u5349\u62bc\u91d1100\u4e07\uff1b\u9000\u79df\u65f6\u5df2\u9000\u6216\u6263\u6b3e\u95ed\u73af\u3002"),
  leaseEntry("2022-08-02", 3_000_000, "lease_rent", "RENT-01", "304\u5b59\u5349\u79df\u91d1", "304\u5b59\u5349\u79df\u91d1300\u4e07\uff0c\u5df2\u7f34\u81f32023-02-04\u3002"),
  leaseEntry("2022-08-02", 210_000, "property_fee", "PROP-01", "304\u5b59\u5349\u7269\u4e1a\u8d39", "304\u5b59\u5349\u7269\u4e1a\u8d3921\u4e07\uff0c\u5df2\u7f34\u81f32023-02-04\u3002"),
  leaseEntry("2023-02-10", 3_000_000, "lease_rent", "RENT-02", "304\u5b59\u5349\u79df\u91d1", "304\u5b59\u5349\u79df\u91d1300\u4e07\uff0c\u5df2\u7f34\u81f32023-08-04\u3002"),
  leaseEntry("2023-02-10", 210_000, "property_fee", "PROP-02", "304\u5b59\u5349\u7269\u4e1a\u8d39", "304\u5b59\u5349\u7269\u4e1a\u8d3921\u4e07\uff0c\u5df2\u7f34\u81f32023-08-04\u3002"),
  leaseEntry("2023-07-15", 3_000_000, "lease_rent", "RENT-03", "304\u5b59\u5349\u79df\u91d1", "304\u5b59\u5349\u79df\u91d1300\u4e07\uff0c\u5df2\u7f34\u81f32024-02-04\u3002"),
  leaseEntry("2024-01-22", 2_331, "property_fee", "PROP-03", "304\u5b59\u5349\u7269\u4e1a\u8d39", "304\u5b59\u5349\u7269\u4e1a\u8d39CNY 2331\uff0c\u6298\u540821\u4e07FCFA\uff0c\u8f6c\u9ad8\u5cf0\uff0c\u5df2\u7f34\u81f32024-02-04\u3002", { currency: "CNY", rate: 210_000 / 2_331, amountXof: 210_000 }),
  leaseEntry("2024-01-22", 3_000_000, "lease_rent", "RENT-04", "304\u5b59\u5349\u79df\u91d1", "304\u5b59\u5349\u79df\u91d1300\u4e07\uff0c\u5df2\u7f34\u81f32024-08-04\u3002"),
  leaseEntry("2024-01-22", 210_000, "property_fee", "PROP-04", "304\u5b59\u5349\u7269\u4e1a\u8d39", "304\u5b59\u5349\u7269\u4e1a\u8d3921\u4e07\uff0c\u5df2\u7f34\u81f32024-08-04\u3002"),
  leaseEntry("2024-06-12", 3_000_000, "lease_rent", "RENT-05", "304\u5b59\u5349\u79df\u91d1", "304\u5b59\u5349\u79df\u91d1300\u4e07\uff0c\u5df2\u7f34\u81f32025-02-04\u3002"),
  leaseEntry("2024-06-12", 210_000, "property_fee", "PROP-05", "304\u5b59\u5349\u7269\u4e1a\u8d39", "304\u5b59\u5349\u7269\u4e1a\u8d3921\u4e07\uff0c\u5df2\u7f34\u81f32025-02-04\u3002"),
  leaseEntry("2025-02-06", 3_000_000, "lease_rent", "RENT-06", "304\u5b59\u5349\u79df\u91d1", "304\u5b59\u5349\u79df\u91d1300\u4e07\uff0c\u539f\u9884\u4ed8\u81f32025-08-04\uff0c2025-06-16\u63d0\u524d\u9000\u79df\u3002"),
  leaseEntry("2025-02-06", 210_000, "property_fee", "PROP-06", "304\u5b59\u5349\u7269\u4e1a\u8d39", "304\u5b59\u5349\u7269\u4e1a\u8d3921\u4e07\uff0c\u539f\u9884\u4ed8\u81f32025-08-04\uff0c2025-06-16\u63d0\u524d\u9000\u79df\u3002"),
  leaseEntry("2025-06-26", 693_000, "lease_deposit_refund", "DEPREF-01", null, "304\u5b59\u5349\u62bc\u91d1\u73b0\u91d1\u9000\u56de69.3\u4e07\uff1b\u62bc\u91d1100\u4e07\u626330.7\u4e07\u540e\u7684\u4f59\u989d\u3002", { direction: "liability_out", receivable: false }),
  leaseEntry("2025-06-26", 307_000, "lease_deposit_deduction", "DEPDED-01", null, "304\u5b59\u5349\u62bc\u91d1\u6263\u6b3e30.7\u4e07\uff0c\u5305\u542b\u4ee3\u4ed8\u7535\u8d394.9\u4e07\u53ca\u5176\u4ed6\u6263\u6b3e25.8\u4e07\u3002", { direction: "liability_out", receivable: false }),
  leaseEntry("2025-06-26", 766_000, "lease_rent_refund", "RENTREF-01", null, "304\u5b59\u5349\u63d0\u524d\u9000\u79df\u7684\u672a\u4f7f\u7528\u79df\u91d1\u53ca\u7269\u4e1a\u8d39\u9000\u6b3e76.6\u4e07\uff1b\u4e0e\u62bc\u91d1\u51c0\u900069.3\u4e07\u5408\u8ba1\u5b9e\u9000145.9\u4e07\u3002", { direction: "expense", receivable: false }),
];
for (const entry of sunEntries) await upsertLeaseEntry(sunLeaseId, sunId, entry);

const linLease = await checked(
  supabase.from("lease_contracts").select("id, customer_id").eq("unit_id", unitByNo["304"].id).eq("start_date", "2025-06-17").single(),
  "load current 304 lease",
);
await checked(
  supabase.from("lease_contracts").update({
    contract_no: "WB-LEASE-SACSI4-304-20250617",
    expected_end_date: "2026-12-16",
    actual_end_date: null,
    payment_cycle: "semiannual",
    payment_day: 17,
    monthly_rent_xof: 500_000,
    deposit_amount_xof: 1_000_000,
    deposit_received: true,
    status: "active",
    expected_end_confirmed: false,
    paid_through_date: "2026-12-16",
  }).eq("id", linLease.id),
  "update current 304 lease",
);
const linEntries = [
  leaseEntry("2025-06-17", 1_000_000, "lease_deposit", "DEPOSIT-LIN-01", "304\u6797\u8363\u4fd7\u62bc\u91d1", "304\u6797\u8363\u4fd7\u62bc\u91d1100\u4e07\uff1b\u5f53\u524d\u4ecd\u5728\u79df\uff0c\u672a\u9000\u3002"),
  leaseEntry("2025-06-17", 3_000_000, "lease_rent", "RENT-LIN-01", "304\u6797\u8363\u4fd7\u79df\u91d1", "304\u6797\u8363\u4fd7\u79df\u91d1300\u4e07\uff0c2025-06-17\u81f32025-12-16\u3002"),
  leaseEntry("2025-06-17", 210_000, "property_fee", "PROP-LIN-01", "304\u6797\u8363\u4fd7\u7269\u4e1a\u8d39", "304\u6797\u8363\u4fd7\u7269\u4e1a\u8d3921\u4e07\uff0c2025-06-17\u81f32025-12-16\u3002"),
  leaseEntry("2025-12-13", 3_000_000, "lease_rent", "RENT-LIN-02", "304\u6797\u8363\u4fd7\u79df\u91d1", "304\u6797\u8363\u4fd7\u79df\u91d1300\u4e07\uff0c2025-12-17\u81f32026-06-16\u3002"),
  leaseEntry("2025-12-13", 210_000, "property_fee", "PROP-LIN-02", "304\u6797\u8363\u4fd7\u7269\u4e1a\u8d39", "304\u6797\u8363\u4fd7\u7269\u4e1a\u8d3921\u4e07\uff0c2025-12-17\u81f32026-06-16\u3002"),
  { ...leaseEntry("2026-06-27", 3_000_000, "lease_rent", "RENT-LIN-03", "304\u6797\u8363\u4fd7\u79df\u91d1", "304\u6797\u8363\u4fd7\u79df\u91d1300\u4e07\uff0c2026-06-17\u81f32026-12-16\u3002"), oldReceipt: "WB4-L-304-20260627-RENT" },
  leaseEntry("2026-06-27", 210_000, "property_fee", "PROP-LIN-03", "304\u6797\u8363\u4fd7\u7269\u4e1a\u8d39", "304\u6797\u8363\u4fd7\u7269\u4e1a\u8d3921\u4e07\uff0c2026-06-17\u81f32026-12-16\u3002"),
];
for (const entry of linEntries) await upsertLeaseEntry(linLease.id, linLease.customer_id, entry);

for (const unitNo of Object.keys(saleSpecs)) {
  const spec = saleSpecs[unitNo];
  const leaseNote = unitNo === "304"
    ? "\u5b59\u53492022-08-05\u81f32025-06-16\u5df2\u9000\u79df\uff1b\u6797\u8363\u4fd72025-06-17\u8d77\u4ecd\u5728\u79df\uff0c\u6708\u79df50\u4e07\u3001\u7269\u4e1a\u8d393.5\u4e07\uff0c\u5df2\u7f34\u81f32026-12-16\u3002"
    : "\u65e0\u53ef\u5f55\u4ee3\u79df\u5408\u540c\u3002";
  await checked(
    supabase.from("units").update({ status: "sold", notes: `\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u4e1a\u4e3b/\u4e70\u65b9\uff1a${spec.buyer}\uff1b${spec.summary}${leaseNote}` }).eq("id", unitByNo[unitNo].id),
    `update ${unitNo} unit`,
  );
}

const verification = {};
for (const unitNo of Object.keys(saleSpecs)) {
  const saleId = saleIds[unitNo].id;
  const payments = await checked(supabase.from("payments").select("source_type, amount, currency, exchange_rate_to_xof").eq("source_id", saleId), `verify ${unitNo} payments`);
  const paid = payments.filter((payment) => payment.source_type === "sale_contract").reduce((sum, payment) => sum + Math.round(Number(payment.amount) * Number(payment.exchange_rate_to_xof)), 0);
  if (paid !== saleSpecs[unitNo].total) throw new Error(`Unexpected ${unitNo} house payment total ${paid}`);
  verification[unitNo] = { contract_total_xof: saleSpecs[unitNo].total, house_paid_xof: paid, payment_count: payments.length };
}
const floor3Contracts = await checked(
  supabase.from("sale_contracts").select("unit_id").in("unit_id", unitNos.map((unitNo) => unitByNo[unitNo].id)),
  "verify floor 3 sales",
);
if (floor3Contracts.length !== 10) throw new Error(`Expected 10 sale contracts from 303-312, got ${floor3Contracts.length}`);
await checked(
  supabase.from("audit_logs").insert({
    action: "reconcile_floor_lease_sale_data",
    entity_type: "building",
    entity_id: building.id,
    metadata: {
      building_code: "SACSI4",
      floor: "3F",
      units: unitNos,
      verification,
      unit_303_excel_total_preserved: true,
      unit_304_active_lease_paid_through: "2026-12-16",
      unit_308_discount_xof: 100_000,
      unit_308_transfer_tax_xof: 2_250_000,
      units_311_312_bundle_total_xof: 163_857_900,
    },
  }),
  "write floor 3 audit log",
);

console.log(JSON.stringify({ ok: true, floor: "3F", verification, unit_304_active_lease: true, unit_311_312_bundle_total_xof: 163_857_900 }));
