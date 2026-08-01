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
  supabase.from("buildings").select("id").eq("code", "SACSI6").single(),
  "load building",
);
const units = await checked(
  supabase.from("units").select("id, unit_no").eq("building_id", building.id).in("unit_no", ["201", "202", "203", "204"]),
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

const leaseContractNumbers = {
  "204:2023-09-18": "WB-LEASE-SACSI6-204-20230918",
  "203:2023-10-27": "WB-LEASE-SACSI6-203-20231027",
  "201:2023-11-13": "WB-LEASE-SACSI6-201-20231113",
  "202:2024-01-16": "WB-LEASE-SACSI6-202-20240116",
  "202:2024-07-03": "WB-LEASE-SACSI6-202-20240703",
  "204:2024-07-30": "WB-LEASE-SACSI6-204-20240730",
};
for (const [key, contractNo] of Object.entries(leaseContractNumbers)) {
  const lease = leaseByKey[key];
  if (!lease) throw new Error(`Missing lease ${key}`);
  await checked(supabase.from("lease_contracts").update({ contract_no: contractNo }).eq("id", lease.id), `update ${key}`);
}

const duplicatePayments = await checked(
  supabase.from("payments")
    .select("id")
    .eq("unit_id", unitByNo["202"].id)
    .eq("source_type", "manual")
    .is("source_id", null)
    .like("receipt_no", "WB6-HISTORY-202-%"),
  "load duplicate 202 payments",
);
if (duplicatePayments.length !== 3) throw new Error(`Expected 3 duplicate 202 payments, got ${duplicatePayments.length}`);
const duplicatePaymentIds = duplicatePayments.map((payment) => payment.id);
await checked(supabase.from("ledger_entries").delete().in("payment_id", duplicatePaymentIds), "delete duplicate 202 ledgers");
await checked(supabase.from("payments").delete().in("id", duplicatePaymentIds), "delete duplicate 202 payments");

const sale = await checked(
  supabase.from("sale_contracts").select("id, customer_id").eq("unit_id", unitByNo["203"].id).eq("status", "active").single(),
  "load 203 sale",
);
await checked(
  supabase.from("sale_contracts").update({
    contract_no: "WB-SALE-SACSI6-203-20240726",
    total_amount_xof: 150_000_000,
    payment_plan_type: "\u623f\u6b3e14500\u4e07+\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5408\u540c\u603b\u989d15000\u4e07\uff1b\u4ee5155049M\u00b2\u571f\u5730\u5bf9\u4ef7\u975e\u73b0\u91d1\u7ed3\u7b97\uff0c\u5df2\u7ed3\u6e05\uff1b\u6ce8\u518c\u91d125\u4e07\u53e6\u5217",
  }).eq("id", sale.id),
  "update 203 sale",
);

const landPayment = await checked(
  supabase.from("payments").select("id").eq("source_id", sale.id).eq("receipt_no", "WB6-SALE-203-LAND-20240726-01").single(),
  "load 203 land payment",
);
await checked(
  supabase.from("payments").update({
    amount: 145_000_000,
    notes: "203\u623f\u6b3e14500\u4e07\uff1b155049M\u00b2\u571f\u5730\u5bf9\u4ef7\u975e\u73b0\u91d1\u7ed3\u7b97\uff1b\u5df2\u7ed3\u6e05",
  }).eq("id", landPayment.id),
  "split 203 house payment",
);
const landLedger = await checked(
  supabase.from("ledger_entries").select("id").eq("payment_id", landPayment.id).single(),
  "load 203 land ledger",
);
await checked(
  supabase.from("ledger_entries").update({
    amount_xof: 145_000_000,
    description: "203 \u623f\u6b3e14500\u4e07\uff1b\u571f\u5730\u5bf9\u4ef7\u975e\u73b0\u91d1\u7ed3\u7b97\uff1b\u5df2\u7ed3\u6e05",
  }).eq("id", landLedger.id),
  "update 203 house ledger",
);

const parkingReceipt = "WB6-SALE-203-PARKING-20240726-01";
let parkingRows = await checked(
  supabase.from("payments").select("id").eq("source_id", sale.id).eq("receipt_no", parkingReceipt).limit(1),
  "find 203 parking payment",
);
const parkingPayload = {
  customer_id: sale.customer_id,
  unit_id: unitByNo["203"].id,
  source_type: "sale_contract",
  source_id: sale.id,
  payment_date: "2024-07-26",
  amount: 5_000_000,
  currency: "XOF",
  exchange_rate_to_xof: 1,
  receipt_no: parkingReceipt,
  notes: "203\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u63096#\u5176\u4ed6\u660e\u786e\u8f66\u4f4d\u4ef7\u683c\u7edf\u4e00\u62c6\u5206\uff1b\u571f\u5730\u5bf9\u4ef7\u975e\u73b0\u91d1\u7ed3\u7b97\uff1b\u5df2\u7ed3\u6e05",
};
let parkingPaymentId;
if (parkingRows.length > 0) {
  parkingPaymentId = parkingRows[0].id;
  await checked(supabase.from("payments").update(parkingPayload).eq("id", parkingPaymentId), "update 203 parking payment");
} else {
  const inserted = await checked(supabase.from("payments").insert(parkingPayload).select("id").single(), "insert 203 parking payment");
  parkingPaymentId = inserted.id;
}
const parkingLedgerRows = await checked(
  supabase.from("ledger_entries").select("id").eq("payment_id", parkingPaymentId).limit(1),
  "find 203 parking ledger",
);
const parkingLedgerPayload = {
  building_id: building.id,
  unit_id: unitByNo["203"].id,
  payment_id: parkingPaymentId,
  entry_date: "2024-07-26",
  direction: "income",
  category: "sale",
  amount_xof: 5_000_000,
  amount_cny: null,
  description: "203 \u8f66\u4f4d\u6b3e500\u4e07\uff1b\u571f\u5730\u5bf9\u4ef7\u975e\u73b0\u91d1\u7ed3\u7b97\uff1b\u5df2\u7ed3\u6e05",
};
if (parkingLedgerRows.length > 0) {
  await checked(supabase.from("ledger_entries").update(parkingLedgerPayload).eq("id", parkingLedgerRows[0].id), "update 203 parking ledger");
} else {
  await checked(supabase.from("ledger_entries").insert(parkingLedgerPayload), "insert 203 parking ledger");
}
await checked(
  supabase.from("receivables").update({
    paid_amount_xof: 150_000_000,
    status: "paid",
    notes: "\u6765\u6e90\uff1a6\u53f7\u516c\u5bd3.xlsx Sheet1 A1:N60\uff1b\u623f\u6b3e14500\u4e07+\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u571f\u5730\u5bf9\u4ef7\u975e\u73b0\u91d1\u7ed3\u7b97\uff1b\u5df2\u7ed3\u6e05",
  }).eq("source_id", sale.id).eq("category", "sale_lump_sum"),
  "update 203 receivable",
);

const xuLease = leaseByKey["204:2023-09-18"];
const cnyAllocations = [
  { receipt: "WB6-HISTORY-204-20230918-DEPOSIT-12", amountCny: 20_160, note: "\u62bc\u91d1180\u4e07\uff0c\u4eba\u6c11\u5e01\u539f\u989d\u5206\u644a\u00a520,160" },
  { receipt: "WB6-HISTORY-204-20230918-RENT-13", amountCny: 40_320, note: "\u79df\u91d1360\u4e07\uff0c\u4eba\u6c11\u5e01\u539f\u989d\u5206\u644a\u00a540,320" },
  { receipt: "WB6-HISTORY-204-20230918-PROP-14", amountCny: 1_792, note: "\u7269\u4e1a\u8d3916\u4e07\uff0c\u4eba\u6c11\u5e01\u539f\u989d\u5206\u644a\u00a51,792" },
];
for (const allocation of cnyAllocations) {
  const payment = await checked(
    supabase.from("payments").select("id, notes").eq("source_id", xuLease.id).eq("receipt_no", allocation.receipt).single(),
    `load ${allocation.receipt}`,
  );
  await checked(
    supabase.from("payments").update({ notes: `204\u5f90\u8273\u771f\u5386\u53f2\u4ed8\u6b3e\uff1b${allocation.note}\uff1b\u5408\u8ba1\u4eba\u6c11\u5e01\u00a562,272\u6298\u5408556\u4e07FCFA` }).eq("id", payment.id),
    `update payment note ${allocation.receipt}`,
  );
  await checked(
    supabase.from("ledger_entries").update({ amount_cny: allocation.amountCny, description: `204 ${allocation.note}\uff1b\u5408\u8ba1\u00a562,272\u6298\u5408556\u4e07FCFA` }).eq("payment_id", payment.id),
    `update CNY ledger ${allocation.receipt}`,
  );
}

await checked(
  supabase.from("audit_logs").insert({
    action: "reconcile_floor_lease_sale_data",
    entity_type: "building",
    entity_id: building.id,
    metadata: {
      building_code: "SACSI6",
      floor: "2F",
      removed_duplicate_payment_count: duplicatePayments.length,
      normalized_lease_contracts: Object.values(leaseContractNumbers),
      unit_203_house_amount_xof: 145_000_000,
      unit_203_parking_amount_xof: 5_000_000,
      unit_204_original_payment_cny: 62_272,
      unit_201_active: true,
    },
  }),
  "write audit log",
);

console.log(JSON.stringify({ ok: true, removedDuplicatePayments: 3, unit203: { house: 145_000_000, parking: 5_000_000 }, unit204Cny: 62_272 }));
