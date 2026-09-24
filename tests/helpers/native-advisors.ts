import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import type pg from "pg";

/** Opt-in developer check on the exact ephemeral native cluster, never a supplied URL. */
export async function checkNativeAdvisors(db: pg.Client, expectedPort: number) {
  const connection = (
    db as unknown as {
      connectionParameters: {
        host: string;
        port: number;
        user: string;
        password: string;
        database: string;
      };
    }
  ).connectionParameters;
  assert.equal(connection.host, "127.0.0.1");
  assert.equal(connection.port, expectedPort);
  assert.equal(connection.user, "sacsi_test_owner");
  assert.equal(connection.database, "postgres");
  const npm = process.env.npm_execpath;
  assert.ok(npm && npm.endsWith("npm-cli.js"));
  const url = `postgresql://${connection.user}:${encodeURIComponent(connection.password)}@127.0.0.1:${expectedPort}/postgres?sslmode=disable`;
  try {
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [
        npm,
        "exec",
        "--yes",
        "--package=supabase@2.117.0",
        "--",
        "supabase",
        "db",
        "advisors",
        "--db-url",
        url,
        "--type",
        "security",
        "--level",
        "warn",
        "--fail-on",
        "none",
        "--output",
        "json",
      ],
      { windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 },
    );
    // CLI 2.117 emits its empty-result sentinel on stderr even with --output json.
    // An empty stdout alone is NOT a successful scan.
    const report = !stdout.trim() && /^No issues found\r?$/m.test(stderr) ? [] : JSON.parse(stdout);
    const items = Array.isArray(report) ? report : (report.lints ?? report.result);
    assert.ok(Array.isArray(items));
    const current = items.filter((item: unknown) =>
      /lease_lifecycle|record_lease_financial_entry_atomic|generate_lease_schedule|ensure_next_lease_receivable|checked_lease_deposit_balance|lease_contract_token/.test(
        JSON.stringify(item),
      ),
    );
    console.log(
      JSON.stringify({
        nativeSecurityAdvisors: {
          totalWarnings: items.length,
          newLeaseWarnings: current.length,
          names: current.map((item: { name?: string }) => item.name),
        },
      }),
    );
    assert.equal(current.length, 0, "New lease objects have security advisor warnings");
  } catch (error) {
    // CLI exceptions include command arguments; never print the ephemeral password.
    if (error instanceof assert.AssertionError) throw error;
    const failure = error as { stderr?: string; message?: string };
    const safe = String(failure.stderr ?? failure.message ?? "unknown error")
      .replaceAll(url, "[local connection]")
      .replaceAll(connection.password, "[redacted]")
      .replace(/postgres(?:ql)?:\/\/\S+/g, "[connection]")
      .slice(-1600);
    throw new Error("Native security advisors failed: " + safe);
  }
}
