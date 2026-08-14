#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  // Environment variables (CI) take precedence over .env.local.
  const env = { ...process.env };
  const envPath = process.env.ENV_FILE ?? join(root, ".env.local");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!(key in env)) env[key] = value;
    }
  }
  return env;
}

const env = loadEnv();
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Supabase URL or service-role key is missing.");
}

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const TABLES = [
  "buildings",
  "units",
  "unit_business_flags",
  "customers",
  "daily_bookings",
  "cleaning_tasks",
  "lease_contracts",
  "lease_settlements",
  "sale_contracts",
  "sale_payment_schedule",
  "payments",
  "ledger_entries",
  "receivables",
  "audit_logs",
  "notifications",
  "business_targets",
  "system_settings",
  "user_profiles",
  "attachments",
  "property_fee_rules",
  "system_data_quality_findings",
  "daily_operation_requests",
];

async function fetchAll(table) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(from, from + pageSize - 1);
    if (error) {
      // Missing/unreadable table should not abort the whole backup.
      console.warn(`[warn] ${table}: ${error.message}`);
      return null;
    }
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

const snapshot = {
  created_at: new Date().toISOString(),
  source: env.NEXT_PUBLIC_SUPABASE_URL,
  counts: {},
  data: {},
};

for (const table of TABLES) {
  const rows = await fetchAll(table);
  if (rows === null) continue;
  snapshot.counts[table] = rows.length;
  snapshot.data[table] = rows;
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = join(root, "outputs", "backups");
mkdirSync(outputDir, { recursive: true });
const outputPath = join(outputDir, `full-backup-${timestamp}.json`);
writeFileSync(outputPath, JSON.stringify(snapshot), "utf8");

console.log(JSON.stringify({ outputPath, counts: snapshot.counts }, null, 2));
