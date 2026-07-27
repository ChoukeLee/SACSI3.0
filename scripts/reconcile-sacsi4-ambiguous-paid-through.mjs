import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
  const i = line.indexOf("=");
  return [line.slice(0, i), line.slice(i + 1)];
}));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI4").single(), "load building");
const units = await checked(supabase.from("units").select("id, unit_no, notes").eq("building_id", building.id), "load units");
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));

const confirmed = {
  "WB-LEASE-SACSI4-403-20241001-GUO": "2024-11-30",
  "WB-LEASE-SACSI4-405-20220301-LUJIAN": "2023-02-28",
  "WB-LEASE-SACSI4-406-20220301-LUJIAN": "2023-10-31",
  "WB-LEASE-SACSI4-601-20220317": "2022-08-16",
};
const unresolved = {
  "WB-LEASE-SACSI4-403-20240401-JIANG": "原租金覆盖至2024-09-30，2024-08-14提前退房；Excel记载退租金但无退款金额，无法确定净缴费截止日。",
  "WB-LEASE-SACSI4-411-20220601": "原租金覆盖至2024-05-31，2024-05-07退房并退租金50万；按月金额可推至2024-04-30，但与实际退房日不一致，净缴费截止日待核实。",
};

const leases = await checked(supabase.from("lease_contracts").select("id, unit_id, contract_no, signer_name, status, paid_through_date").in("contract_no", [...Object.keys(confirmed), ...Object.keys(unresolved)]), "load target leases");
if (leases.length !== 6 || leases.some((lease) => lease.status !== "terminated")) throw new Error("Unexpected target leases");

for (const lease of leases) {
  if (lease.contract_no in confirmed) {
    await checked(supabase.from("lease_contracts").update({ paid_through_date: confirmed[lease.contract_no] }).eq("id", lease.id), `update ${lease.contract_no}`);
  } else {
    await checked(supabase.from("lease_contracts").update({ paid_through_date: null }).eq("id", lease.id), `retain unresolved ${lease.contract_no}`);
  }
}

const notesByUnit = {
  "403": "全盘复核：蒋友平租2原租金覆盖至2024-09-30、2024-08-14提前退房，Excel记退租金但无金额，净缴费截止日保持待核实。",
  "411": "全盘复核：林志浩/冯立力原租金覆盖至2024-05-31、2024-05-07退房并退租金50万，净缴费截止日因与实际退房日不一致而保持待核实。",
};
for (const [unitNo, marker] of Object.entries(notesByUnit)) {
  const unit = unitByNo[unitNo];
  if (!unit) throw new Error(`Missing unit ${unitNo}`);
  const notes = (unit.notes ?? "").includes(marker) ? unit.notes : `${unit.notes ?? ""}\n${marker}`.trim();
  await checked(supabase.from("units").update({ notes }).eq("id", unit.id), `update notes ${unitNo}`);
}

const verified = await checked(supabase.from("lease_contracts").select("contract_no, paid_through_date").in("contract_no", [...Object.keys(confirmed), ...Object.keys(unresolved)]), "verify target leases");
for (const lease of verified) {
  if (lease.contract_no in confirmed && lease.paid_through_date !== confirmed[lease.contract_no]) throw new Error(`Paid-through update failed for ${lease.contract_no}`);
  if (lease.contract_no in unresolved && lease.paid_through_date !== null) throw new Error(`Unresolved date was inferred for ${lease.contract_no}`);
}

const remaining = await checked(supabase.from("lease_contracts").select("contract_no").in("unit_id", units.map((unit) => unit.id)).eq("status", "terminated").is("paid_through_date", null), "verify remaining missing dates");
if (remaining.length !== 2 || remaining.some((lease) => !(lease.contract_no in unresolved))) throw new Error(`Unexpected unresolved paid-through count: ${remaining.length}`);

await checked(supabase.from("audit_logs").insert({
  action: "reconcile_full_audit_batch",
  entity_type: "building",
  entity_id: building.id,
  metadata: {
    building_code: "SACSI4",
    batch: 4,
    paid_through_completed: confirmed,
    unresolved_paid_through: unresolved,
    user_could_not_confirm_ambiguous_dates: true,
    inferred_dates_written: false,
  },
}), "write audit log");

console.log(JSON.stringify({ ok: true, updated: confirmed, unresolved: Object.keys(unresolved), remaining_missing_count: remaining.length }));
