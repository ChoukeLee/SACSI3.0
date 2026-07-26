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
  supabase.from("units").select("id, unit_no, status").eq("building_id", building.id).in("code", ["SACSI6-M-01", "SACSI6-STOREFRONT"]),
  "load storefront units",
);
const legacyUnit = units.find((unit) => unit.unit_no === "M-01");
const storefront = units.find((unit) => unit.unit_no !== "M-01");
if (!legacyUnit || !storefront) throw new Error("Missing legacy or standard storefront unit");
if (legacyUnit.status !== "locked") throw new Error(`M-01 must remain locked, got ${legacyUnit.status}`);

const placeholderLeases = await checked(
  supabase.from("lease_contracts").select("id").eq("contract_no", "LEGACY-LEASE-SACSI6-M-01"),
  "load M-01 placeholder lease",
);
if (placeholderLeases.length > 1) throw new Error(`Expected at most one M-01 placeholder lease, got ${placeholderLeases.length}`);
if (placeholderLeases.length === 1) {
  const placeholderId = placeholderLeases[0].id;
  const [payments, receivables] = await Promise.all([
    checked(supabase.from("payments").select("id").eq("source_id", placeholderId), "check M-01 payments"),
    checked(supabase.from("receivables").select("id").eq("source_id", placeholderId), "check M-01 receivables"),
  ]);
  if (payments.length || receivables.length) {
    throw new Error(`M-01 placeholder has financial references: payments=${payments.length}, receivables=${receivables.length}`);
  }
  await checked(supabase.from("lease_contracts").delete().eq("id", placeholderId), "delete M-01 placeholder lease");
}

const contractRows = await checked(
  supabase
    .from("lease_contracts")
    .select("id, customer_id, monthly_rent_xof, deposit_amount_xof, status")
    .eq("unit_id", storefront.id)
    .in("contract_no", ["WB6-LEASE-\u95e8\u9762\u623f", "WB-LEASE-SACSI6-STOREFRONT-20230801"]),
  "load storefront lease",
);
if (contractRows.length !== 1) throw new Error(`Expected one storefront lease, got ${contractRows.length}`);
const contract = contractRows[0];
if (Number(contract.monthly_rent_xof) !== 4_500_000 || Number(contract.deposit_amount_xof) !== 9_000_000) {
  throw new Error(`Unexpected storefront amounts: rent=${contract.monthly_rent_xof}, deposit=${contract.deposit_amount_xof}`);
}
if (contract.status !== "active") throw new Error(`Storefront must remain active, got ${contract.status}`);

await checked(
  supabase.from("lease_contracts").update({
    contract_no: "WB-LEASE-SACSI6-STOREFRONT-20230801",
    start_date: "2023-08-01",
    status: "active",
    paid_through_date: "2026-06-30",
  }).eq("id", contract.id),
  "normalize storefront lease",
);
await checked(
  supabase.from("units").update({
    status: "leased",
    notes: "\u6668\u5149\u6587\u5177\u5728\u79df\uff1b\u6708\u79df450\u4e07XOF\uff1b\u5df2\u7f34\u81f32026-06-30\uff1b2026\u5e74\u7b2c\u4e09\u5b63\u5ea6\u79df\u91d11350\u4e07\u4ecd\u6b20\uff1b\u4e0d\u81ea\u52a8\u751f\u6210\u4f4f\u5b85\u7269\u4e1a\u8d39\u3002",
  }).eq("id", storefront.id),
  "update storefront status note",
);

const arrearsRows = await checked(
  supabase
    .from("receivables")
    .select("id")
    .eq("source_id", contract.id)
    .eq("category", "lease_rent")
    .eq("due_date", "2026-07-01")
    .eq("amount_xof", 13_500_000),
  "load storefront Q3 arrears",
);
if (arrearsRows.length !== 1) throw new Error(`Expected one storefront Q3 arrears row, got ${arrearsRows.length}`);
await checked(
  supabase.from("receivables").update({
    paid_amount_xof: 0,
    status: "overdue",
    title: "\u95e8\u9762\u623f2026\u5e74\u7b2c\u4e09\u5b63\u5ea6\u79df\u91d1\u6b20\u6b3e",
    notes: "\u6765\u6e90\uff1a6\u53f7\u516c\u5bd3.xlsx Sheet1 A1:N60\uff1b\u5df2\u7f34\u81f32026-06-30\uff1b\u7528\u6237\u786e\u8ba4\u4ecd\u5728\u79df\uff1b2026\u5e74\u7b2c\u4e09\u5b63\u5ea6\u79df\u91d11350\u4e07\u4ecd\u6b20\u3002",
  }).eq("id", arrearsRows[0].id),
  "confirm storefront Q3 arrears",
);

await checked(
  supabase.from("audit_logs").insert({
    action: "reconcile_floor_lease_sale_data",
    entity_type: "building",
    entity_id: building.id,
    metadata: {
      building_code: "SACSI6",
      unit: "STOREFRONT",
      deleted_legacy_m01_placeholder_lease: placeholderLeases.length === 1,
      contract_no: "WB-LEASE-SACSI6-STOREFRONT-20230801",
      start_date: "2023-08-01",
      active: true,
      monthly_rent_xof: 4_500_000,
      deposit_xof: 9_000_000,
      paid_through_date: "2026-06-30",
      q3_2026_arrears_xof: 13_500_000,
    },
  }),
  "write audit log",
);

console.log(JSON.stringify({
  ok: true,
  deletedM01Placeholder: placeholderLeases.length === 1,
  contractNo: "WB-LEASE-SACSI6-STOREFRONT-20230801",
  active: true,
  paidThrough: "2026-06-30",
  arrears: 13_500_000,
}));
