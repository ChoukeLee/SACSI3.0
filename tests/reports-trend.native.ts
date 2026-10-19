import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";

let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
const actor = randomUUID();
let a: Awaited<ReturnType<typeof project>>,
  b: Awaited<ReturnType<typeof project>>,
  hidden: Awaited<ReturnType<typeof project>>,
  empty: Awaited<ReturnType<typeof project>>;

beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  const installed = await installApplicationRebuild(db);
  expect(installed).toContain("20261019203420_reports_project_ledger_trend.sql");
  await db.query("insert into auth.users(id,email) values($1,'reports-trend@test.invalid')", [
    actor,
  ]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,'admin','Reports test')",
    [actor],
  );
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: "authenticated" }),
  ]);
  a = await project();
  b = await project();
  hidden = await project(true);
  empty = await project();
  await db.query(
    `insert into ledger_entries(building_id,unit_id,entry_date,direction,category,amount_xof,description)
     select $1,$2,date '2026-10-05','income','lease_rent',10.25,'Synthetic matching '||n
     from generate_series(1,65) n`,
    [a.building, a.unit],
  );
  await entry(a.building, a.unit, "2026-10-12", "expense", 30.5);
  await entry(null, a.unit, "2026-10-12", "income", 3.5);
  await entry(a.building, b.unit, "2026-10-12", "income", 7.25);
  await entry(a.building, a.unit, "2026-10-12", "liability_in", 200);
  await entry(a.building, a.unit, "2026-10-12", "liability_out", 50);
  await entry(a.building, a.unit, "2025-11-01", "income", 101);
  await entry(a.building, a.unit, "2025-10-31", "income", 999);
  await entry(a.building, a.unit, "2026-11-01", "income", 999);
  await entry(b.building, b.unit, "2026-10-12", "income", 888);
  await entry(hidden.building, hidden.unit, "2026-10-12", "income", 777);
  await entry(null, null, "2026-10-12", "income", 999);
  // Explicit building scope wins; a hidden unit still invokes the ledger's RLS.
  await entry(hidden.building, a.unit, "2026-10-12", "income", 333);
  await entry(a.building, hidden.unit, "2026-10-12", "income", 222);
}, 45000);

afterAll(async () => {
  await cluster?.close();
});

async function project(restricted = false) {
  const id = randomUUID(),
    building = randomUUID(),
    unit = randomUUID();
  await db.query(
    "insert into projects(id,code,display_name,access_mode) values($1,$2,'Synthetic project',$3)",
    [id, id, restricted ? "restricted" : "open"],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name) values($1,$2,$3,'Synthetic building')",
    [building, id, building],
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status) values($1,$2,$3,'Synthetic room','1','sold')",
    [unit, building, unit],
  );
  return { id, building, unit };
}

async function entry(
  building: string | null,
  unit: string | null,
  date: string,
  direction: string,
  amount: number,
) {
  await db.query(
    "insert into ledger_entries(building_id,unit_id,entry_date,direction,category,amount_xof) values($1,$2,$3,$4,'lease_rent',$5)",
    [building, unit, date, direction, amount],
  );
}

type Trend = { month: string; income: number; expense: number; net: number };
async function asActor<T>(run: () => Promise<T>) {
  await db.query("set role authenticated");
  try {
    return await run();
  } finally {
    await db.query("reset role");
  }
}
async function trend(
  projectId: string | null,
  month: string | null = "2026-10-01",
): Promise<Trend[]> {
  return asActor(
    async () =>
      (await db.query("select public.reports_trend_rpc($1,$2) result", [projectId, month])).rows[0]
        .result,
  );
}

it("returns exactly twelve project months including empty months, preserving decimals and deposit separation", async () => {
  const result = await trend(a.id);
  expect(result).toHaveLength(12);
  expect(result[0]).toEqual({ month: "2025-11", income: 101, expense: 0, net: 101 });
  expect(result[1]).toEqual({ month: "2025-12", income: 0, expense: 0, net: 0 });
  expect(result.at(-1)).toEqual({ month: "2026-10", income: 677, expense: 30.5, net: 646.5 });
  expect((await trend(b.id)).at(-1)?.income).toBe(888);
  expect(await trend(empty.id)).toEqual(
    result.map((row) => ({ ...row, income: 0, expense: 0, net: 0 })),
  );
});

it("matches complete ledger summaries rather than a 50-row page and does not inherit search or direction", async () => {
  const series = await trend(a.id);
  const ledger = await asActor(
    async () =>
      (
        await db.query("select public.finance_read_rpc('ledger',$1,1,false) result", [
          { projectId: a.id, dateFrom: "2026-10-01", dateTo: "2026-10-31" },
        ])
      ).rows[0].result,
  );
  expect(ledger.total).toBe(70);
  expect(ledger.rows).toHaveLength(50);
  expect(series.at(-1)?.income).toBe(ledger.summary.income);
  expect(series.at(-1)?.expense).toBe(ledger.summary.expense);
  const filtered = await asActor(
    async () =>
      (
        await db.query("select public.finance_read_rpc('ledger',$1,1,false) result", [
          {
            projectId: a.id,
            dateFrom: "2026-10-01",
            dateTo: "2026-10-31",
            direction: "expense",
            search: "absent",
          },
        ])
      ).rows[0].result,
  );
  expect(filtered.total).toBe(0);
  expect(await trend(a.id)).toEqual(series);
});

it("continues to include historical entries of inactive buildings rather than rewriting history", async () => {
  await db.query("update buildings set is_active=false,business_paused=true where id=$1", [
    a.building,
  ]);
  try {
    expect((await trend(a.id)).at(-1)?.income).toBe(677);
  } finally {
    await db.query("update buildings set is_active=true,business_paused=false where id=$1", [
      a.building,
    ]);
  }
});

it("rechecks restricted project grants, inactive projects, roles and missing profiles on each call", async () => {
  await expect(trend(hidden.id)).rejects.toThrow("reportPermissionDenied");
  await db.query(
    "insert into project_account_access(project_id,account_email,account_id) values($1,'reports-trend@test.invalid',$2)",
    [hidden.id, actor],
  );
  expect((await trend(hidden.id)).at(-1)?.income).toBe(1110);
  await db.query("delete from project_account_access where project_id=$1", [hidden.id]);
  await expect(trend(hidden.id)).rejects.toThrow("reportPermissionDenied");
  await db.query("update projects set is_active=false where id=$1", [a.id]);
  try {
    await expect(trend(a.id)).rejects.toThrow("reportPermissionDenied");
  } finally {
    await db.query("update projects set is_active=true where id=$1", [a.id]);
  }
  for (const role of ["finance", "boss", "rental_sales", "front_desk"]) {
    await db.query("update user_profiles set role=$1 where id=$2", [role, actor]);
    try {
      if (role === "finance" || role === "boss") expect(await trend(a.id)).toHaveLength(12);
      else await expect(trend(a.id)).rejects.toThrow("reportPermissionDenied");
    } finally {
      await db.query("update user_profiles set role='admin' where id=$1", [actor]);
    }
  }
  const missing = randomUUID();
  await db.query("insert into auth.users(id,email) values($1,'no-report-profile@test.invalid')", [
    missing,
  ]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: missing, role: "authenticated" }),
  ]);
  try {
    await expect(trend(a.id)).rejects.toThrow("reportPermissionDenied");
  } finally {
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: actor, role: "authenticated" }),
    ]);
  }
});

it("rejects malformed scope/month instead of returning false zero totals", async () => {
  await expect(trend(null)).rejects.toThrow("reportPermissionDenied");
  await expect(trend(randomUUID())).rejects.toThrow("reportPermissionDenied");
  for (const month of [null, "2026-10-12", "1899-12-01", "10000-01-01"])
    await expect(trend(a.id, month)).rejects.toThrow("invalidReportMonth");
});

it("is a read-only stable invoker with a fixed search path and no anonymous grant", async () => {
  const before = (
    await db.query(
      "select (select count(*) from ledger_entries) ledger,(select count(*) from receivables) receivables",
    )
  ).rows[0];
  await trend(a.id);
  const after = (
    await db.query(
      "select (select count(*) from ledger_entries) ledger,(select count(*) from receivables) receivables",
    )
  ).rows[0];
  expect(after).toEqual(before);
  const catalog = (
    await db.query(
      "select prosecdef,provolatile,proconfig,pg_get_functiondef(oid) definition from pg_proc where oid='public.reports_trend_rpc(uuid,date)'::regprocedure",
    )
  ).rows[0];
  expect(catalog.prosecdef).toBe(false);
  expect(catalog.provolatile).toBe("s");
  expect(catalog.proconfig).toContain('search_path=""');
  expect(catalog.definition).not.toMatch(/\b(insert|update|delete|truncate)\b/i);
  expect(
    (
      await db.query(
        "select has_function_privilege('anon','public.reports_trend_rpc(uuid,date)','execute') allowed",
      )
    ).rows[0].allowed,
  ).toBe(false);
});

it.runIf(process.env.SACSI_NATIVE_REPORT_ADVISORS === "1")(
  "passes security advisors for the new function on the exact ephemeral loopback cluster",
  async () => {
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
    expect(connection.host).toBe("127.0.0.1");
    expect(connection.port).toBe(cluster.port);
    expect(connection.user).toBe("sacsi_test_owner");
    expect(connection.database).toBe("postgres");
    const npm = process.env.npm_execpath;
    expect(npm).toBeTruthy();
    const url = `postgresql://${connection.user}:${encodeURIComponent(connection.password)}@127.0.0.1:${cluster.port}/postgres?sslmode=disable`;
    let output: { stdout: string; stderr: string };
    try {
      output = await promisify(execFile)(
        process.execPath,
        [
          npm!,
          "exec",
          "--yes",
          "--package=supabase@2.121.0",
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
        {
          windowsHide: true,
          timeout: 45000,
          maxBuffer: 4 * 1024 * 1024,
        },
      );
    } catch {
      // Child-process failures include arguments. Never expose even a disposable password.
      throw new Error("Local report security advisors unavailable");
    }
    const report =
      !output.stdout.trim() && /^No issues found\r?$/m.test(output.stderr)
        ? []
        : JSON.parse(output.stdout);
    const items = Array.isArray(report) ? report : (report.lints ?? report.result);
    expect(Array.isArray(items)).toBe(true);
    const relevant = items.filter((item: unknown) =>
      JSON.stringify(item).includes("reports_trend_rpc"),
    );
    expect(relevant).toEqual([]);
    console.log(
      JSON.stringify({
        reportNativeAdvisors: {
          existingWarnings: items.length,
          newReportWarnings: relevant.length,
        },
      }),
    );
  },
  55000,
);
