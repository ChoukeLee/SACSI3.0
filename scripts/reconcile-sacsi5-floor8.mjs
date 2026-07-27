import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
  const index = line.indexOf("=");
  return [line.slice(0, index), line.slice(index + 1)];
}));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI5").single(), "load building");
let officeRows = await checked(supabase.from("units").select("id, code, unit_no").eq("building_id", building.id).in("unit_no", ["8F", "8F\u524d\u697c"]), "find office");
if (officeRows.length === 0) officeRows = await checked(supabase.from("units").select("id, code, unit_no").eq("building_id", building.id).in("code", ["SACSI5-8F-OFFICE", "SACSI5-8F-FRONT"]), "find office by code");
if (officeRows.length !== 1) throw new Error(`Unexpected 8F office count: ${officeRows.length}`);
const office = officeRows[0];
if (!["SACSI5-8F-OFFICE", "SACSI5-8F-FRONT"].includes(office.code)) throw new Error(`Unexpected office code: ${office.code}`);

const [officeLeases, officeSales, officeLedger] = await Promise.all([
  checked(supabase.from("lease_contracts").select("id").eq("unit_id", office.id), "check office leases"),
  checked(supabase.from("sale_contracts").select("id").eq("unit_id", office.id), "check office sales"),
  checked(supabase.from("ledger_entries").select("id").eq("unit_id", office.id), "check office ledger"),
]);
if (officeLeases.length || officeSales.length || officeLedger.length) throw new Error("8F office unexpectedly has financial references");

const officeNotes = "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b8F\u524d\u697c\u5bf9\u5e94801\u3001802\u3001803\u5408\u5e76\u533a\u57df\uff0c\u9762\u79ef\u5408482.06\u33a1\uff1b\u79d1\u5efa\u96c6\u56e2\u81ea\u7528\u529e\u516c\u5ba4\uff0c\u4e0d\u5bf9\u5916\u51fa\u79df\uff1b\u8868\u8f7d\u603b\u503c41000\u4e07FCFA\uff0c\u5305\u542b\u4e09\u4e2a\u8f66\u4f4d\uff1b\u672a\u8bb0\u8f7d\u4ed8\u6b3e\u65e5\u671f\uff0c\u4e0d\u751f\u6210\u9500\u552e\u6536\u5165\u3001\u6536\u6b3e\u3001\u5e94\u6536\u6216\u603b\u8d26\u3002";
await checked(supabase.from("units").update({
  code: "SACSI5-8F-FRONT",
  unit_no: "8F\u524d\u697c",
  floor_label: "8F",
  kind: "office",
  status: "locked",
  area_sqm: 482.06,
  notes: officeNotes,
}).eq("id", office.id), "update office");

const templateUnit = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "704").single(), "load flag template");
const templateFlags = await checked(supabase.from("unit_business_flags").select("business_type, is_enabled, default_price_xof").eq("unit_id", templateUnit.id), "load flag template rows");
const specs = {
  "804": { area: 181.36 },
  "805": { area: 181.69 },
};
const createdUnitIds = {};
for (const [unitNo, spec] of Object.entries(specs)) {
  const payload = {
    building_id: building.id,
    code: `SACSI5-${unitNo}`,
    unit_no: unitNo,
    floor_label: "8F",
    kind: "apartment",
    status: "available",
    area_sqm: spec.area,
    layout: null,
    furnishing: null,
    notes: `\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b${unitNo}\u65e0\u79df\u552e\u6216\u8d22\u52a1\u8bb0\u5f55\uff0c\u6309\u7a7a\u95f2\u623f\u6e90\u5efa\u6863\u3002`,
  };
  let rows = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", unitNo), `find ${unitNo}`);
  if (rows.length === 0) rows = await checked(supabase.from("units").select("id").eq("code", payload.code), `find ${unitNo} by code`);
  if (rows.length > 1) throw new Error(`Duplicate ${unitNo} units`);
  let unitId;
  if (rows.length === 1) {
    unitId = rows[0].id;
    await checked(supabase.from("units").update(payload).eq("id", unitId), `update ${unitNo}`);
  } else {
    unitId = (await checked(supabase.from("units").insert(payload).select("id").single(), `insert ${unitNo}`)).id;
  }
  createdUnitIds[unitNo] = unitId;
  for (const flag of templateFlags) {
    const flagRows = await checked(supabase.from("unit_business_flags").select("unit_id").eq("unit_id", unitId).eq("business_type", flag.business_type), `find ${unitNo} ${flag.business_type} flag`);
    if (flagRows.length > 1) throw new Error(`Duplicate ${unitNo} ${flag.business_type} flags`);
    const flagPayload = { unit_id: unitId, business_type: flag.business_type, is_enabled: flag.is_enabled, default_price_xof: flag.default_price_xof };
    if (flagRows.length === 1) await checked(supabase.from("unit_business_flags").update(flagPayload).eq("unit_id", unitId).eq("business_type", flag.business_type), `update ${unitNo} flag`);
    else await checked(supabase.from("unit_business_flags").insert(flagPayload), `insert ${unitNo} flag`);
  }
}

const floorUnits = await checked(supabase.from("units").select("id, unit_no, floor_label, kind, status, area_sqm").eq("building_id", building.id).eq("floor_label", "8F").order("unit_no"), "verify floor units");
if (floorUnits.length !== 3 || !floorUnits.some((unit) => unit.unit_no === "8F\u524d\u697c" && unit.kind === "office" && unit.status === "locked" && Number(unit.area_sqm) === 482.06) || !floorUnits.some((unit) => unit.unit_no === "804" && unit.status === "available" && Number(unit.area_sqm) === 181.36) || !floorUnits.some((unit) => unit.unit_no === "805" && unit.status === "available" && Number(unit.area_sqm) === 181.69)) throw new Error("Unexpected verified 8F units");
const newUnitReferences = await Promise.all(Object.entries(createdUnitIds).map(async ([unitNo, unitId]) => {
  const [leases, sales, ledger] = await Promise.all([
    checked(supabase.from("lease_contracts").select("id").eq("unit_id", unitId), `verify ${unitNo} leases`),
    checked(supabase.from("sale_contracts").select("id").eq("unit_id", unitId), `verify ${unitNo} sales`),
    checked(supabase.from("ledger_entries").select("id").eq("unit_id", unitId), `verify ${unitNo} ledger`),
  ]);
  return leases.length + sales.length + ledger.length;
}));
if (newUnitReferences.some(Boolean)) throw new Error("804/805 unexpectedly have financial references");

await checked(supabase.from("audit_logs").insert({ action: "reconcile_floor_unit_structure", entity_type: "building", entity_id: building.id, metadata: { building_code: "SACSI5", floor: "8F", front_asset_unit_no: "8F\u524d\u697c", represents_units: ["801", "802", "803"], front_area_sqm: 482.06, company_office: true, status: "locked", workbook_value_xof: 410_000_000, included_parking_count: 3, payment_recorded: false, financial_entries_created: false, available_units_created: ["804", "805"] } }), "write audit log");
console.log(JSON.stringify({ ok: true, floor: "8F", office: { unit_no: "8F\u524d\u697c", area_sqm: 482.06, workbook_value_xof: 410_000_000, included_parking_count: 3, financial_entries_created: false }, available_units: specs }));
