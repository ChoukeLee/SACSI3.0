import assert from "node:assert/strict";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { backupInput, docker, db, project, assertIsolated } from "./lib/dr-local-runtime.mjs";
import { tableDigests, seal, unseal, digest } from "./lib/dr-archive.mjs";
let phase = "input";
try {
  const { directory, key, manifest } = backupInput(process.argv[2] ?? "");
  assert.ok(readFileSync(join(directory, "restore-loaded.json")));
  assertIsolated();
  const client = {
    async query(query, parameters) {
      if (parameters) {
        assert.deepEqual(parameters, [manifest.schemas]);
        query = query.replace(
          "$1",
          "ARRAY[" + manifest.schemas.map((s) => "'" + s + "'").join(",") + "]",
        );
      }
      const value = docker(
        [
          "exec",
          "-i",
          db,
          "psql",
          "-X",
          "-U",
          "supabase_admin",
          "-d",
          "postgres",
          "-qAt",
          "-v",
          "ON_ERROR_STOP=1",
        ],
        "SET timezone='UTC'; SET datestyle='ISO, MDY'; SELECT coalesce(json_agg(r),'[]'::json) FROM (" +
          query +
          ") r;",
      );
      return { rows: JSON.parse(value.trim()) };
    },
  };
  phase = "table-content";
  const actual = await tableDigests(client, manifest.schemas);
  const mismatches = manifest.tables
    .filter((t) => {
      const a = actual.find((a) => a.schema === t.schema && a.name === t.name);
      return !a || a.count !== t.count || a.sha256 !== t.sha256;
    })
    .map((t) => t.schema + "." + t.name);
  assert.equal(actual.length, manifest.tables.length);
  assert.deepEqual(mismatches, []);
  phase = "schema";
  const expected = unseal(readFileSync(join(directory, "schema-review.sql.aes")), key).toString();
  const restored = docker([
    "exec",
    db,
    "pg_dump",
    "-U",
    "supabase_admin",
    "-d",
    "postgres",
    "--schema-only",
    "--no-publications",
    "--no-subscriptions",
    ...manifest.schemas.flatMap((s) => ["--schema", s]),
  ]);
  writeFileSync(join(directory, "restored-schema.sql.aes"), seal(Buffer.from(restored), key));
  const normalize = (s) =>
    s
      .split(/\r?\n/)
      .filter(
        (l) =>
          !l.startsWith("--") &&
          !l.startsWith("\\restrict") &&
          !l.startsWith("\\unrestrict") &&
          l.trim(),
      )
      .join("\n");
  const exactSchemaMatch = normalize(expected) === normalize(restored);
  const checks = (
    await client.query(`select
    (select count(*)::int from pg_policies where schemaname in ('public','private','auth','storage')) as policies,
    (select count(*)::int from auth.users) as restored_accounts,
    (select count(*)::int from storage.objects) as storage_objects,
    (select count(*)::int from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname in ('public','private','auth','storage') and c.contype='f' and c.convalidated) as validated_foreign_keys`)
  ).rows[0];
  const report = {
    project,
    snapshotAt: manifest.snapshotAt,
    verifiedAt: new Date().toISOString(),
    tables: actual.length,
    rows: actual.reduce((n, t) => n + t.count, 0),
    tableContentHashesMatch: true,
    exactSchemaMatch,
    schemaExpectedHash: digest(normalize(expected)),
    schemaRestoredHash: digest(normalize(restored)),
    ...checks,
    authServiceLogin: "pending",
    storageSyntheticRoundtrip: "pending",
    offsiteCopy: "not-configured",
  };
  writeFileSync(join(directory, "database-verification.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (e) {
  console.error(
    JSON.stringify({
      phase,
      failed: true,
      code: typeof e.code === "string" ? e.code : "SAFE_FAILURE",
    }),
  );
  process.exitCode = 1;
}
