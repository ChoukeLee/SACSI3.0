// Scoped, encrypted pre-migration application snapshot. Not a full Auth/Storage DR backup.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { seal, unseal, digest } from "./lib/dr-archive.mjs";
const project = "afadqifyaoixkvxywxqb";
let phase = "identity";
try {
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, `https://${project}.supabase.co`);
  assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const tables = [
    "projects",
    "buildings",
    "units",
    "unit_business_flags",
    "customers",
    "daily_bookings",
    "lease_contracts",
    "sale_contracts",
    "sale_payment_schedule",
    "payments",
    "receivables",
    "payment_receivable_allocations",
    "ledger_entries",
    "audit_logs",
  ];
  const rows = {},
    counts = {};
  for (const table of tables) {
    phase = table;
    rows[table] = [];
    let expected = null;
    for (let from = 0; ;) {
      let query = db.from(table).select("*", { count: "exact" });
      if (table === "unit_business_flags") query = query.order("unit_id").order("business_type");
      else if (table === "payment_receivable_allocations")
        query = query.order("payment_id").order("receivable_id");
      else query = query.order("id");
      const { data, error, count } = await query.range(from, from + 499);
      assert.equal(error, null, `Snapshot source unavailable: ${table}`);
      assert.ok(data);
      assert.ok(Number.isInteger(count));
      if (expected === null) expected = count;
      assert.equal(count, expected, "Source changed; retry snapshot");
      rows[table].push(...data);
      from += data.length;
      if (from === expected) break;
      assert.ok(data.length > 0 && from < expected, "Incomplete snapshot");
    }
    counts[table] = expected;
  }
  const id = `renewal-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`;
  const dir = resolve("work/release-snapshots", id),
    keyDir = resolve("work/release-snapshot-keys");
  await mkdir(dir, { recursive: true });
  await mkdir(keyDir, { recursive: true });
  const key = randomBytes(32),
    keyPath = join(keyDir, `${id}.key`);
  const bytes = Buffer.from(
    JSON.stringify({
      project,
      createdAt: new Date().toISOString(),
      scope:
        "Application business tables only; no Auth, Storage, private request history or guaranteed cross-request snapshot",
      rows,
    }),
  );
  const encrypted = seal(bytes, key);
  assert.deepEqual(unseal(encrypted, key), bytes);
  await writeFile(join(dir, "application-rows.aesgcm"), encrypted, { flag: "wx", mode: 0o600 });
  await writeFile(keyPath, key, { flag: "wx", mode: 0o600 });
  assert.equal(
    digest(unseal(await readFile(join(dir, "application-rows.aesgcm")), await readFile(keyPath))),
    digest(bytes),
  );
  const report = {
    project,
    scope: "Scoped pre-migration application snapshot, not complete disaster recovery",
    consistentTransactionSnapshot: false,
    counts,
    sha256: digest(encrypted),
    encrypted: true,
    readOnly: true,
    directory: dir,
    keyPath,
  };
  await writeFile(join(dir, "manifest.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report));
} catch {
  console.error(`Release snapshot failed at ${phase}; no credentials or business records printed.`);
  process.exitCode = 1;
}
