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
  supabase.from("buildings").select("id").eq("code", "SACSI4").single(),
  "load building",
);
const units = await checked(
  supabase.from("units").select("id, unit_no").eq("building_id", building.id).in("unit_no", ["101", "112"]),
  "load units",
);
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));
if (!unitByNo["101"] || !unitByNo["112"]) throw new Error("Missing unit 101 or 112");

const sales = await checked(
  supabase.from("sale_contracts").select("id, unit_id, customer_id, signed_date").in("unit_id", units.map((unit) => unit.id)),
  "load sales",
);
const saleByNo = Object.fromEntries(sales.map((sale) => [units.find((unit) => unit.id === sale.unit_id)?.unit_no, sale]));
if (!saleByNo["101"] || !saleByNo["112"] || sales.length !== 2) throw new Error(`Expected two sales, got ${sales.length}`);
if (saleByNo["101"].customer_id !== saleByNo["112"].customer_id) throw new Error("101 and 112 must have the same buyer");
if (saleByNo["101"].signed_date !== "2020-05-05" || saleByNo["112"].signed_date !== "2021-05-05") {
  throw new Error(`Unexpected signed dates: 101=${saleByNo["101"].signed_date}, 112=${saleByNo["112"].signed_date}`);
}

const contractUpdates = {
  "101": {
    contract_no: "WB-SALE-SACSI4-101-20200505",
    total_amount_xof: 50_000_000,
    payment_plan_type: "\u5408\u540c\u603b\u4ef75000\u4e07\uff0c\u5df2\u5305\u542b\u8f66\u4f4d\uff1b\u5df2\u7ed3\u6e05\u3002\u4e0e112\u540c\u5c5e\u738b\u519b\uff0c\u8054\u5408\u6536\u6b3e\u5df2\u62c6\u5206\u3002",
  },
  "112": {
    contract_no: "WB-SALE-SACSI4-112-20210505",
    total_amount_xof: 65_000_000,
    payment_plan_type: "\u5408\u540c\u603b\u4ef76500\u4e07\uff0c\u5df2\u5305\u542b\u8f66\u4f4d\uff1b\u5df2\u7ed3\u6e05\u3002\u539f102\u6362\u4e3a112\uff0c\u4e0e101\u5408\u5e76\u6838\u7b97\u3002",
  },
};
for (const [unitNo, update] of Object.entries(contractUpdates)) {
  await checked(supabase.from("sale_contracts").update(update).eq("id", saleByNo[unitNo].id), `update sale ${unitNo}`);
}

const paymentSpecs = [
  {
    unitNo: "101",
    date: "2020-05-05",
    amount: 45_000_000,
    receipt: "WB4-SALE-101-20200505-HOUSE-01",
    notes: "101\u5408\u540c\u6b3e4500\u4e07\uff1b\u4ece\u738b\u519b101/112\u8054\u5408\u9996\u6b3e8400\u4e07\u4e2d\u62c6\u5206\uff1b\u4e0e\u8f66\u4f4d\u6b3e500\u4e07\u5408\u8ba15000\u4e07\u3002",
  },
  {
    unitNo: "112",
    date: "2020-05-05",
    amount: 39_000_000,
    receipt: "WB4-SALE-112-20200505-HOUSE-01",
    notes: "112\u5408\u540c\u6b3e3900\u4e07\uff1b\u4ece\u738b\u519b101/112\u8054\u5408\u9996\u6b3e8400\u4e07\u4e2d\u62c6\u5206\uff1b\u539f102\u6362\u4e3a112\u3002",
  },
  {
    unitNo: "112",
    date: "2020-08-30",
    amount: 21_000_000,
    receipt: "WB4-SALE-112-20200830-HOUSE-02",
    notes: "112\u5408\u540c\u6b3e2100\u4e07\uff1b\u539f102\u6362\u4e3a112\uff1b\u4e0e\u9996\u6b3e3900\u4e07\u3001\u8f66\u4f4d\u6b3e500\u4e07\u5408\u8ba16500\u4e07\u3002",
  },
  {
    unitNo: "101",
    date: "2021-08-03",
    amount: 5_000_000,
    receipt: "WB4-SALE-101-20210803-PARKING-01",
    notes: "101\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5df2\u5305\u542b\u57285000\u4e07\u5408\u540c\u603b\u4ef7\u5185\uff1b\u5df2\u7ed3\u6e05\u3002",
  },
  {
    unitNo: "112",
    date: "2022-05-12",
    amount: 5_000_000,
    receipt: "WB4-SALE-112-20220512-PARKING-01",
    notes: "112\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5df2\u5305\u542b\u57286500\u4e07\u5408\u540c\u603b\u4ef7\u5185\uff1b\u5df2\u7ed3\u6e05\u3002",
  },
];
for (const spec of paymentSpecs) {
  const sale = saleByNo[spec.unitNo];
  const payload = {
    customer_id: sale.customer_id,
    unit_id: unitByNo[spec.unitNo].id,
    source_type: "sale_contract",
    source_id: sale.id,
    payment_date: spec.date,
    amount: spec.amount,
    currency: "XOF",
    exchange_rate_to_xof: 1,
    receipt_no: spec.receipt,
    notes: spec.notes,
  };
  const existing = await checked(
    supabase.from("payments").select("id").eq("source_id", sale.id).eq("receipt_no", spec.receipt),
    `find ${spec.receipt}`,
  );
  if (existing.length > 1) throw new Error(`Duplicate payment ${spec.receipt}`);
  let paymentId;
  if (existing.length === 1) {
    paymentId = existing[0].id;
    await checked(supabase.from("payments").update(payload).eq("id", paymentId), `update ${spec.receipt}`);
  } else {
    const inserted = await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${spec.receipt}`);
    paymentId = inserted.id;
  }
  const ledgerPayload = {
    building_id: building.id,
    unit_id: unitByNo[spec.unitNo].id,
    payment_id: paymentId,
    entry_date: spec.date,
    direction: "income",
    category: "sale",
    amount_xof: spec.amount,
    amount_cny: null,
    description: spec.notes,
  };
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${spec.receipt}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${spec.receipt}`);
  if (ledgers.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgers[0].id), `update ledger ${spec.receipt}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${spec.receipt}`);
}

const receivableUpdates = {
  "101": {
    amount_xof: 50_000_000,
    paid_amount_xof: 50_000_000,
    status: "paid",
    notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx Sheet1\uff1b\u5408\u540c\u603b\u4ef75000\u4e07\u5df2\u5305\u542b\u8f66\u4f4d\uff1b\u5df2\u7ed3\u6e05\uff1b\u4e0e112\u8054\u5408\u6536\u6b3e\u5df2\u62c6\u5206\u3002",
  },
  "112": {
    amount_xof: 65_000_000,
    paid_amount_xof: 65_000_000,
    status: "paid",
    notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx Sheet1\uff1b\u5408\u540c\u603b\u4ef76500\u4e07\u5df2\u5305\u542b\u8f66\u4f4d\uff1b\u5df2\u7ed3\u6e05\uff1b\u539f102\u6362\u4e3a112\u3002",
  },
};
for (const [unitNo, update] of Object.entries(receivableUpdates)) {
  const rows = await checked(
    supabase.from("receivables").select("id").eq("source_id", saleByNo[unitNo].id).eq("category", "sale_lump_sum"),
    `load receivable ${unitNo}`,
  );
  if (rows.length !== 1) throw new Error(`Expected one receivable for ${unitNo}, got ${rows.length}`);
  await checked(supabase.from("receivables").update(update).eq("id", rows[0].id), `update receivable ${unitNo}`);
}

await Promise.all([
  checked(supabase.from("units").update({ notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u4e1a\u4e3b\u738b\u519b\uff1b\u5408\u540c\u603b\u4ef75000\u4e07\u5df2\u5305\u542b\u8f66\u4f4d\uff1b\u5df2\u7ed3\u6e05\uff1b\u4e0e112\u5408\u5e76\u6838\u7b97\u3002" }).eq("id", unitByNo["101"].id), "update unit 101 note"),
  checked(supabase.from("units").update({ notes: "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b\u4e1a\u4e3b\u738b\u519b\uff1b\u539f102\u6362\u4e3a112\uff1b\u5408\u540c\u603b\u4ef76500\u4e07\u5df2\u5305\u542b\u8f66\u4f4d\uff1b\u5df2\u7ed3\u6e05\uff1b\u4e0e101\u5408\u5e76\u6838\u7b97\u3002" }).eq("id", unitByNo["112"].id), "update unit 112 note"),
]);

await checked(
  supabase.from("audit_logs").insert({
    action: "reconcile_floor_lease_sale_data",
    entity_type: "building",
    entity_id: building.id,
    metadata: {
      building_code: "SACSI4",
      units: ["101", "112"],
      joint_buyer: true,
      joint_contract_total_xof: 115_000_000,
      parking_included_in_contract_total: true,
      joint_received_xof: 115_000_000,
      joint_outstanding_xof: 0,
      unit_101_settled: true,
      unit_112_settled: true,
    },
  }),
  "write audit log",
);

console.log(JSON.stringify({
  ok: true,
  unit101: { total: 50_000_000, paid: 50_000_000, outstanding: 0 },
  unit112: { total: 65_000_000, paid: 65_000_000, outstanding: 0 },
}));
