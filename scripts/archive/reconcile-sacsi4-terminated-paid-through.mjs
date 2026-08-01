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
const units = await checked(supabase.from("units").select("id, unit_no").eq("building_id", building.id), "load units");
const unitById = new Map(units.map((unit) => [unit.id, unit.unit_no]));

const paidThroughByContract = {
  "WB-LEASE-SACSI4-403-20231001-JING": "2024-03-31",
  "WB-LEASE-SACSI4-403-20220401": "2022-09-30",
  "WB-LEASE-SACSI4-404-20210915": "2022-03-14",
  "WB-LEASE-SACSI4-404-20220325-WANG": "2024-04-24",
  "WB-LEASE-SACSI4-405-20210901-JOINT": "2022-02-28",
  "WB-LEASE-SACSI4-406-20210901-JOINT": "2022-02-28",
  "WB-LEASE-SACSI4-406-20240215": "2025-04-30",
  "WB-LEASE-SACSI4-407-20220605": "2022-12-04",
  "WB-LEASE-SACSI4-407-20230224-WANG": "2024-05-23",
  "WB-LEASE-SACSI4-408-20211001": "2022-03-31",
  "WB-LEASE-SACSI4-408-20220620-WANG": "2022-12-19",
  "WB-LEASE-SACSI4-409-20220315": "2023-10-14",
  "WB-LEASE-SACSI4-409-20231201-OUMOU": "2024-12-31",
  "WB-LEASE-SACSI4-501-20220601": "2023-12-31",
  "WB-LEASE-SACSI4-501-20240311-GONG": "2024-09-10",
  "WB-LEASE-SACSI4-503-20220615": "2023-03-14",
  "WB-LEASE-SACSI4-503-20230311-SUN": "2024-03-10",
  "WB-LEASE-SACSI4-504-20220115": "2023-07-15",
  "WB-LEASE-SACSI4-506-20231201-OUMOU": "2024-12-31",
  "WB-LEASE-SACSI4-509-20220901": "2024-11-30",
  "WB-LEASE-SACSI4-509-20241201-GUO": "2026-03-31",
  "WB-LEASE-SACSI4-511-20220915": "2026-03-14",
  "WB-LEASE-SACSI4-602-20221201": "2023-08-31",
  "WB-LEASE-SACSI4-604-20211015-LILANXIN": "2022-12-14",
  "WB-LEASE-SACSI4-606-20211015-LILANXIN": "2022-12-14",
};

const contractNos = Object.keys(paidThroughByContract);
const leases = await checked(supabase.from("lease_contracts").select("id, unit_id, contract_no, signer_name, status, paid_through_date").in("contract_no", contractNos), "load target leases");
if (leases.length !== contractNos.length) throw new Error(`Expected ${contractNos.length} leases, got ${leases.length}`);
for (const lease of leases) {
  if (!unitById.has(lease.unit_id) || lease.status !== "terminated") throw new Error(`Unexpected lease ${lease.contract_no}`);
  await checked(supabase.from("lease_contracts").update({ paid_through_date: paidThroughByContract[lease.contract_no] }).eq("id", lease.id), `update ${lease.contract_no}`);
}

const unresolvedContractNos = [
  "WB-LEASE-SACSI4-403-20240401-JIANG",
  "WB-LEASE-SACSI4-403-20241001-GUO",
  "WB-LEASE-SACSI4-405-20220301-LUJIAN",
  "WB-LEASE-SACSI4-406-20220301-LUJIAN",
  "WB-LEASE-SACSI4-411-20220601",
  "WB-LEASE-SACSI4-601-20220317",
];

const verified = await checked(supabase.from("lease_contracts").select("unit_id, contract_no, signer_name, status, paid_through_date").in("contract_no", [...contractNos, ...unresolvedContractNos]), "verify paid-through dates");
for (const row of verified.filter((lease) => contractNos.includes(lease.contract_no))) {
  if (row.paid_through_date !== paidThroughByContract[row.contract_no] || row.status !== "terminated") throw new Error(`Paid-through verification failed for ${row.contract_no}`);
}
const unresolved = verified.filter((lease) => unresolvedContractNos.includes(lease.contract_no));
if (unresolved.length !== unresolvedContractNos.length || unresolved.some((lease) => lease.paid_through_date !== null)) throw new Error("Ambiguous contracts were unexpectedly changed");

const remainingMissing = await checked(supabase.from("lease_contracts").select("contract_no, unit_id, signer_name").in("unit_id", units.map((unit) => unit.id)).eq("status", "terminated").is("paid_through_date", null), "verify remaining missing dates");
if (remainingMissing.length !== 6 || remainingMissing.some((lease) => !unresolvedContractNos.includes(lease.contract_no))) throw new Error(`Unexpected remaining missing paid-through dates: ${remainingMissing.length}`);

await checked(supabase.from("audit_logs").insert({
  action: "reconcile_full_audit_batch",
  entity_type: "building",
  entity_id: building.id,
  metadata: {
    building_code: "SACSI4",
    batch: 3,
    terminated_paid_through_completed: contractNos.length,
    source: "4号公寓.xlsx explicit paid coverage dates",
    ambiguous_contracts_unchanged: unresolvedContractNos,
    remaining_missing_count: remainingMissing.length,
  },
}), "write audit log");

console.log(JSON.stringify({ ok: true, updated: contractNos.length, remaining_ambiguous: remainingMissing.map((lease) => ({ unit_no: unitById.get(lease.unit_id), signer_name: lease.signer_name, contract_no: lease.contract_no })) }));
