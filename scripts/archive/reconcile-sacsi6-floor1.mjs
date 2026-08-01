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
  supabase.from("units").select("id, unit_no").eq("building_id", building.id).in("unit_no", ["101", "102", "103", "104"]),
  "load units",
);
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));

const leases = await checked(
  supabase.from("lease_contracts").select("id, unit_id, customer_id, start_date, status").in("unit_id", units.map((unit) => unit.id)),
  "load leases",
);
const leaseByKey = Object.fromEntries(
  leases.map((lease) => [`${units.find((unit) => unit.id === lease.unit_id)?.unit_no}:${lease.start_date}`, lease]),
);

const contractNumbers = {
  "101:2024-03-10": "WB-LEASE-SACSI6-101-20240310",
  "101:2026-06-01": "WB-LEASE-SACSI6-101-20260601",
  "102:2024-09-18": "WB-LEASE-SACSI6-102-20240918",
  "104:2023-10-10": "WB-LEASE-SACSI6-104-20231010",
};
for (const [key, contractNo] of Object.entries(contractNumbers)) {
  const lease = leaseByKey[key];
  if (!lease) throw new Error(`Missing lease ${key}`);
  await checked(
    supabase.from("lease_contracts").update({ contract_no: contractNo }).eq("id", lease.id),
    `update contract ${key}`,
  );
}

const diaLease = leaseByKey["101:2024-03-10"];
const duplicatePayments = await checked(
  supabase.from("payments")
    .select("id, receipt_no")
    .eq("unit_id", unitByNo["101"].id)
    .eq("source_type", "manual")
    .is("source_id", null)
    .like("receipt_no", "WB6-HISTORY-101-%"),
  "load duplicate payments",
);
if (duplicatePayments.length !== 8) {
  throw new Error(`Expected 8 duplicate payments, got ${duplicatePayments.length}`);
}
const duplicatePaymentIds = duplicatePayments.map((payment) => payment.id);
await checked(
  supabase.from("ledger_entries").delete().in("payment_id", duplicatePaymentIds),
  "delete duplicate ledger entries",
);
await checked(
  supabase.from("payments").delete().in("id", duplicatePaymentIds),
  "delete duplicate payments",
);

const propertyReceivable = {
  building_id: building.id,
  unit_id: unitByNo["101"].id,
  customer_id: diaLease.customer_id,
  source_type: "lease_contract",
  source_id: diaLease.id,
  category: "property_fee",
  title: "101 DIA\u5386\u53f2\u7269\u4e1a\u8d39\u6b20\u6b3e",
  due_date: "2025-01-11",
  amount_xof: 360_000,
  paid_amount_xof: 0,
  status: "overdue",
  currency: "XOF",
  notes: "\u6765\u6e90\uff1a6\u53f7\u516c\u5bd3.xlsx Sheet1 A1:N60\uff1b\u660e\u786e\u6b20\u7269\u4e1a\u8d399\u4e2a\u6708\uff0c4\u4e07/\u6708\uff0c\u5408\u8ba136\u4e07\uff1b\u7528\u6237\u786e\u8ba4\u4ecd\u6b20\uff1b\u5230\u671f\u65e5\u6309Excel\u5907\u6ce8\u6240\u5728\u76842025-01-11\u8bb0\u5f55\u65e5\u767b\u8bb0\u3002",
};
const existingProperty = await checked(
  supabase.from("receivables")
    .select("id")
    .eq("source_id", diaLease.id)
    .eq("category", "property_fee")
    .eq("amount_xof", 360_000)
    .limit(1),
  "find DIA property receivable",
);
if (existingProperty.length > 0) {
  await checked(
    supabase.from("receivables").update(propertyReceivable).eq("id", existingProperty[0].id),
    "update DIA property receivable",
  );
} else {
  await checked(
    supabase.from("receivables").insert(propertyReceivable),
    "create DIA property receivable",
  );
}

await checked(
  supabase.from("audit_logs").insert({
    action: "reconcile_floor_lease_data",
    entity_type: "building",
    entity_id: building.id,
    metadata: {
      building_code: "SACSI6",
      floor: "1F",
      normalized_contracts: Object.values(contractNumbers),
      removed_duplicate_payment_count: duplicatePayments.length,
      dia_property_fee_overdue_xof: 360_000,
      dia_deposit_refund_xof: 2_000_000,
      unit_102_deposit_refund_xof: 1_400_000,
      unit_104_overdue_xof: 10_400_000,
    },
  }),
  "write audit log",
);

console.log(JSON.stringify({
  ok: true,
  normalizedContracts: Object.values(contractNumbers),
  removedDuplicatePayments: duplicatePayments.length,
  diaPropertyFeeOverdue: 360_000,
}));
