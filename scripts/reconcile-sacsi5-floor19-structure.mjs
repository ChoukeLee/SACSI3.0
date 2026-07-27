import { building, checked, supabase } from "./lib/reconcile-sacsi5.mjs";

const specs = [
  ["1901", 175.95],
  ["1902", 156.39],
  ["1903", 149.72],
  ["1904", 181.36],
  ["1905", 181.69],
];

await checked(supabase.from("buildings").update({ floors_above_ground: 19 }).eq("id", building.id), "update SACSI5 floor count");
for (const [unitNo, area] of specs) {
  const rows = await checked(supabase.from("units").select("id, code, floor_label, kind, status, area_sqm").eq("building_id", building.id).eq("unit_no", unitNo), `find ${unitNo}`);
  if (rows.length > 1) throw new Error(`Duplicate ${unitNo}`);
  const payload = { building_id: building.id, code: `SACSI5-${unitNo}`, unit_no: unitNo, floor_label: "19F", kind: "apartment", status: "available", area_sqm: area, layout: null, furnishing: null, notes: "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b19\u5c42\u623f\u95f4\u7ed3\u6784\u8865\u5f55\uff1bExcel\u672a\u8bb0\u5ba2\u6237\u3001\u5408\u540c\u6216\u8d22\u52a1\u4fe1\u606f\uff0c\u4fdd\u6301\u7a7a\u95f2\u3002" };
  if (rows.length === 1) {
    const row = rows[0];
    if (row.status !== "available" || Number(row.area_sqm) !== area) throw new Error(`Existing ${unitNo} has non-empty state`);
    await checked(supabase.from("units").update(payload).eq("id", row.id), `update ${unitNo}`);
  } else await checked(supabase.from("units").insert(payload), `insert ${unitNo}`);
}

const units = await checked(supabase.from("units").select("id, unit_no, code, floor_label, kind, status, area_sqm").eq("building_id", building.id).in("unit_no", specs.map(([unitNo]) => unitNo)).order("unit_no"), "verify floor19 units");
if (units.length !== 5) throw new Error(`Unexpected floor19 count: ${units.length}`);
for (const [unitNo, area] of specs) {
  const unit = units.find((row) => row.unit_no === unitNo);
  if (!unit || unit.code !== `SACSI5-${unitNo}` || unit.floor_label !== "19F" || unit.kind !== "apartment" || unit.status !== "available" || Number(unit.area_sqm) !== area) throw new Error(`Unexpected verified ${unitNo}`);
}
const ids = units.map((unit) => unit.id);
const [leases, sales, payments, receivables, ledgers, verifiedBuilding] = await Promise.all([
  checked(supabase.from("lease_contracts").select("id").in("unit_id", ids), "verify floor19 leases"),
  checked(supabase.from("sale_contracts").select("id").in("unit_id", ids), "verify floor19 sales"),
  checked(supabase.from("payments").select("id").in("unit_id", ids), "verify floor19 payments"),
  checked(supabase.from("receivables").select("id").in("unit_id", ids).neq("status", "cancelled"), "verify floor19 receivables"),
  checked(supabase.from("ledger_entries").select("id").in("unit_id", ids), "verify floor19 ledgers"),
  checked(supabase.from("buildings").select("floors_above_ground").eq("id", building.id).single(), "verify SACSI5 floor count"),
]);
if (leases.length || sales.length || payments.length || receivables.length || ledgers.length || verifiedBuilding.floors_above_ground !== 19) throw new Error("Unexpected verified floor19 state");

await checked(supabase.from("audit_logs").insert({ action: "reconcile_building_structure", entity_type: "building", entity_id: building.id, metadata: { building_code: "SACSI5", floors_above_ground: 19, source: "5\u53f7\u516c\u5bd3(1).xlsx", created_units: specs.map(([unitNo, area_sqm]) => ({ unit_no: unitNo, area_sqm, status: "available" })), contracts_created: false, financial_entries_created: false } }), "write floor19 audit");
console.log(JSON.stringify({ ok: true, floor: 19, units: specs.map(([unitNo]) => unitNo), status: "available", finance: 0 }));
