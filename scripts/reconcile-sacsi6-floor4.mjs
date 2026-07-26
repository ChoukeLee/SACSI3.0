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
  supabase.from("units").select("id, unit_no").eq("building_id", building.id).in("unit_no", ["401", "402", "403", "404"]),
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

const contractUpdates = [
  { key: "403:2023-08-04", contract_no: "WB-LEASE-SACSI6-403-20230804" },
  { key: "404:2023-09-01", contract_no: "WB-LEASE-SACSI6-404-20230908", start_date: "2023-09-08" },
  { key: "401:2023-11-06", contract_no: "WB-LEASE-SACSI6-401-20231115", start_date: "2023-11-15" },
  { key: "404:2024-07-05", contract_no: "WB-LEASE-SACSI6-404-20240705" },
  { key: "401:2025-06-20", contract_no: "WB-LEASE-SACSI6-401-20250620" },
];
for (const update of contractUpdates) {
  const lease = leaseByKey[update.key];
  if (!lease) throw new Error(`Missing lease ${update.key}`);
  await checked(
    supabase.from("lease_contracts").update({ contract_no: update.contract_no, ...(update.start_date ? { start_date: update.start_date } : {}) }).eq("id", lease.id),
    `update ${update.key}`,
  );
}

const hanLease = leaseByKey["401:2025-06-20"];
const hanCny = [
  { receipt: "WB6-HISTORY-401-20250621-DEPOSIT-37", amount_cny: 24_819.92, label: "\u62bc\u91d1200\u4e07\uff0c\u4eba\u6c11\u5e01\u539f\u989d\u5206\u644a\u00a524,819.92" },
  { receipt: "WB6-HISTORY-401-20250621-RENT-38", amount_cny: 37_229.88, label: "\u79df\u91d1300\u4e07\uff0c\u4eba\u6c11\u5e01\u539f\u989d\u5206\u644a\u00a537,229.88" },
  { receipt: "WB6-HISTORY-401-20250621-PROP-39", amount_cny: 1_489.20, label: "\u7269\u4e1a\u8d3912\u4e07\uff0c\u4eba\u6c11\u5e01\u539f\u989d\u5206\u644a\u00a51,489.20" },
];
for (const item of hanCny) {
  const payment = await checked(
    supabase.from("payments").select("id").eq("source_id", hanLease.id).eq("receipt_no", item.receipt).single(),
    `load ${item.receipt}`,
  );
  const description = `401 \u97e9\u9f99\u6e56${item.label}\uff1b\u5408\u8ba1\u00a563,539\u6298\u5408512\u4e07FCFA`;
  await checked(supabase.from("payments").update({ notes: description }).eq("id", payment.id), `update payment ${item.receipt}`);
  await checked(supabase.from("ledger_entries").update({ amount_cny: item.amount_cny, description }).eq("payment_id", payment.id), `update ledger ${item.receipt}`);
}

const sale402 = await checked(
  supabase.from("sale_contracts").select("id, customer_id").eq("unit_id", unitByNo["402"].id).eq("status", "active").single(),
  "load 402 sale",
);
await checked(
  supabase.from("sale_contracts").update({
    contract_no: "WB-SALE-SACSI6-402-20220202",
    total_amount_xof: 73_000_000,
    payment_plan_type: "\u623f\u6b3e6800\u4e07+\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5408\u540c\u603b\u989d7300\u4e07\uff1b\u5df2\u65367300\u4e07\uff0c\u5df2\u7ed3\u6e05",
  }).eq("id", sale402.id),
  "update 402 sale",
);
const finalHouse = await checked(
  supabase.from("payments").select("id").eq("source_id", sale402.id).eq("receipt_no", "WB6-SALE-402-20240506-SALE-05").single(),
  "load 402 final payment",
);
await checked(
  supabase.from("payments").update({ amount: 20_000_000, notes: "402\u672b\u7b14\u623f\u6b3e2000\u4e07\uff1b\u539f2500\u4e07\u6536\u6b3e\u62c6\u5206" }).eq("id", finalHouse.id),
  "split 402 final house payment",
);
await checked(
  supabase.from("ledger_entries").update({ amount_xof: 20_000_000, description: "402 \u672b\u7b14\u623f\u6b3e2000\u4e07" }).eq("payment_id", finalHouse.id),
  "update 402 final house ledger",
);

const parkingReceipt = "WB6-SALE-402-20240506-PARKING-01";
let parkingRows = await checked(supabase.from("payments").select("id").eq("source_id", sale402.id).eq("receipt_no", parkingReceipt).limit(1), "find 402 parking");
const parkingPayload = {
  customer_id: sale402.customer_id,
  unit_id: unitByNo["402"].id,
  source_type: "sale_contract",
  source_id: sale402.id,
  payment_date: "2024-05-06",
  amount: 5_000_000,
  currency: "XOF",
  exchange_rate_to_xof: 1,
  receipt_no: parkingReceipt,
  notes: "402\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u4ece2024-05-06\u539f2500\u4e07\u6536\u6b3e\u4e2d\u62c6\u5206\uff1b\u5df2\u7ed3\u6e05",
};
let parkingId;
if (parkingRows.length > 0) {
  parkingId = parkingRows[0].id;
  await checked(supabase.from("payments").update(parkingPayload).eq("id", parkingId), "update 402 parking");
} else {
  const inserted = await checked(supabase.from("payments").insert(parkingPayload).select("id").single(), "insert 402 parking");
  parkingId = inserted.id;
}
const parkingLedgerRows = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", parkingId).limit(1), "find 402 parking ledger");
const parkingLedger = {
  building_id: building.id,
  unit_id: unitByNo["402"].id,
  payment_id: parkingId,
  entry_date: "2024-05-06",
  direction: "income",
  category: "sale",
  amount_xof: 5_000_000,
  amount_cny: null,
  description: "402 \u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5df2\u7ed3\u6e05",
};
if (parkingLedgerRows.length > 0) await checked(supabase.from("ledger_entries").update(parkingLedger).eq("id", parkingLedgerRows[0].id), "update 402 parking ledger");
else await checked(supabase.from("ledger_entries").insert(parkingLedger), "insert 402 parking ledger");
await checked(
  supabase.from("receivables").update({ paid_amount_xof: 73_000_000, status: "paid", notes: "\u6765\u6e90\uff1a6\u53f7\u516c\u5bd3.xlsx Sheet1 A1:N60\uff1b\u623f\u6b3e6800\u4e07+\u8f66\u4f4d\u6b3e500\u4e07\uff1b\u5df2\u7ed3\u6e05" }).eq("source_id", sale402.id).eq("category", "sale_lump_sum"),
  "update 402 receivable",
);

const gaoLease = leaseByKey["404:2023-09-01"];
const deductionReceipt = "WB6-HIST-404-20240708-DEPDED";
let deductionRows = await checked(supabase.from("payments").select("id").eq("source_id", gaoLease.id).eq("receipt_no", deductionReceipt).limit(1), "find Gao deduction");
const deductionPayload = {
  customer_id: gaoLease.customer_id,
  unit_id: unitByNo["404"].id,
  source_type: "lease_deposit_deduction",
  source_id: gaoLease.id,
  payment_date: "2024-07-08",
  amount: 262_500,
  currency: "XOF",
  exchange_rate_to_xof: 1,
  receipt_no: deductionReceipt,
  notes: "404\u9ad8\u5a77\u62bc\u91d1\u6263\u6b3e26.25\u4e07\uff1b\u4e0e\u5b9e\u9000143\u4e07\u53ca\u540e\u7eed\u900010.75\u4e07\u5171\u540c\u95ed\u73af180\u4e07\u62bc\u91d1\uff1b\u7535\u8d39\u53ca\u5176\u4ed6\u5dee\u989d\u5f85\u8865",
};
let deductionId;
if (deductionRows.length > 0) {
  deductionId = deductionRows[0].id;
  await checked(supabase.from("payments").update(deductionPayload).eq("id", deductionId), "update Gao deduction");
} else {
  const inserted = await checked(supabase.from("payments").insert(deductionPayload).select("id").single(), "insert Gao deduction");
  deductionId = inserted.id;
}
const deductionLedgerRows = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", deductionId).limit(1), "find Gao deduction ledger");
const deductionLedger = {
  building_id: building.id,
  unit_id: unitByNo["404"].id,
  payment_id: deductionId,
  entry_date: "2024-07-08",
  direction: "liability_out",
  category: "lease_deposit_deduction",
  amount_xof: 262_500,
  amount_cny: null,
  description: "404 \u9ad8\u5a77\u62bc\u91d1\u6263\u6b3e26.25\u4e07\uff0c\u62bc\u91d1\u5df2\u95ed\u73af",
};
if (deductionLedgerRows.length > 0) await checked(supabase.from("ledger_entries").update(deductionLedger).eq("id", deductionLedgerRows[0].id), "update Gao deduction ledger");
else await checked(supabase.from("ledger_entries").insert(deductionLedger), "insert Gao deduction ledger");

const coastwinLease = leaseByKey["404:2024-07-05"];
const coastwinAgency = await checked(
  supabase.from("payments").select("id").eq("source_id", coastwinLease.id).eq("receipt_no", "WB6-LEASE-404-20240628-AGENT").single(),
  "load Coastwin agency",
);
await checked(supabase.from("payments").update({ source_type: "lease_agency_income", notes: "404 Coastwin\u9996\u6b3e\u4e2d\u7684\u4e2d\u4ecb\u8d39\u6536\u516590\u4e07" }).eq("id", coastwinAgency.id), "update Coastwin agency");
await checked(supabase.from("ledger_entries").update({ direction: "income", category: "lease_agency_income", description: "404 Coastwin\u4e2d\u4ecb\u8d39\u6536\u516590\u4e07" }).eq("payment_id", coastwinAgency.id), "update Coastwin agency ledger");

const coastwinRent = await checked(
  supabase.from("payments").select("id").eq("source_id", coastwinLease.id).eq("receipt_no", "WB6-LEASE-404-20251226-RENT-16").single(),
  "load Coastwin 292 payment",
);
await checked(supabase.from("payments").update({ amount: 2_700_000, notes: "404 Coastwin 2025-12-26\u79df\u91d1270\u4e07\uff0c\u5df2\u7f34\u81f32026-01-04" }).eq("id", coastwinRent.id), "update Coastwin rent");
await checked(supabase.from("ledger_entries").update({ amount_xof: 2_700_000, description: "404 Coastwin\u79df\u91d1270\u4e07\uff0c\u5df2\u7f34\u81f32026-01-04" }).eq("payment_id", coastwinRent.id), "update Coastwin rent ledger");
await checked(
  supabase.from("receivables").update({ amount_xof: 2_700_000, paid_amount_xof: 2_700_000, notes: "2025-12-26\u5b9e\u6536292\u4e07\u62c6\u4e3a\u79df\u91d1270\u4e07+\u7269\u4e1a\u8d3912\u4e07+\u5176\u4ed6\u6536\u516510\u4e07\uff1b\u5df2\u7f34\u81f32026-01-04" }).eq("source_id", coastwinLease.id).eq("due_date", "2025-12-26").eq("category", "lease_rent"),
  "update Coastwin rent receivable",
);

const otherReceipt = "WB6-LEASE-404-20251226-OTHER-01";
let otherRows = await checked(supabase.from("payments").select("id").eq("source_id", coastwinLease.id).eq("receipt_no", otherReceipt).limit(1), "find Coastwin other income");
const otherPayload = {
  customer_id: coastwinLease.customer_id,
  unit_id: unitByNo["404"].id,
  source_type: "lease_other_income",
  source_id: coastwinLease.id,
  payment_date: "2025-12-26",
  amount: 100_000,
  currency: "XOF",
  exchange_rate_to_xof: 1,
  receipt_no: otherReceipt,
  notes: "404 Coastwin 2025-12-26\u5b9e\u6536292\u4e07\u4e2d\u8d85\u51fa\u79df\u91d1\u53ca\u7269\u4e1a\u8d39\u768410\u4e07\uff1b\u5355\u5217\u5176\u4ed6\u6536\u5165\uff0c\u6027\u8d28\u5f85\u8865",
};
let otherId;
if (otherRows.length > 0) {
  otherId = otherRows[0].id;
  await checked(supabase.from("payments").update(otherPayload).eq("id", otherId), "update Coastwin other income");
} else {
  const inserted = await checked(supabase.from("payments").insert(otherPayload).select("id").single(), "insert Coastwin other income");
  otherId = inserted.id;
}
const otherLedgerRows = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", otherId).limit(1), "find Coastwin other ledger");
const otherLedger = { building_id: building.id, unit_id: unitByNo["404"].id, payment_id: otherId, entry_date: "2025-12-26", direction: "income", category: "lease_other_income", amount_xof: 100_000, amount_cny: null, description: "404 Coastwin\u5176\u4ed6\u6536\u516510\u4e07\uff0c\u6027\u8d28\u5f85\u8865" };
if (otherLedgerRows.length > 0) await checked(supabase.from("ledger_entries").update(otherLedger).eq("id", otherLedgerRows[0].id), "update Coastwin other ledger");
else await checked(supabase.from("ledger_entries").insert(otherLedger), "insert Coastwin other ledger");

const otherReceivableRows = await checked(
  supabase.from("receivables").select("id").eq("source_id", coastwinLease.id).eq("due_date", "2025-12-26").eq("category", "other").eq("amount_xof", 100_000).limit(1),
  "find Coastwin other receivable",
);
const otherReceivable = { building_id: building.id, unit_id: unitByNo["404"].id, customer_id: coastwinLease.customer_id, source_type: "lease_contract", source_id: coastwinLease.id, category: "other", title: "404 Coastwin\u5176\u4ed6\u6536\u5165", due_date: "2025-12-26", amount_xof: 100_000, paid_amount_xof: 100_000, status: "paid", currency: "XOF", notes: "2025-12-26\u5b9e\u6536292\u4e07\u4e2d\u5355\u521710\u4e07\u5176\u4ed6\u6536\u5165\uff0c\u6027\u8d28\u5f85\u8865" };
if (otherReceivableRows.length > 0) await checked(supabase.from("receivables").update(otherReceivable).eq("id", otherReceivableRows[0].id), "update Coastwin other receivable");
else await checked(supabase.from("receivables").insert(otherReceivable), "insert Coastwin other receivable");

await checked(
  supabase.from("audit_logs").insert({
    action: "reconcile_floor_lease_sale_data",
    entity_type: "building",
    entity_id: building.id,
    metadata: {
      building_code: "SACSI6",
      floor: "4F",
      normalized_contracts: contractUpdates.map((item) => item.contract_no).concat("WB-SALE-SACSI6-402-20220202"),
      unit_401_original_payment_cny: 63_539,
      unit_402_house_amount_xof: 68_000_000,
      unit_402_parking_amount_xof: 5_000_000,
      unit_404_gao_deposit_deduction_xof: 262_500,
      unit_404_coastwin_other_income_xof: 100_000,
    },
  }),
  "write audit log",
);

console.log(JSON.stringify({ ok: true, unit401Cny: 63_539, unit402: { house: 68_000_000, parking: 5_000_000 }, unit404: { depositDeduction: 262_500, otherIncome: 100_000 } }));
