// Explicit SACSI-only, read-only snapshot. No plaintext DB/Auth records on disk.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { digest, seal, unseal, tableDigests } from "./lib/dr-archive.mjs";

const exec = promisify(execFile);
const docker = "C:/Program Files/Docker/Docker/resources/bin/docker.exe";
const image = "public.ecr.aws/supabase/postgres:17.6.1.167";
const project = "afadqifyaoixkvxywxqb";
const root = resolve(import.meta.dirname, "..");
const schemas = ["public", "private", "auth", "storage", "supabase_migrations"];
let client;
let phase = "prepare";
try {
  assert.equal(process.platform, "win32");
  assert.ok(process.env.SACSI_DR_DB_PASSWORD, "Database password required in process environment");
  const parent = join(root, "outputs/disaster-recovery");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "backup-"));
  const sid = (
    await exec("whoami.exe", ["/user", "/fo", "csv", "/nh"], { windowsHide: true })
  ).stdout.match(/S-1-5-[0-9-]+/)[0];
  await exec("icacls.exe", [directory, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`], {
    windowsHide: true,
  });
  const keyParent = join(root, "work/disaster-recovery-keys");
  await mkdir(keyParent, { recursive: true });
  await exec("icacls.exe", [keyParent, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`], {
    windowsHide: true,
  });
  const keyPath = join(keyParent, directory.split(/[\\/]/).at(-1) + ".key");
  const key = randomBytes(32);
  await writeFile(keyPath, key, { flag: "wx" });
  const response = await fetch(
    "https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt",
    { signal: AbortSignal.timeout(15000) },
  );
  assert.ok(response.ok);
  const ca = await response.text();
  assert.ok(ca.includes("BEGIN CERTIFICATE"));
  await writeFile(join(directory, "ca.crt"), ca, { flag: "wx" });
  client = new pg.Client({
    host: "aws-0-eu-west-1.pooler.supabase.com",
    port: 5432,
    user: `postgres.${project}`,
    password: process.env.SACSI_DR_DB_PASSWORD,
    database: "postgres",
    ssl: { ca, rejectUnauthorized: true },
    connectionTimeoutMillis: 20000,
    query_timeout: 60000,
    application_name: "sacsi-dr-readonly-backup",
  });
  phase = "readonly-snapshot";
  await client.connect();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query(
    "SET LOCAL statement_timeout='60s'; SET LOCAL idle_in_transaction_session_timeout='10min'; SET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO, MDY'",
  );
  assert.equal(
    (await client.query("show transaction_read_only")).rows[0].transaction_read_only,
    "on",
  );
  const snapshot = (await client.query("select pg_export_snapshot() as id, now() as time")).rows[0];
  const manifest = {
    version: 1,
    project,
    startedAt: new Date().toISOString(),
    snapshotAt: snapshot.time,
    schemas,
    image,
    encrypted: true,
    productionWrites: 0,
    complete: false,
    exclusions: [
      "platform managed internal schemas",
      "cluster login passwords",
      "external service configuration",
      "files outside Supabase Storage",
    ],
    sequenceCaveat:
      "Postgres sequences are not MVCC; record their state from the archive, not the table snapshot.",
  };
  phase = "inventory";
  manifest.tables = await tableDigests(client, schemas);
  manifest.extensions = (
    await client.query(
      "select e.extname, n.nspname as schema, e.extversion from pg_extension e join pg_namespace n on n.oid=e.extnamespace order by 1",
    )
  ).rows;
  manifest.roles = (
    await client.query(
      "select rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls from pg_roles order by rolname",
    )
  ).rows;
  manifest.memberships = (
    await client.query(
      "select r.rolname as role, m.rolname as member, a.admin_option from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member order by 1,2",
    )
  ).rows;
  // Empty production Storage is explicitly verified, not silently omitted.
  const objects = (
    await client.query(
      "select bucket_id,name,updated_at from storage.objects order by bucket_id,name",
    )
  ).rows;
  assert.equal(objects.length, 0, "Storage now contains objects: extend backup before proceeding");
  manifest.storage = {
    objects: 0,
    bytes: 0,
    checkedAt: new Date().toISOString(),
    restorationNeedsSyntheticFileTest: true,
  };
  phase = "pg-dump";
  const env = { ...process.env };
  for (const k of Object.keys(env))
    if (k.startsWith("PG") || k === "SACSI_DR_DB_PASSWORD") delete env[k];
  env.PGPASSWORD = process.env.SACSI_DR_DB_PASSWORD;
  const args = [
    "run",
    "--rm",
    "--name",
    "sacsi-dr-export-" + directory.split(/[\\/]/).at(-1),
    "--mount",
    `type=bind,source=${join(directory, "ca.crt")},target=/dr-ca.crt,readonly`,
    "--env",
    "PGPASSWORD",
    "--env",
    "PGSSLMODE=verify-full",
    "--env",
    "PGSSLROOTCERT=/dr-ca.crt",
    "--entrypoint",
    "pg_dump",
    image,
    "-h",
    "aws-0-eu-west-1.pooler.supabase.com",
    "-p",
    "5432",
    "-U",
    `postgres.${project}`,
    "-d",
    "postgres",
    "--no-password",
    "--format=custom",
    "--snapshot=" + snapshot.id,
    "--lock-wait-timeout=10000",
    "--no-publications",
    "--no-subscriptions",
    ...schemas.flatMap((s) => ["--schema", s]),
  ];
  const dump = (
    await exec(docker, args, {
      env,
      windowsHide: true,
      encoding: "buffer",
      maxBuffer: 128 * 1024 * 1024,
      timeout: 240000,
    })
  ).stdout;
  assert.equal(dump.subarray(0, 5).toString(), "PGDMP");
  manifest.dumpBytes = dump.length;
  manifest.dumpSha256 = digest(dump);
  const encrypted = seal(dump, key);
  assert.equal(digest(unseal(encrypted, key)), manifest.dumpSha256);
  await writeFile(join(directory, "database.dump.aes"), encrypted, { flag: "wx" });
  await client.query("ROLLBACK");
  manifest.complete = true; // Complete declared DB snapshot only, NOT full DR acceptance.
  manifest.finishedAt = new Date().toISOString();
  await writeFile(
    join(directory, "manifest.json.aes"),
    seal(Buffer.from(JSON.stringify(manifest)), key),
    { flag: "wx" },
  );
  await writeFile(
    join(directory, "summary.json"),
    JSON.stringify(
      {
        project,
        snapshotAt: snapshot.time,
        schemas,
        tables: manifest.tables.length,
        rows: manifest.tables.reduce((n, t) => n + t.count, 0),
        dumpBytes: dump.length,
        cipherSha256: digest(encrypted),
        databaseBackup: "captured",
        restore: "not-started",
        offsiteCopy: "not-configured",
        keyPath,
        finishedAt: manifest.finishedAt,
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      directory,
      keyPath,
      tables: manifest.tables.length,
      backup: "captured",
      restore: "not-started",
    }),
  );
} catch (e) {
  // Never log pg_dump stderr, connection strings, rows or Auth hashes.
  console.error(
    JSON.stringify({
      phase,
      failed: true,
      code: typeof e.code === "string" ? e.code : "SAFE_FAILURE",
    }),
  );
  process.exitCode = 1;
} finally {
  if (client) await client.end().catch(() => {});
}
