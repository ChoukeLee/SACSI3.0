#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = process.argv[2] ?? "C:/Users/HP/Desktop/SACSI3.0/.env.local";
const env = Object.fromEntries(
  readFileSync(envPath, "utf8").split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
    }),
);
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Supabase URL or service-role key is missing.");
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function fetchAll(table, applyFilter = (query) => query) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await applyFilter(supabase.from(table).select("*").range(from, from + 999));
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

const saleSourceTypes = [
  "sale", "sale_contract", "property_fee", "parking_fee", "sale_registration_fee",
  "sale_agency_income", "sale_agency_expense", "sale_other_income", "sale_other_expense",
];
const [contracts, schedules, payments, receivables, units, buildings, customers] = await Promise.all([
  fetchAll("sale_contracts"),
  fetchAll("sale_payment_schedule"),
  fetchAll("payments", (query) => query.in("source_type", saleSourceTypes)),
  fetchAll("receivables", (query) => query.eq("source_type", "sale_contract")),
  fetchAll("units"),
  fetchAll("buildings"),
  fetchAll("customers"),
]);
const paymentIds = new Set(payments.map((row) => row.id));
const contractIds = new Set(contracts.map((row) => row.id));
const ledgerEntries = (await fetchAll("ledger_entries")).filter((row) => row.payment_id && paymentIds.has(row.payment_id));
const auditLogs = (await fetchAll("audit_logs")).filter((row) => row.entity_type === "sale_contract" && contractIds.has(row.entity_id));

const snapshot = {
  created_at: new Date().toISOString(),
  source: env.NEXT_PUBLIC_SUPABASE_URL,
  scope: "sale-finance-pre-202607290004",
  counts: {
    contracts: contracts.length,
    schedules: schedules.length,
    payments: payments.length,
    receivables: receivables.length,
    ledger_entries: ledgerEntries.length,
    audit_logs: auditLogs.length,
    units: units.length,
    buildings: buildings.length,
    customers: customers.length,
  },
  data: { sale_contracts: contracts, sale_payment_schedule: schedules, payments, receivables, ledger_entries: ledgerEntries, audit_logs: auditLogs, units, buildings, customers },
};
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = join(root, "outputs", "backups");
mkdirSync(outputDir, { recursive: true });
const outputPath = join(outputDir, `sale-finance-${timestamp}.json`);
writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, counts: snapshot.counts }, null, 2));
