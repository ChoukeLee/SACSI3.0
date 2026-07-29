#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = process.argv[2] ?? "C:/Users/HP/Desktop/SACSI3.0/.env.local";
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [
        line.slice(0, index).trim(),
        line.slice(index + 1).trim().replace(/^['"]|['"]$/g, ""),
      ];
    }),
);

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Supabase URL or service-role key is missing.");
}

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function fetchAll(table, select = "*", applyFilter = (query) => query) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const query = applyFilter(
      supabase.from(table).select(select).range(from, from + pageSize - 1),
    );
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

const bookings = await fetchAll("daily_bookings");
const bookingIds = bookings.map((row) => row.id);
const dailyPayments = await fetchAll(
  "payments",
  "*",
  (query) => query.eq("source_type", "daily_booking"),
);
const paymentIds = dailyPayments.map((row) => row.id);
const dailyPaymentIdSet = new Set(paymentIds);
const dailyReceivables = await fetchAll(
  "receivables",
  "*",
  (query) => query.eq("source_type", "daily_booking"),
);
const cleaningTasks = await fetchAll("cleaning_tasks");
const dailyAuditLogs = await fetchAll(
  "audit_logs",
  "*",
  (query) => query.eq("entity_type", "daily_booking"),
);
const units = await fetchAll("units");
const buildings = await fetchAll("buildings");

const ledgerEntries = (await fetchAll("ledger_entries"))
  .filter((row) => row.payment_id && dailyPaymentIdSet.has(row.payment_id));

const snapshot = {
  created_at: new Date().toISOString(),
  source: env.NEXT_PUBLIC_SUPABASE_URL,
  scope: "daily-rental-finance-pre-202607290001",
  counts: {
    bookings: bookings.length,
    payments: dailyPayments.length,
    receivables: dailyReceivables.length,
    ledger_entries: ledgerEntries.length,
    cleaning_tasks: cleaningTasks.length,
    audit_logs: dailyAuditLogs.length,
    units: units.length,
    buildings: buildings.length,
  },
  booking_ids: bookingIds,
  data: {
    daily_bookings: bookings,
    payments: dailyPayments,
    receivables: dailyReceivables,
    ledger_entries: ledgerEntries,
    cleaning_tasks: cleaningTasks,
    audit_logs: dailyAuditLogs,
    units,
    buildings,
  },
};

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = join(root, "outputs", "backups");
mkdirSync(outputDir, { recursive: true });
const outputPath = join(outputDir, `daily-rental-finance-${timestamp}.json`);
writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ outputPath, counts: snapshot.counts }, null, 2));
