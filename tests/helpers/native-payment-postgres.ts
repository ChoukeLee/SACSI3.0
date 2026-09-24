import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createServer, type AddressInfo } from "node:net";
import pg from "pg";
import type { PaymentTestDatabase } from "./operator-payment-database";

export function paymentAdapter(client: pg.Client): PaymentTestDatabase {
  return {
    exec: (sql) => client.query(sql),
    async query<T>(sql: string, parameters: unknown[] = []) {
      return { rows: (await client.query(sql, parameters)).rows as T[] };
    },
  };
}

async function unusedLoopbackPort() {
  const server = createServer();
  await new Promise<void>((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((ok, fail) => { server.close((error) => error ? fail(error) : ok()); });
  return port;
}

// Never inherit PGHOST/PGDATA/PGSERVICE/PGOPTIONS from a developer's environment.
function processEnvironment() {
  const environment: NodeJS.ProcessEnv = { ...process.env, LC_MESSAGES: "C" };
  for (const key of Object.keys(environment)) if (key.startsWith("PG")) delete environment[key];
  return environment;
}

function command(executable: string, args: string[], timeout = 30000) {
  return new Promise<void>((ok, fail) => {
    const child = spawn(executable, args, { windowsHide: true, shell: false, env: processEnvironment(), stdio: "pipe" });
    let output = "";
    child.stdout?.on("data", (chunk) => { output = (output + chunk).slice(-6000); });
    child.stderr?.on("data", (chunk) => { output = (output + chunk).slice(-6000); });
    const timer = setTimeout(() => { child.kill(); fail(new Error(`Test Postgres command timed out: ${basename(executable)}`)); }, timeout);
    child.once("error", (error) => { clearTimeout(timer); fail(error); });
    child.once("close", (code) => { clearTimeout(timer); code === 0 ? ok() : fail(new Error(`Test Postgres command failed (${code}): ${output}`)); });
  });
}

/** Creates a fresh loopback-only native cluster. No URL or external DB option exists. */
export async function createNativePaymentPostgres() {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    throw new Error("Run native Postgres tests as an ordinary OS user; this helper never creates system accounts.");
  }
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const packageName = `@embedded-postgres/${platform}-${process.arch}`;
  const binaries: { initdb: string; postgres: string; pg_ctl: string } = await import(packageName);
  const workspace = await realpath(process.cwd());
  const parent = resolve(workspace, "work", "operator-postgres");
  await mkdir(parent, { recursive: true });
  const root = await realpath(parent);
  if (root !== parent) throw new Error("Refusing a redirected native-test root");
  const directory = await mkdtemp(join(root, "run-"));
  const dataDirectory = join(directory, "data");
  const passwordFile = join(directory, "init-password");
  const password = randomBytes(32).toString("hex");
  const port = await unusedLoopbackPort();
  const clients = new Set<pg.Client>();
  let server: ChildProcess | undefined;
  let closed = false;
  async function close() {
    if (closed) return;
    await Promise.allSettled([...clients].map((client) => client.end()));
    clients.clear();
    if (server && server.exitCode === null && server.signalCode === null) {
      await command(binaries.pg_ctl, ["stop", "-D", dataDirectory, "-m", "fast", "-w", "-t", "15"], 20000);
    }
    // Delete only the exact fresh child created by mkdtemp, never a caller path.
    const target = await realpath(directory);
    if (dirname(target) !== root || target !== directory || !/^run-[A-Za-z0-9]+$/.test(basename(target))) {
      throw new Error("Refusing cleanup outside the validated native-test directory");
    }
    await rm(target, { recursive: true, force: false, maxRetries: 5, retryDelay: 100 });
    closed = true;
  }
  try {
    await writeFile(passwordFile, `${password}\n`, { mode: 0o600, flag: "wx" });
    try {
      await command(binaries.initdb, ["-D", dataDirectory, "-U", "sacsi_test_owner", "-A", "scram-sha-256",
        `--pwfile=${passwordFile}`, "--encoding=UTF8", "--locale=C", "--no-instructions"]);
    } finally { await rm(passwordFile, { force: true }); }
    await new Promise<void>((ok, fail) => {
      server = spawn(binaries.postgres, ["-D", dataDirectory, "-p", String(port), "-h", "127.0.0.1",
        "-c", "unix_socket_directories=", "-c", "statement_timeout=10000", "-c", "idle_in_transaction_session_timeout=15000",
        "-c", "max_connections=12"], { windowsHide: true, shell: false, env: processEnvironment(), stdio: "pipe" });
      let output = "";
      const timer = setTimeout(() => fail(new Error(`Test Postgres did not start: ${output}`)), 20000);
      server.stderr?.on("data", (chunk) => {
        output = (output + chunk).slice(-6000);
        if (output.includes("database system is ready to accept connections")) { clearTimeout(timer); ok(); }
      });
      server.once("error", (error) => { clearTimeout(timer); fail(error); });
      server.once("exit", (code) => { clearTimeout(timer); fail(new Error(`Test Postgres exited (${code}): ${output}`)); });
    });
    return {
      directory,
      port,
      close,
      async connect() {
        const client = new pg.Client({ host: "127.0.0.1", port, user: "sacsi_test_owner", password,
          database: "postgres", ssl: false, options: "-c statement_timeout=10000", query_timeout: 12000,
          connectionTimeoutMillis: 5000, application_name: "sacsi-payment-concurrency-test" });
        // Query promises still reject. Suppress only unhandled idle-socket events during shutdown tests.
        client.on("error", () => undefined);
        clients.add(client);
        await client.connect();
        const actual = (await client.query<{ data_directory: string }>("show data_directory")).rows[0].data_directory;
        if (resolve(actual) !== resolve(dataDirectory)) throw new Error("Connected to an unexpected test cluster");
        return client;
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
