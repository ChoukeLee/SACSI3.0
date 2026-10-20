import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { decodeOperatingSnapshot } from "../src/features/management/operating-snapshot";

let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
const actor = randomUUID(),
  customer = randomUUID();
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await installApplicationRebuild(db);
  await db.query("insert into auth.users(id,email) values($1,'native-snapshot@test.invalid')", [
    actor,
  ]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,'admin','Synthetic native reviewer')",
    [actor],
  );
  await db.query("insert into customers(id,name) values($1,'Synthetic native customer')", [
    customer,
  ]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: "authenticated" }),
  ]);
}, 45000);
afterAll(async () => {
  await cluster?.close();
});

async function project(restricted = false) {
  const project = randomUUID(),
    building = randomUUID();
  await db.query(
    "insert into projects(id,code,display_name,access_mode,allows_daily_rental,allows_long_lease) values($1::uuid,$1::text,'Synthetic native scope',$2,true,true)",
    [project, restricted ? "restricted" : "open"],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name) values($1::uuid,$2,$1::text,'Synthetic native building')",
    [building, project],
  );
  return { project, building };
}
async function lease(
  scope: Awaited<ReturnType<typeof project>>,
  currency: "USD" | "CNY",
  status = "active",
) {
  const unit = randomUUID(),
    contract = randomUUID();
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status,occupancy_verified,construction_status) values($1::uuid,$2,$1::text,$1::text,'1','leased',true,'operational')",
    [unit, scope.building],
  );
  await db.query(
    "insert into lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,rent_currency,monthly_rent_amount,status) values($1::uuid,$2,$3,$1::text,current_date-90,current_date+365,'monthly',1,0,$4,3200,$5)",
    [contract, unit, customer, currency, status],
  );
  return { ...scope, unit, contract, currency };
}
type Lease = Awaited<ReturnType<typeof lease>>;
async function receivable(
  f: Lease,
  amount: number,
  paid: number,
  dueOffset = -1,
  overrides: { building?: string; management?: string } = {},
) {
  const id = randomUUID();
  await db.query(
    "insert into receivables(id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,currency,amount_native,paid_amount_native,status,management_status) values($1,$2,$3,$4,'lease_contract',$5,'lease_rent','Synthetic native bill',current_date+$6::int,0,0,$7,$8,$9,$10,$11)",
    [
      id,
      overrides.building ?? f.building,
      f.unit,
      customer,
      f.contract,
      dueOffset,
      f.currency,
      amount,
      paid,
      paid === amount ? "paid" : paid > 0 ? "partial" : "pending",
      overrides.management ?? "managed",
    ],
  );
  return id;
}
async function payment(f: Lease, amount: number, noUnit = false, previousMonth = false) {
  await db.query(
    "insert into payments(unit_id,customer_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,native_settlement,payment_method) values($1,$2,'lease_rent',$3,case when $4 then date_trunc('month',current_date)::date-1 else current_date end,$5,$6,null,true,'bank_transfer')",
    [noUnit ? null : f.unit, customer, f.contract, previousMonth, amount, f.currency],
  );
}
async function snapshot(projectId: string) {
  await db.query("set role authenticated");
  try {
    return decodeOperatingSnapshot(
      (await db.query("select management_operating_snapshot_rpc($1) value", [projectId])).rows[0]
        .value,
    );
  } finally {
    await db.query("reset role");
  }
}

it("restores every authorized materialized fence and exactly one project daily classifier without losing native projections", async () => {
  const result = (
    await db.query(
      "select pg_get_functiondef(oid) definition,prosecdef,provolatile,has_function_privilege('anon',oid,'execute') anonymous from pg_proc where oid='public.management_operating_snapshot_rpc(uuid)'::regprocedure",
    )
  ).rows[0];
  expect(result).toMatchObject({ prosecdef: false, provolatile: "s", anonymous: false });
  for (const name of [
    "raw_buildings",
    "raw_units",
    "raw_payments",
    "raw_receivables",
    "raw_receivable_units",
    "raw_leases",
    "raw_sales",
    "raw_ledger",
    "raw_daily",
  ])
    expect(result.definition).toContain(`${name} as materialized`);
  expect(result.definition).not.toContain("for building in");
  expect(result.definition.match(/public\.daily_receipts_read_rpc\(/g)).toHaveLength(1);
  expect(result.definition).toContain("jsonb_build_object('projectId',p_project_id)");
  expect(result.definition).toContain("or r.amount_native is not null");
  expect(result.definition).toContain("'nativeSummary'");
  expect(result.definition).toContain("p.native_settlement or p.source_type");
});

it("retains fully paid native obligations and exact independent USD/CNY buckets without fabricating XOF or excluded receipts", async () => {
  const scope = await project(),
    usd = await lease(scope, "USD"),
    cny = await lease(scope, "CNY");
  await receivable(usd, 6400.58, 6400.58);
  await receivable(usd, 200.15, 50.01);
  await receivable(usd, 999, 0, 1); // Future debt is not a currently due obligation.
  await receivable(usd, 777, 0, -1, { management: "historical_pending" });
  await receivable(cny, 1000.02, 0);
  await payment(usd, 3200.29);
  await payment(usd, 333.33, false, true); // Prior cash is not current-month cash.
  await payment(cny, 500.01);
  await db.query(
    "insert into payments(unit_id,source_type,payment_date,amount,currency,exchange_rate_to_xof,payment_method) values($1,'parking_fee',current_date,500,'XOF',1,'cash')",
    [usd.unit],
  );
  const result = await snapshot(scope.project);
  expect(result.nativeSummary).toEqual([
    {
      currency: "CNY",
      income: 500.01,
      expense: 0,
      liability_in: 0,
      liability_out: 0,
      receivable: 1000.02,
      paid: 0,
      outstanding: 1000.02,
      overdue: 1000.02,
    },
    {
      currency: "USD",
      income: 3200.29,
      expense: 0,
      liability_in: 0,
      liability_out: 0,
      receivable: 6600.73,
      paid: 6450.59,
      outstanding: 150.14,
      overdue: 150.14,
    },
  ]);
  expect(result.netCollected).toBe(500);
  expect(result.businessNet).toEqual({ lease: 0, sale: 0, asset: 500 });
  expect(result.dueOutstanding).toBe(0);
  expect(result.overdue).toBe(0);
  expect(result.upcoming).toBe(0);
  expect(result.historicalPending).toBe(0);
  expect(result.dueItems).toEqual([]);
  expect(result.excludedCount).toBe(0);
  expect(result.trend[11]).toMatchObject({ net: 500, count: 1, excluded: 0 });
});

it("retains ended-contract native receipts and obligations, including exact null-unit contract fallback", async () => {
  const scope = await project(),
    usd = await lease(scope, "USD", "terminated");
  await receivable(usd, 3200, 800);
  await payment(usd, 800, true);
  const result = await snapshot(scope.project);
  expect(result.leaseCount).toBe(0);
  expect(result.nativeSummary).toEqual([
    {
      currency: "USD",
      income: 800,
      expense: 0,
      liability_in: 0,
      liability_out: 0,
      receivable: 3200,
      paid: 800,
      outstanding: 2400,
      overdue: 2400,
    },
  ]);
  expect(result.netCollected).toBe(0);
  expect(result.excludedCount).toBe(0);
});

it("preserves a declared active native currency as an explicit zero bucket even before first receipt", async () => {
  const scope = await project();
  await lease(scope, "CNY");
  expect((await snapshot(scope.project)).nativeSummary).toEqual([
    {
      currency: "CNY",
      income: 0,
      expense: 0,
      liability_in: 0,
      liability_out: 0,
      receivable: 0,
      paid: 0,
      outstanding: 0,
      overdue: 0,
    },
  ]);
});

it("keeps native receivable-building precedence distinct from contractual payment-unit attribution", async () => {
  const home = await project(),
    financial = await project(),
    usd = await lease(home, "USD");
  await receivable(usd, 1000, 100, -1, { building: financial.building });
  await payment(usd, 100);
  const first = await snapshot(home.project),
    second = await snapshot(financial.project);
  expect(first.nativeSummary).toEqual([
    {
      currency: "USD",
      income: 100,
      expense: 0,
      liability_in: 0,
      liability_out: 0,
      receivable: 0,
      paid: 0,
      outstanding: 0,
      overdue: 0,
    },
  ]);
  expect(second.nativeSummary).toEqual([
    {
      currency: "USD",
      income: 0,
      expense: 0,
      liability_in: 0,
      liability_out: 0,
      receivable: 1000,
      paid: 100,
      outstanding: 900,
      overdue: 900,
    },
  ]);
});

it("keeps restricted native money behind current project grants and immediately respects revoked scope/role", async () => {
  const open = await project(),
    hidden = await project(true),
    usd = await lease(hidden, "USD");
  await receivable(usd, 700, 0);
  await payment(usd, 900);
  expect((await snapshot(open.project)).nativeSummary).toEqual([]);
  await expect(snapshot(hidden.project)).rejects.toThrow("managementPermissionDenied");
  await db.query(
    "insert into project_account_access(project_id,account_id,account_email) values($1,$2,'native-snapshot@test.invalid')",
    [hidden.project, actor],
  );
  expect((await snapshot(hidden.project)).nativeSummary).toEqual([
    {
      currency: "USD",
      income: 900,
      expense: 0,
      liability_in: 0,
      liability_out: 0,
      receivable: 700,
      paid: 0,
      outstanding: 700,
      overdue: 700,
    },
  ]);
  await db.query("delete from project_account_access where project_id=$1 and account_id=$2", [
    hidden.project,
    actor,
  ]);
  await expect(snapshot(hidden.project)).rejects.toThrow("managementPermissionDenied");
  expect((await snapshot(open.project)).nativeSummary).toEqual([]);
  await db.query("update user_profiles set role='rental_sales' where id=$1", [actor]);
  try {
    await expect(snapshot(open.project)).rejects.toThrow("managementPermissionDenied");
  } finally {
    await db.query("update user_profiles set role='admin' where id=$1", [actor]);
  }
});
