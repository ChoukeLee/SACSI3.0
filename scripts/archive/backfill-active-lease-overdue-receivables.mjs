#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");
const envPath = process.argv.find((arg) => arg.startsWith("--env="))?.slice(6)
  ?? "C:/Users/HP/Desktop/SACSI3.0/.env.local";
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
    }),
);
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const get = async (label, query) => {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? [];
};
const addDay = (date) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
};
const today = new Date().toISOString().slice(0, 10);

const [buildings, units, contracts, receivables] = await Promise.all([
  get("buildings", db.from("buildings").select("id,code")),
  get("units", db.from("units").select("id,building_id,unit_no")),
  get("contracts", db.from("lease_contracts").select("id,unit_id,customer_id,status,monthly_rent_xof,paid_through_date").eq("status", "active")),
  get("receivables", db.from("receivables").select("id,source_id,due_date,amount_xof,paid_amount_xof,status,category").eq("source_type", "lease_contract")),
]);
const buildingMap = new Map(buildings.map((row) => [row.id, row]));
const unitMap = new Map(units.map((row) => [row.id, row]));
const missing = contracts.flatMap((contract) => {
  if (!contract.paid_through_date) return [];
  const dueDate = addDay(contract.paid_through_date);
  if (dueDate >= today) return [];
  const related = receivables.filter((row) => row.source_id === contract.id && row.category === "lease_rent");
  const hasOpen = related.some((row) => ["pending", "partial", "overdue"].includes(row.status) && Number(row.amount_xof) > Number(row.paid_amount_xof));
  const hasSameDue = related.some((row) => row.status !== "cancelled" && row.due_date === dueDate);
  if (hasOpen || hasSameDue) return [];
  const unit = unitMap.get(contract.unit_id);
  const building = buildingMap.get(unit?.building_id);
  return [{ contract, unit, building, dueDate, amountXof: Number(contract.monthly_rent_xof) }];
});

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  today,
  count: missing.length,
  amountXof: missing.reduce((sum, row) => sum + row.amountXof, 0),
  rows: missing.map((row) => ({ building: row.building?.code, room: row.unit?.unit_no, dueDate: row.dueDate, amountXof: row.amountXof })),
}, null, 2));

if (apply) {
  for (const row of missing) {
    const { data, error } = await db.from("receivables").insert({
      building_id: row.unit?.building_id ?? null,
      unit_id: row.contract.unit_id,
      customer_id: row.contract.customer_id,
      source_type: "lease_contract",
      source_id: row.contract.id,
      category: "lease_rent",
      title: `${row.unit?.unit_no ?? "-"} 长租下一期租金`,
      due_date: row.dueDate,
      amount_xof: row.amountXof,
      paid_amount_xof: 0,
      status: "overdue",
      currency: "XOF",
      notes: `根据租金已缴至日期 ${row.contract.paid_through_date} 自动补齐`,
    }).select("id").single();
    if (error) throw new Error(`${row.building?.code}/${row.unit?.unit_no}: ${error.message}`);
    const { error: auditError } = await db.from("audit_logs").insert({
      action: "backfill_lease_receivable",
      entity_type: "receivable",
      entity_id: data.id,
      metadata: { contract_id: row.contract.id, building: row.building?.code, unit_no: row.unit?.unit_no, due_date: row.dueDate, amount_xof: row.amountXof },
    });
    if (auditError) throw new Error(`audit ${row.building?.code}/${row.unit?.unit_no}: ${auditError.message}`);
  }
  console.log(`Applied ${missing.length} receivable backfills.`);
}

