import assert from "node:assert/strict";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  backupInput,
  docker,
  db,
  project,
  network,
  assertIsolated,
  sql,
} from "./lib/dr-local-runtime.mjs";
import { seal, quoteIdentifier as qi } from "./lib/dr-archive.mjs";
let phase = "input";
try {
  const { directory, key, manifest, dump } = backupInput(process.argv[2] ?? "");
  const marker = join(directory, "restore-started.json");
  const replay = existsSync(marker);
  if (replay) {
    assert.ok(
      process.argv.includes("--replay"),
      "Restore already attempted: explicit --replay required",
    );
    assert.equal(JSON.parse(readFileSync(marker, "utf8")).project, project);
  }
  phase = "isolation";
  const names = docker([
    "ps",
    "-a",
    "--filter",
    `label=com.supabase.cli.project=${project}`,
    "--format",
    "{{.Names}}",
  ])
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  assert.equal(names.length, 6);
  for (const name of names) {
    const [c] = JSON.parse(docker(["inspect", name]));
    if (Object.keys(c.NetworkSettings.Networks).length === 1 && c.NetworkSettings.Networks[network])
      continue;
    assert.deepEqual(Object.keys(c.NetworkSettings.Networks), ["sacsi-dr-bootstrap-20260923"]);
    docker(["network", "connect", network, name]);
    docker(["network", "disconnect", "sacsi-dr-bootstrap-20260923", name]);
  }
  assertIsolated();
  // No source payload enters a container until every container is isolated.
  if (!replay) assert.equal(sql("select count(*) from pg_tables where schemaname='public'"), "0");
  for (const name of names.filter((n) => /supabase_(auth|storage|rest)_/.test(n)))
    docker(["stop", name]);
  phase = "archive-review";
  const schema = docker(
    [
      "exec",
      "-i",
      db,
      "sh",
      "-c",
      "umask 077; cat > /tmp/sacsi-dr.dump && pg_restore --schema-only --file=- /tmp/sacsi-dr.dump",
    ],
    dump,
  );
  // Network isolation is the primary outbound guard; also reject executable external hooks.
  assert.ok(
    !/CREATE\s+(?:FOREIGN\s+TABLE|SERVER|SUBSCRIPTION|EVENT\s+TRIGGER)|\b(?:http_post|http_get|dblink_connect|cron\.schedule)\s*\(/i.test(
      schema,
    ),
    "Outbound SQL needs review",
  );
  if (!replay)
    writeFileSync(join(directory, "schema-review.sql.aes"), seal(Buffer.from(schema), key), {
      flag: "wx",
    });
  const roles = new Set(sql("select rolname from pg_roles").split(/\r?\n/));
  const missing = manifest.roles.filter(
    (r) => !roles.has(r.rolname) && !r.rolname.startsWith("pg_"),
  );
  // Missing platform roles are created without login/password or elevated cluster powers.
  for (const role of missing) sql(`create role ${qi(role.rolname)} nologin;`);
  writeFileSync(
    replay ? join(directory, "restore-replay-" + Date.now() + ".json") : marker,
    JSON.stringify({
      startedAt: new Date().toISOString(),
      project,
      missingRoles: missing.map((r) => r.rolname),
    }),
    { flag: "wx" },
  );
  phase = "restore";
  // Exact fresh isolated target; preserve platform extensions outside restored schemas.
  sql("DROP SCHEMA IF EXISTS public, private, auth, storage, supabase_migrations CASCADE;");
  docker([
    "exec",
    db,
    "pg_restore",
    "--single-transaction",
    "--exit-on-error",
    "-U",
    "supabase_admin",
    "-d",
    "postgres",
    "/tmp/sacsi-dr.dump",
  ]);
  // public is a built-in schema: pg_dump assumes its standard PUBLIC USAGE.
  // Dropping/recreating it removes that default. Source ACL was independently
  // read-only verified on 2026-09-23. This grants schema traversal, not table access.
  assert.ok(!schema.includes("REVOKE USAGE ON SCHEMA public FROM PUBLIC;"));
  sql("GRANT USAGE ON SCHEMA public TO PUBLIC;");
  writeFileSync(
    join(directory, "restore-loaded.json"),
    JSON.stringify({ loadedAt: new Date().toISOString(), project }),
  );
  console.log(
    JSON.stringify({
      phase: "loaded",
      project,
      restoredSchemas: manifest.schemas,
      verification: "pending",
    }),
  );
} catch (e) {
  // Suppress SQL rows/password hashes in subprocess diagnostics.
  console.error(
    JSON.stringify({
      failed: true,
      phase,
      code: typeof e.code === "string" ? e.code : "SAFE_FAILURE",
      detail: e.code === "ERR_ASSERTION" ? String(e.message).split("\n")[0] : undefined,
    }),
  );
  if (e.stderr) {
    // Only SQLSTATE-independent object error header, never COPY context/SQL bodies.
    const text = e.stderr.toString();
    const safe = text.match(
      /(?:ERROR|error):\s+(?:schema|role|extension|type|function|relation|permission denied for)[^\r\n]{0,150}/g,
    );
    if (safe) console.error(JSON.stringify({ objectErrors: safe.slice(0, 5) }));
  }
  process.exitCode = 1;
}
