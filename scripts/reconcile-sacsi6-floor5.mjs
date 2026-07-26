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
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function checked(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI6").single(), "load building");
const units = await checked(
  supabase.from("units").select("id, unit_no").eq("building_id", building.id).in("unit_no", ["501", "502", "503", "504"]),
  "load units",
);
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));
const leases = await checked(
  supabase.from("lease_contracts").select("id, unit_id, customer_id, start_date").in("unit_id", units.map((unit) => unit.id)),
  "load leases",
);
const leaseByKey = Object.fromEntries(
  leases.map((lease) => [`${units.find((unit) => unit.id === lease.unit_id)?.unit_no}:${lease.start_date}`, lease]),
);
const sales = await checked(
  supabase.from("sale_contracts").select("id, unit_id, customer_id, signed_date").in("unit_id", units.map((unit) => unit.id)),
  "load sales",
);
const saleByNo = Object.fromEntries(sales.map((sale) => [units.find((unit) => unit.id === sale.unit_id)?.unit_no, sale]));

const leaseNumbers = {
  "503:2023-11-10": "WB-LEASE-SACSI6-503-20231110",
  "503:2024-09-18": "WB-LEASE-SACSI6-503-20240918",
};
for (const [key, contractNo] of Object.entries(leaseNumbers)) {
  const lease = leaseByKey[key];
  if (!lease) throw new Error(`Missing lease ${key}`);
  await checked(supabase.from("lease_contracts").update({ contract_no: contractNo }).eq("id", lease.id), `update ${key}`);
}

const saleNumbers = {
  "501": "WB-SALE-SACSI6-501-20230517",
  "502": "WB-SALE-SACSI6-502-20220202",
  "504": "WB-SALE-SACSI6-504-20220408",
};
for (const [unitNo, contractNo] of Object.entries(saleNumbers)) {
  await checked(supabase.from("sale_contracts").update({ contract_no: contractNo }).eq("id", saleByNo[unitNo].id), `update sale ${unitNo}`);
}

const sale501 = saleByNo["501"];
await checked(
  supabase.from("sale_contracts").update({
    total_amount_xof: 168_240_000,
    payment_plan_type: "\u623f\u6b3e16324\u4e07+\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5408\u540c\u603b\u989d16824\u4e07\uff1b\u4e24\u7b14\u5b9e\u6536\u54048412\u4e07\uff0c\u5df2\u7ed3\u6e05\uff1bExcel\u4e2d16842\u4e07\u7ecf\u7528\u6237\u786e\u8ba4\u4e3a\u7edf\u8ba1\u8f93\u5165\u9519\u8bef",
  }).eq("id", sale501.id),
  "update 501 sale",
);
const final501 = await checked(
  supabase.from("payments").select("id").eq("source_id", sale501.id).eq("receipt_no", "WB6-SALE-501-20230812-SALE-02").single(),
  "load 501 final payment",
);
await checked(
  supabase.from("payments").update({ amount: 79_120_000, notes: "501\u5c3e\u6b3e\u4e2d\u7684\u623f\u6b3e7912\u4e07\uff1b\u539f8412\u4e07\u6536\u6b3e\u62c6\u5206" }).eq("id", final501.id),
  "split 501 final house payment",
);
await checked(
  supabase.from("ledger_entries").update({ amount_xof: 79_120_000, description: "501 \u5c3e\u6b3e\u4e2d\u7684\u623f\u6b3e7912\u4e07" }).eq("payment_id", final501.id),
  "update 501 final house ledger",
);

const parkingReceipt = "WB6-SALE-501-20230812-PARKING-01";
let parkingRows = await checked(supabase.from("payments").select("id").eq("source_id", sale501.id).eq("receipt_no", parkingReceipt).limit(1), "find 501 parking");
const parkingPayload = {
  customer_id: sale501.customer_id,
  unit_id: unitByNo["501"].id,
  source_type: "sale_contract",
  source_id: sale501.id,
  payment_date: "2023-08-12",
  amount: 5_000_000,
  currency: "XOF",
  exchange_rate_to_xof: 1,
  receipt_no: parkingReceipt,
  notes: "501\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u4ece2023-08-12\u5c3e\u6b3e8412\u4e07\u4e2d\u62c6\u5206\uff1b\u5df2\u7ed3\u6e05",
};
let parkingId;
if (parkingRows.length > 0) {
  parkingId = parkingRows[0].id;
  await checked(supabase.from("payments").update(parkingPayload).eq("id", parkingId), "update 501 parking");
} else {
  const inserted = await checked(supabase.from("payments").insert(parkingPayload).select("id").single(), "insert 501 parking");
  parkingId = inserted.id;
}
const parkingLedgerRows = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", parkingId).limit(1), "find 501 parking ledger");
const parkingLedger = { building_id: building.id, unit_id: unitByNo["501"].id, payment_id: parkingId, entry_date: "2023-08-12", direction: "income", category: "sale", amount_xof: 5_000_000, amount_cny: null, description: "501 \u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5df2\u7ed3\u6e05" };
if (parkingLedgerRows.length > 0) await checked(supabase.from("ledger_entries").update(parkingLedger).eq("id", parkingLedgerRows[0].id), "update 501 parking ledger");
else await checked(supabase.from("ledger_entries").insert(parkingLedger), "insert 501 parking ledger");
await checked(
  supabase.from("receivables").update({ amount_xof: 168_240_000, paid_amount_xof: 168_240_000, status: "paid", notes: "\u6765\u6e90\uff1a6\u53f7\u516c\u5bd3.xlsx Sheet1 A1:N60\uff1b\u623f\u6b3e16324\u4e07+\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5df2\u7ed3\u6e05\uff1b16842\u4e07\u4e3aExcel\u7edf\u8ba1\u9519\u8bef" }).eq("source_id", sale501.id).eq("category", "sale_lump_sum"),
  "update 501 receivable",
);

const sale502 = saleByNo["502"];
await checked(
  supabase.from("sale_contracts").update({ total_amount_xof: 73_000_000, payment_plan_type: "\u623f\u6b3e6800\u4e07+\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5408\u540c\u603b\u989d7300\u4e07\uff1b\u5df2\u65367300\u4e07\uff0c\u5df2\u7ed3\u6e05\uff1b\u552e\u540e\u7269\u4e1a\u8d39\u53e6\u5217" }).eq("id", sale502.id),
  "update 502 sale",
);
await checked(
  supabase.from("receivables").update({ notes: "\u6765\u6e90\uff1a6\u53f7\u516c\u5bd3.xlsx Sheet1 A1:N60\uff1b\u623f\u6b3e6800\u4e07+\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5df2\u7ed3\u6e05" }).eq("source_id", sale502.id).eq("category", "sale_lump_sum"),
  "update 502 receivable",
);

const active503 = leaseByKey["503:2024-09-18"];
await checked(
  supabase.from("receivables").update({
    amount_xof: 1_600_000,
    paid_amount_xof: 1_600_000,
    status: "paid",
    title: "503 \u5386\u53f2\u62bc\u91d1",
    notes: "102/503\u8054\u5408\u9996\u6b3e1248\u4e07\u62c6\u5206\uff1b503\u62bc\u91d1160\u4e07\uff1b\u539f\u5e94\u6536\u8bef\u5199168\u4e07\u5df2\u4fee\u6b63\uff1b\u5f53\u524d\u4ecd\u5728\u79df",
  }).eq("source_id", active503.id).eq("category", "lease_deposit"),
  "correct 503 deposit receivable",
);

const sale504 = saleByNo["504"];
const agencyReceipts = ["WB6-SALE-504-20220817-AGENTEXP", "WB6-SALE-504-20250930-AGENTEXP"];
const agencyPayments = await checked(
  supabase.from("payments").select("id, receipt_no, amount").eq("source_id", sale504.id).in("receipt_no", agencyReceipts),
  "load 504 agency expenses",
);
if (agencyPayments.length !== 2) throw new Error(`Expected 2 agency expenses, got ${agencyPayments.length}`);
for (const payment of agencyPayments) {
  await checked(
    supabase.from("payments").update({ source_type: "sale_agency_expense", notes: `504 DICKO\u51fa\u552e\u4e2d\u4ecb\u8d39${Number(payment.amount) / 10_000}\u4e07\uff0c\u5df2\u652f\u4ed8` }).eq("id", payment.id),
    `update 504 agency ${payment.receipt_no}`,
  );
  await checked(
    supabase.from("ledger_entries").update({ direction: "expense", category: "sale_agency_expense", description: `504 DICKO\u51fa\u552e\u4e2d\u4ecb\u8d39${Number(payment.amount) / 10_000}\u4e07` }).eq("payment_id", payment.id),
    `update 504 agency ledger ${payment.receipt_no}`,
  );
}
await checked(
  supabase.from("sale_contracts").update({
    total_amount_xof: 112_540_000,
    agency_commission_amount_xof: 3_359_800,
    agency_commission_paid: true,
    payment_plan_type: "\u5408\u540c\u603b\u989d11254\u4e07\uff1b\u5df2\u653611254\u4e07\uff0c\u5df2\u7ed3\u6e05\uff1b1302\u4e07\u8df3\u7968\u53ca\u66ff\u4ee3\u6b3e\u53ea\u7edf\u8ba1\u4e00\u6b21\uff1b\u51fa\u552e\u4e2d\u4ecb\u8d39\u5408\u8ba1335.98\u4e07\u5df2\u652f\u4ed8",
  }).eq("id", sale504.id),
  "update 504 sale",
);
await checked(
  supabase.from("receivables").update({ notes: "\u6765\u6e90\uff1a6\u53f7\u516c\u5bd3.xlsx Sheet1 A1:N60\uff1b\u5408\u540c\u603b\u989d11254\u4e07\uff1b1302\u4e07\u8df3\u7968\u4e0d\u91cd\u590d\u8ba1\u6536\uff1b\u5df2\u7ed3\u6e05" }).eq("source_id", sale504.id).eq("category", "sale_lump_sum"),
  "update 504 receivable",
);

await checked(
  supabase.from("audit_logs").insert({
    action: "reconcile_floor_lease_sale_data",
    entity_type: "building",
    entity_id: building.id,
    metadata: {
      building_code: "SACSI6",
      floor: "5F",
      unit_501_total_xof: 168_240_000,
      unit_501_house_xof: 163_240_000,
      unit_501_parking_xof: 5_000_000,
      unit_503_active: true,
      unit_503_deposit_xof: 1_600_000,
      unit_504_sale_agency_expense_xof: 3_359_800,
    },
  }),
  "write audit log",
);

console.log(JSON.stringify({ ok: true, unit501: { total: 168_240_000, house: 163_240_000, parking: 5_000_000 }, unit503Active: true, unit504Agency: 3_359_800 }));
