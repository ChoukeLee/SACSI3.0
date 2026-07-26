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
  supabase.from("units").select("id, unit_no, status").eq("building_id", building.id).in("unit_no", ["7F", "701", "702", "703", "704"]),
  "load floor 7 units",
);
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));
for (const unitNo of ["7F", "701", "702", "703", "704"]) {
  if (!unitByNo[unitNo]) throw new Error(`Missing unit ${unitNo}`);
}
if (unitByNo["7F"].status !== "available") throw new Error(`7F must remain available, got ${unitByNo["7F"].status}`);
for (const unitNo of ["701", "702", "703", "704"]) {
  if (unitByNo[unitNo].status !== "locked") throw new Error(`${unitNo} must remain locked, got ${unitByNo[unitNo].status}`);
}

const placeholderLeases = await checked(
  supabase.from("lease_contracts").select("id").eq("contract_no", "LEGACY-LEASE-SACSI6-701"),
  "load 701 placeholder lease",
);
if (placeholderLeases.length > 1) throw new Error(`Expected at most one 701 placeholder lease, got ${placeholderLeases.length}`);
if (placeholderLeases.length === 1) {
  const placeholderId = placeholderLeases[0].id;
  const [payments, receivables] = await Promise.all([
    checked(supabase.from("payments").select("id").eq("source_id", placeholderId), "check 701 payments"),
    checked(supabase.from("receivables").select("id").eq("source_id", placeholderId), "check 701 receivables"),
  ]);
  if (payments.length || receivables.length) {
    throw new Error(`701 placeholder has financial references: payments=${payments.length}, receivables=${receivables.length}`);
  }
  await checked(supabase.from("lease_contracts").delete().eq("id", placeholderId), "delete 701 placeholder lease");
}

const referenceRents = { "701": 100, "702": 70, "703": 80, "704": 90 };
for (const [unitNo, rentWan] of Object.entries(referenceRents)) {
  await checked(
    supabase.from("units").update({
      notes: `\u975e\u72ec\u7acb\u8d44\u4ea7\uff1b7F\u6574\u5c42\u5206\u5272\u53c2\u8003\u6708\u79df${rentWan}\u4e07XOF\uff1b\u65e0\u79df\u6237\u53ca\u6536\u6b3e\u4f9d\u636e\u3002`,
    }).eq("id", unitByNo[unitNo].id),
    `normalize ${unitNo} reference rent note`,
  );
}
await checked(
  supabase.from("units").update({
    notes: "\u6574\u5c42\u8d44\u4ea7\uff0c\u5f53\u524d\u7a7a\u95f2\u3002701-704\u4ec5\u4e3a\u5206\u5272\u62a5\u4ef7\u53c2\u8003\uff0c\u5408\u8ba1\u53c2\u8003\u6708\u79df340\u4e07XOF\uff0c\u4e0d\u662f\u72ec\u7acb\u5728\u79df\u8d44\u4ea7\u3002",
  }).eq("id", unitByNo["7F"].id),
  "normalize 7F note",
);

await checked(
  supabase.from("audit_logs").insert({
    action: "reconcile_floor_lease_sale_data",
    entity_type: "building",
    entity_id: building.id,
    metadata: {
      building_code: "SACSI6",
      floor: "7F",
      deleted_unit_701_placeholder_lease: placeholderLeases.length === 1,
      whole_floor_status: "available",
      split_reference_rent_xof: { "701": 1_000_000, "702": 700_000, "703": 800_000, "704": 900_000 },
      split_reference_total_xof: 3_400_000,
    },
  }),
  "write audit log",
);

console.log(JSON.stringify({
  ok: true,
  deleted701Placeholder: placeholderLeases.length === 1,
  wholeFloorStatus: "available",
  referenceRentTotal: 3_400_000,
}));
