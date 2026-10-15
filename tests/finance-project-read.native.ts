import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";

let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
const migration = "20261015183529_optimize_finance_authorized_project_reads.sql";
const actor = randomUUID();
let a: Awaited<ReturnType<typeof project>>,
  b: Awaited<ReturnType<typeof project>>,
  hidden: Awaited<ReturnType<typeof project>>,
  empty: Awaited<ReturnType<typeof project>>;
let crossUnitLedger: string, fallbackLedger: string, unscopedLedger: string;

beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  const installed = await installApplicationRebuild(db);
  if (!installed.includes(migration))
    await db.query(readFileSync(resolve("supabase/migrations", migration), "utf8"));

  // Rebuild the exact published read function separately; no production endpoint
  // or record is used. Compare complete JSON, not only a subset of its totals.
  const architecture = readFileSync(
    resolve("supabase/migrations/20261006082906_operational_architecture.sql"),
    "utf8",
  );
  const start = architecture.indexOf("create function public.finance_read_rpc(");
  const end = architecture.indexOf("create function public.account_access_summary_rpc()");
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  await db.query(
    architecture.slice(start, end).replaceAll("finance_read_rpc", "finance_read_reference_rpc"),
  );
  await db.query(
    readFileSync(
      resolve("supabase/migrations/20261015181251_finance_project_scope.sql"),
      "utf8",
    ).replaceAll("finance_read_rpc", "finance_read_reference_rpc"),
  );
  await db.query("insert into auth.users(id,email) values($1,'finance-read@test.invalid')", [
    actor,
  ]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,'admin','Finance read test')",
    [actor],
  );
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: "authenticated" }),
  ]);
  a = await project(false, false);
  b = await project();
  hidden = await project(true);
  empty = await project();

  for (const [fixture, count] of [
    [a, 65],
    [b, 20],
    [hidden, 20],
  ] as const) {
    await db.query(
      `insert into ledger_entries(building_id,unit_id,entry_date,direction,category,amount_xof,description)
       select $1,$2,current_date-(n%3),'income','lease_rent',181.4,'Find exact%_ item '||n
       from generate_series(1,$3::integer) n`,
      [fixture.building, fixture.unit, count],
    );
    await db.query(
      `insert into ledger_entries(building_id,unit_id,entry_date,direction,category,amount_xof)
       values($1,$2,current_date,'liability_in','lease_deposit',110.25),
       ($1,$2,current_date,'liability_out','lease_deposit_refund',55.12)`,
      [fixture.building, fixture.unit],
    );
    await db.query(
      `insert into receivables(building_id,unit_id,source_type,category,title,due_date,amount_xof,paid_amount_xof,status,management_status)
       values($1,$2,'lease_contract','lease_rent','Managed open',current_date-1,181.4,0,'pending','managed'),
       ($1,$2,'lease_contract','lease_rent','Managed partial',current_date,362.8,181.4,'partial','managed'),
       ($1,$2,'lease_contract','property_fee','Managed paid',current_date+1,181.4,181.4,'paid','managed'),
       ($1,$2,'lease_contract','lease_rent','Cancelled',current_date,181.4,0,'cancelled','managed'),
       ($1,$2,'lease_contract','lease_rent','Historical pending',current_date,181.4,0,'pending','historical_pending')`,
      [fixture.building, fixture.unit],
    );
  }
  crossUnitLedger = await ledger(a.building, b.unit, "Cross unit label");
  fallbackLedger = await ledger(null, a.unit, "Legacy unit scope");
  unscopedLedger = await ledger(null, null, "No asset association");
  await ledger(hidden.building, a.unit, "Hidden explicit building wins");
  await ledger(a.building, hidden.unit, "Hidden unit must still fail RLS");
  await db.query(
    `insert into receivables(building_id,unit_id,source_type,category,title,due_date,amount_xof,paid_amount_xof,status,management_status)
     values($1,$2,'lease_contract','lease_rent','Cross unit label',current_date,181.4,0,'pending','managed'),
     (null,$3,'lease_contract','lease_rent','Legacy unit scope',current_date,181.4,0,'pending','managed')`,
    [a.building, b.unit, a.unit],
  );
}, 45000);

afterAll(async () => {
  await cluster?.close();
});

async function project(restricted = false, active = true) {
  const id = randomUUID(),
    building = randomUUID(),
    unit = randomUUID();
  await db.query(
    "insert into projects(id,code,display_name,access_mode) values($1,$2,'Synthetic project',$3)",
    [id, id, restricted ? "restricted" : "open"],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name,is_active,business_paused) values($1,$2,$3,'Synthetic building',$4,$5)",
    [building, id, building, active, !active],
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status) values($1,$2,$3,$4,'1','sold')",
    [unit, building, unit, `Room-${id}`],
  );
  return { id, building, unit };
}

async function ledger(building: string | null, unit: string | null, description: string) {
  const id = randomUUID();
  await db.query(
    "insert into ledger_entries(id,building_id,unit_id,entry_date,direction,category,amount_xof,description) values($1,$2,$3,current_date,'expense','other_expense',1.23,$4)",
    [id, building, unit, description],
  );
  return id;
}

async function asActor<T>(run: () => Promise<T>) {
  await db.query("set role authenticated");
  try {
    return await run();
  } finally {
    await db.query("reset role");
  }
}

async function compare(kind: string, filters: Record<string, unknown>, page = 1, exported = false) {
  return asActor(async () => {
    const result = (
      await db.query(
        "select public.finance_read_rpc($1,$2,$3,$4) actual,public.finance_read_reference_rpc($1,$2,$3,$4) expected",
        [kind, filters, page, exported],
      )
    ).rows[0];
    expect(result.actual).toEqual(result.expected);
    return result.actual;
  });
}

it("preserves every summary, row, export and stable page of the published project reader", async () => {
  for (const kind of ["ledger", "receivables"]) {
    for (const filters of [{}, { projectId: "" }, { projectId: a.id }, { projectId: b.id }]) {
      await compare(kind, filters);
      await compare(kind, filters, 1, true);
      await compare(kind, filters, 2);
    }
  }
  const result = await compare("ledger", { projectId: a.id }, 1, true);
  expect(result.total).toBe(69);
  expect(result.summary.income).toBe(65 * 181.4);
  expect(result.summary.expense).toBe(2.46);
  expect(result.summary.liability_in).toBe(110.25);
  expect(result.summary.liability_out).toBe(55.12);
  expect(result.rows.find((row: { id: string }) => row.id === crossUnitLedger).unit_label).toBe(
    `Room-${b.id}`,
  );
  expect(result.rows.some((row: { id: string }) => row.id === fallbackLedger)).toBe(true);
  expect(result.rows.some((row: { id: string }) => row.id === unscopedLedger)).toBe(false);
});

it("retains dates, exact search, building, direction, category, status and management filters", async () => {
  const today = (await db.query("select current_date::text d")).rows[0].d;
  for (const extra of [
    { dateFrom: today, dateTo: today },
    { buildingId: a.building },
    { buildingId: b.building },
    { direction: "expense" },
    { category: "lease_rent" },
    { search: "exact%_" },
    { search: `Room-${b.id}` },
    { search: "no match" },
    { status: "pending" },
    { management: "all" },
    { management: "historical_pending" },
    { outstandingOnly: true },
    { outstandingOnly: "true", management: "all" },
  ]) {
    await compare("ledger", { projectId: a.id, ...extra }, 1, true);
    await compare("receivables", { projectId: a.id, ...extra }, 1, true);
  }
});

it("represents an authorized empty project as empty, never as another project's financial records", async () => {
  for (const kind of ["ledger", "receivables"]) {
    const result = await compare(kind, { projectId: empty.id }, 1, true);
    expect(result.total).toBe(0);
    expect(result.rows).toEqual([]);
    expect(Object.values(result.summary).every((value) => value === 0)).toBe(true);
  }
});

it("keeps call-local custom plans even for generic-plan clients without changing their setting", async () => {
  await db.query("set plan_cache_mode='force_generic_plan'");
  try {
    for (let i = 0; i < 7; i++) await compare("ledger", { projectId: a.id });
    expect((await db.query("show plan_cache_mode")).rows[0].plan_cache_mode).toBe(
      "force_generic_plan",
    );
  } finally {
    await db.query("reset plan_cache_mode");
  }
  const catalog = (
    await db.query(
      "select prosecdef,provolatile,proconfig,pg_get_functiondef(oid) definition from pg_proc where oid='public.finance_read_rpc(text,jsonb,integer,boolean)'::regprocedure",
    )
  ).rows[0];
  expect(catalog.prosecdef).toBe(false);
  expect(catalog.provolatile).toBe("s");
  expect(catalog.proconfig).toContain("plan_cache_mode=force_custom_plan");
  for (const name of ["visible_units", "visible_buildings", "source", "filtered"])
    expect(catalog.definition).toContain(`${name} as materialized`);
});

it("denies hidden projects and immediately rechecks grants and role changes", async () => {
  await expect(compare("ledger", { projectId: hidden.id })).rejects.toThrow(
    "financePermissionDenied",
  );
  await db.query(
    "insert into project_account_access(project_id,account_email,account_id) values($1,'finance-read@test.invalid',$2)",
    [hidden.id, actor],
  );
  expect((await compare("ledger", { projectId: hidden.id })).total).toBeGreaterThan(0);
  await db.query("delete from project_account_access where project_id=$1 and account_id=$2", [
    hidden.id,
    actor,
  ]);
  await expect(compare("receivables", { projectId: hidden.id })).rejects.toThrow(
    "financePermissionDenied",
  );
  await db.query("update user_profiles set role='rental_sales' where id=$1", [actor]);
  try {
    await expect(compare("ledger", { projectId: a.id })).rejects.toThrow("financePermissionDenied");
  } finally {
    await db.query("update user_profiles set role='admin' where id=$1", [actor]);
  }
  expect(
    (
      await db.query(
        "select has_function_privilege('anon','public.finance_read_rpc(text,jsonb,integer,boolean)','execute') permitted",
      )
    ).rows[0].permitted,
  ).toBe(false);
});

it("preserves invalid request rejection instead of converting broken filters into zero results", async () => {
  await expect(compare("ledger", { projectId: "not-a-uuid" })).rejects.toThrow(/uuid/);
  await expect(compare("ledger", { dateFrom: "2026-02-01", dateTo: "2026-01-01" })).rejects.toThrow(
    "invalidFinanceDateRange",
  );
  await expect(compare("wrong-kind", {})).rejects.toThrow("invalidFinanceFilter");
  await expect(compare("ledger", {}, 0)).rejects.toThrow("invalidFinanceFilter");
});

it("explicitly denies an authenticated identity without an authoritative application profile", async () => {
  const missingProfileActor = randomUUID();
  await db.query("insert into auth.users(id,email) values($1,'missing-profile@test.invalid')", [
    missingProfileActor,
  ]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: missingProfileActor, role: "authenticated" }),
  ]);
  try {
    await expect(compare("ledger", {})).rejects.toThrow("financePermissionDenied");
  } finally {
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: actor, role: "authenticated" }),
    ]);
  }
});
