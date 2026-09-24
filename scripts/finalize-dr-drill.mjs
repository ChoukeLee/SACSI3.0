import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { backupInput, assertIsolated, sql, docker, db, project } from "./lib/dr-local-runtime.mjs";
import { tableDigests } from "./lib/dr-archive.mjs";
try {
  const { directory, manifest } = backupInput(process.argv[2] ?? "");
  const database = JSON.parse(readFileSync(join(directory, "database-verification.json")));
  const service = JSON.parse(readFileSync(join(directory, "service-verification.json")));
  assert.equal(database.tableContentHashesMatch, true);
  assert.equal(database.exactSchemaMatch, true);
  assert.equal(service.passed, true);
  const names = assertIsolated();
  const client = {
    async query(query, params) {
      if (params) {
        assert.deepEqual(params, [["public", "private"]]);
        query = query.replace("$1", "ARRAY['public','private']");
      }
      return {
        rows: JSON.parse(
          docker(
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
          ).trim(),
        ),
      };
    },
  };
  const business = await tableDigests(client, ["public", "private"]);
  assert.deepEqual(
    business,
    manifest.tables.filter((t) => ["public", "private"].includes(t.schema)),
  );
  const roles = JSON.parse(
    sql(
      "select json_agg(r) from (select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls from pg_roles where rolname in ('anon','authenticated','service_role') order by rolname) r;",
    ),
  );
  assert.deepEqual(
    roles,
    manifest.roles.filter((r) => ["anon", "authenticated", "service_role"].includes(r.rolname)),
  );
  assert.equal(sql("select count(*) from storage.objects;"), "0");
  assert.equal(sql("select count(*) from storage.buckets;"), "2");
  // Restore includes source sessions. After integrity proof and login tests,
  // invalidate them ONLY in this local clone, to require fresh local login.
  sql("BEGIN; DELETE FROM auth.refresh_tokens; DELETE FROM auth.sessions; COMMIT;");
  assert.equal(sql("select count(*) from auth.sessions;"), "0");
  assert.equal(sql("select count(*) from auth.refresh_tokens;"), "0");
  const versions = names.map((name) => {
    const [c] = JSON.parse(docker(["inspect", name]));
    return { name, image: c.Config.Image, imageId: c.Image };
  });
  // Delete only the temporary cleartext dump we created inside this exact clone.
  docker(["exec", db, "rm", "--", "/tmp/sacsi-dr.dump"]);
  docker(["stop", ...names.filter((n) => n !== db), db]);
  for (const name of names) {
    const [c] = JSON.parse(docker(["inspect", name]));
    assert.equal(c.State.Running, false);
  }
  const start = JSON.parse(readFileSync(join(directory, "restore-started.json"))).startedAt;
  const report = {
    status: "local-restore-drill-passed",
    snapshotAt: manifest.snapshotAt,
    finishedAt: new Date().toISOString(),
    databaseTables: database.tables,
    databaseRows: database.rows,
    applicationTables: business.length,
    tableContentHashesMatch: true,
    exactSchemaMatch: true,
    policies: database.policies,
    validatedForeignKeys: database.validated_foreign_keys,
    accountsRestored: database.restored_accounts,
    accountsPasswordLoginTested: 1,
    serviceChecks: service,
    applicationDataUnchangedAfterServiceTests: true,
    apiRoleAttributesMatch: true,
    sourceSessionsClearedInLocalClone: true,
    temporaryPlaintextDumpRemoved: true,
    drillContainersStopped: true,
    backupSeconds: Math.round(
      (Date.parse(manifest.finishedAt) - Date.parse(manifest.startedAt)) / 1000,
    ),
    elapsedRestoreAndTroubleshootingSeconds: Math.round((Date.now() - Date.parse(start)) / 1000),
    versions,
    productionWrites: 0,
    productionDeployment: false,
    offsiteCopy: "not-configured",
    limitations: [
      "Local restore only; not cloud cutover or production RTO SLA",
      "Storage source empty; file recovery test uses a synthetic PNG",
      "All 7 Auth records restored; password login tested for 1 account",
      "No validation of external WeChat/Excel files",
      "SMTP/OAuth/DNS/Edge Function configuration requires separate cloud recovery inventory",
      "Backup and recovery key remain on this computer; offsite destination and key custody not configured",
      "Legacy scheduled REST JSON export is not replaced by this manual drill",
    ],
  };
  writeFileSync(join(directory, "acceptance.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (e) {
  console.error(
    JSON.stringify({ failed: true, code: typeof e.code === "string" ? e.code : "SAFE_FAILURE" }),
  );
  process.exitCode = 1;
}
