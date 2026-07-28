import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function checked(query, label) {
  const result = await query;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

const contractNo = "WB-LEASE-SACSI7-11-12F-20250901";
const targetName = "科特迪瓦公司";
const allowedPreviousNames = new Set(["7号楼办公室租户（资料待补）", targetName]);

const building = await checked(
  supabase.from("buildings").select("id").eq("code", "SACSI7").single(),
  "load SACSI7",
);
const contract = await checked(
  supabase.from("lease_contracts").select("id, customer_id, status").eq("contract_no", contractNo).single(),
  "load master lease",
);
if (contract.status !== "active") throw new Error(`Unexpected master lease status: ${contract.status}`);

const customer = await checked(
  supabase.from("customers").select("id, name").eq("id", contract.customer_id).single(),
  "load master lease customer",
);
if (!allowedPreviousNames.has(customer.name)) throw new Error(`Unexpected current customer name: ${customer.name}`);

const units = await checked(
  supabase.from("units").select("unit_no, status, notes").eq("building_id", building.id),
  "load SACSI7 units",
);
const sharedUnits = units.filter((unit) => /^(11|12)\d{2}$/.test(unit.unit_no));
if (sharedUnits.length !== 12 || sharedUnits.some((unit) => unit.status !== "leased" || !unit.notes?.includes(contractNo))) {
  throw new Error("Unexpected SACSI7 11F/12F shared-lease unit data");
}
for (const [unitNo, occupant] of [["703", "李军"], ["704", "李振咏"]]) {
  const unit = units.find((row) => row.unit_no === unitNo);
  if (!unit || unit.status !== "locked" || !unit.notes?.includes(`入住人：${occupant}`)) {
    throw new Error(`Unexpected SACSI7 ${unitNo} occupant data`);
  }
}

if (customer.name !== targetName) {
  await checked(
    supabase.from("customers").update({ name: targetName }).eq("id", customer.id),
    "update master lease customer",
  );
  await checked(
    supabase.from("audit_logs").insert({
      action: "update_unit_card_party_names",
      entity_type: "customer",
      entity_id: customer.id,
      metadata: {
        building_code: "SACSI7",
        contract_no: contractNo,
        previous_name: customer.name,
        customer_name: targetName,
        shared_units: sharedUnits.map((unit) => unit.unit_no).sort(),
        owner_occupied_units: { "703": "李军", "704": "李振咏" },
      },
    }),
    "write audit log",
  );
}

console.log(JSON.stringify({
  ok: true,
  customer_name: targetName,
  shared_unit_count: sharedUnits.length,
  owner_occupied_units: { "703": "李军", "704": "李振咏" },
}));
