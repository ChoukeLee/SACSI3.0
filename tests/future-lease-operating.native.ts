import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";

const migration = "20261026091738_future_lease_operating_projection.sql";
const f = {
  actor: randomUUID(),
  project: randomUUID(),
  hiddenProject: randomUUID(),
  building: randomUUID(),
  hiddenBuilding: randomUUID(),
  customer: randomUUID(),
  tomorrowUnit: randomUUID(),
  todayUnit: randomUUID(),
  yesterdayUnit: randomUUID(),
  historicalUnit: randomUUID(),
  terminatedUnit: randomUUID(),
  hiddenUnit: randomUUID(),
  futureLease: randomUUID(),
  todayLease: randomUUID(),
  yesterdayLease: randomUUID(),
  historicalLease: randomUUID(),
  terminatedLease: randomUUID(),
  hiddenLease: randomUUID(),
  deposit: randomUUID(),
};
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>;
let db: pg.Client;
let today: string;
let beforeRows: unknown;
let beforeAcl: unknown;
let beforeGuards: unknown;

async function businessRows() {
  return (
    await db.query(`select jsonb_build_object(
      'units',(select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from units t),
      'contracts',(select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from lease_contracts t),
      'receivables',(select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from receivables t),
      'payments',(select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from payments t),
      'ledger',(select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from ledger_entries t),
      'allocations',(select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from payment_receivable_allocations t),
      'audits',(select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from audit_logs t),
      'flags',(select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from unit_business_flags t),
      'bookings',(select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from daily_bookings t)) data`)
  ).rows[0].data;
}
async function acl() {
  return (
    await db.query(`select jsonb_build_object(
      'view',(select jsonb_build_object('owner',relowner,'acl',relacl,'options',reloptions)
        from pg_class where oid='public.unit_operational_position'::regclass),
      'functions',(select jsonb_agg(jsonb_build_object('oid',oid,'acl',proacl,'owner',proowner,
        'definer',prosecdef,'volatility',provolatile,'config',proconfig) order by oid)
        from pg_proc where oid in ('public.management_operating_snapshot_rpc(uuid)'::regprocedure,
          'public.contract_workspace_read_rpc(text,jsonb,text,uuid)'::regprocedure))) data`)
  ).rows[0].data;
}
async function businessGuards() {
  return (
    await db.query(`select jsonb_object_agg(oid::regprocedure::text,pg_get_functiondef(oid)) data
      from pg_proc where oid in (
        'private.lease_lifecycle(text,jsonb,uuid)'::regprocedure,
        'public.daily_check_in_booking_rpc(uuid,numeric,uuid,jsonb)'::regprocedure,
        'public.daily_create_booking_rpc(uuid,uuid,date,date,text,numeric,text,text,uuid,jsonb)'::regprocedure,
        'public.set_unit_condition_rpc(uuid,text,timestamptz)'::regprocedure)`)
  ).rows[0].data;
}
async function asActor<T>(work: () => Promise<T>) {
  await db.query("set role authenticated");
  try {
    return await work();
  } finally {
    await db.query("reset role");
  }
}
async function snapshot(project = f.project) {
  return asActor(
    async () =>
      (await db.query("select management_operating_snapshot_rpc($1) data", [project])).rows[0].data,
  );
}
async function workspace(status = "current", kind = "lease", input: Record<string, string> = {}) {
  return asActor(
    async () =>
      (
        await db.query("select contract_workspace_read_rpc($1,$2,'scope') data", [
          kind,
          { projectId: f.project, status, ...input },
        ])
      ).rows[0].data,
  );
}
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await db.query("set timezone='UTC'");
  await installApplicationRebuild(db, { beforeMigration: migration });
  today = (
    await db.query("select (statement_timestamp() at time zone 'Africa/Abidjan')::date::text d")
  ).rows[0].d;
  await db.query("insert into auth.users(id,email) values($1,'future-lease@test.invalid')", [
    f.actor,
  ]);
  await db.query("insert into user_profiles(id,role,display_name) values($1,'admin','Synthetic')", [
    f.actor,
  ]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: f.actor, role: "authenticated" }),
  ]);
  for (const [id, restricted] of [
    [f.project, false],
    [f.hiddenProject, true],
  ] as const)
    await db.query(
      "insert into projects(id,code,display_name,access_mode,allows_daily_rental,allows_long_lease,allows_sale) values($1::uuid,$1::text,'Synthetic',$2,true,true,true)",
      [id, restricted ? "restricted" : "open"],
    );
  for (const [id, project] of [
    [f.building, f.project],
    [f.hiddenBuilding, f.hiddenProject],
  ])
    await db.query(
      "insert into buildings(id,project_id,code,display_name) values($1::uuid,$2,$1::text,'Synthetic')",
      [id, project],
    );
  await db.query("insert into customers(id,name) values($1,'Synthetic tenant')", [f.customer]);
  for (const [id, hidden] of [
    [f.tomorrowUnit, false],
    [f.todayUnit, false],
    [f.yesterdayUnit, false],
    [f.historicalUnit, false],
    [f.terminatedUnit, false],
    [f.hiddenUnit, true],
  ] as const) {
    await db.query(
      "insert into units(id,building_id,code,unit_no,floor_label,status,construction_status,occupancy_verified) values($1::uuid,$2,$1::text,$1::text,'1','leased','operational',true)",
      [id, hidden ? f.hiddenBuilding : f.building],
    );
    await db.query(
      "insert into unit_business_flags(unit_id,business_type,is_enabled) values($1,'long_lease',true),($1,'daily_rental',true)",
      [id],
    );
  }
  for (const [id, unit, offset, endOffset, rent, status] of [
    [f.futureLease, f.tomorrowUnit, 1, 400, 11000000, "active"],
    [f.todayLease, f.todayUnit, 0, 365, 100, "active"],
    [f.yesterdayLease, f.yesterdayUnit, -1, 364, 200, "active"],
    [f.historicalLease, f.historicalUnit, -400, -1, 300, "active"],
    [f.terminatedLease, f.terminatedUnit, -100, -1, 400, "terminated"],
    [f.hiddenLease, f.hiddenUnit, 1, 400, 99999999, "active"],
  ] as const)
    await db.query(
      "insert into lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,status,deposit_amount_xof) values($1::uuid,$2,$3,$1::text,$4::date+$5::int,$4::date+$6::int,'semiannual',15,$7,$8,22000000)",
      [id, unit, f.customer, today, offset, endOffset, rent, status],
    );
  // The future lease's paid deposit and future rent must remain financial facts.
  await db.query(
    "insert into payments(id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,payment_method) values($1,$2,'lease_deposit',$3,$4,22000000,'XOF',1,'cash')",
    [f.deposit, f.tomorrowUnit, f.futureLease, today],
  );
  await db.query(
    "insert into ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof) values($1,$2,$3,$4,'liability_in','lease_deposit',22000000)",
    [f.building, f.tomorrowUnit, f.deposit, today],
  );
  await db.query(
    "insert into receivables(source_type,source_id,building_id,unit_id,customer_id,category,title,due_date,service_period_start,service_period_end,service_period_source,amount_xof,paid_amount_xof,status,management_status) values('lease_contract',$1,$2,$3,$4,'lease_rent','Future first half-year',$5::date+93,$5::date+93,$5::date+275,'Synthetic explicit period',66000000,0,'pending','managed'),('lease_contract',$1,$2,$3,$4,'lease_deposit','Deposit',$5,$5::date+1,$5::date+400,'Synthetic explicit period',22000000,22000000,'paid','managed')",
    [f.futureLease, f.building, f.tomorrowUnit, f.customer, today],
  );
  // A confirmed daily stay is deliberately present to assert check-in remains
  // blocked by the allocated lease even though present occupancy is false.
  await db.query(
    "insert into daily_bookings(unit_id,customer_id,guest_customer_id,check_in,check_out,total_amount_xof,status) values($1,$2,$2,$3::date,$3::date+1,100,'confirmed')",
    [f.tomorrowUnit, f.customer, today],
  );
  beforeRows = await businessRows();
  beforeAcl = await acl();
  beforeGuards = await businessGuards();
  await db.query(readFileSync(resolve("supabase/migrations", migration), "utf8"));
}, 60000);
afterAll(async () => {
  await cluster?.close();
});

it("classifies the day before start as pending, the start day as occupied, and keeps active history occupied until actual termination", async () => {
  const positions = await asActor(
    async () =>
      (
        await db.query(
          "select id,legacy_status,lease_occupied,lease_pending,lease_start_date::text from unit_operational_position order by id",
        )
      ).rows,
  );
  const byId = new Map(positions.map((row) => [row.id, row]));
  expect(byId.get(f.tomorrowUnit)).toMatchObject({
    legacy_status: "leased",
    lease_occupied: false,
    lease_pending: true,
  });
  expect(byId.get(f.tomorrowUnit)?.lease_start_date).toBe(
    (await db.query("select ($1::date+1)::text d", [today])).rows[0].d,
  );
  for (const id of [f.todayUnit, f.yesterdayUnit, f.historicalUnit])
    expect(byId.get(id)).toMatchObject({
      lease_occupied: true,
      lease_pending: false,
      lease_start_date: null,
    });
  expect(byId.get(f.terminatedUnit)).toMatchObject({
    lease_occupied: false,
    lease_pending: false,
    lease_start_date: null,
  });
  expect(byId.has(f.hiddenUnit)).toBe(false);
});

it("current management counts and workspace rent exclude future contracts while current/all lists retain them", async () => {
  const operating = await snapshot();
  expect(operating).toMatchObject({
    leaseCount: 3,
    pendingLeaseCount: 1,
    netCollected: 0,
    dueOutstanding: 0,
    overdue: 0,
  });
  const current = await workspace();
  expect(current.today).toBe(today);
  expect(current.contracts).toHaveLength(4);
  expect(current.stats).toMatchObject({
    active: 3,
    pending: 1,
    rent: 600,
    total: 600,
    received: 22000000,
    outstanding: 66000000,
  });
  expect(current.contracts.find((c: { id: string }) => c.id === f.futureLease)).toMatchObject({
    status: "active",
  });
  expect((await workspace("all")).contracts).toHaveLength(5);
  const active = await workspace("active");
  expect(active.contracts.map((c: { id: string }) => c.id).sort()).toEqual(
    [f.todayLease, f.yesterdayLease, f.historicalLease].sort(),
  );
  expect(active.stats).toEqual(current.stats);
});

it("uses Abidjan business dates despite session timezone changes", async () => {
  for (const zone of ["Pacific/Kiritimati", "Etc/GMT+12"]) {
    await db.query("select set_config('TimeZone',$1,false)", [zone]);
    try {
      expect((await snapshot()).asOf).toBe(today);
      expect((await workspace()).today).toBe(today);
      expect((await workspace()).stats).toMatchObject({ active: 3, pending: 1, rent: 600 });
      const p = await asActor(
        async () =>
          (
            await db.query(
              "select lease_pending,lease_occupied from unit_operational_position where id=$1",
              [f.tomorrowUnit],
            )
          ).rows[0],
      );
      expect(p).toEqual({ lease_pending: true, lease_occupied: false });
    } finally {
      await db.query("set timezone='UTC'");
    }
  }
});

it("sorts Chinese and French status labels by displayed pending-start status in both directions", async () => {
  for (const locale of ["zh", "fr"]) {
    for (const direction of ["asc", "desc"]) {
      const result = await workspace("all", "lease", { sort: "status", locale, direction });
      const labels = result.contracts.map((contract: { status: string; id: string }) =>
        contract.id === f.futureLease ? "pending" : contract.status,
      );
      expect(labels).toEqual(
        direction === "asc"
          ? ["pending", "active", "active", "active", "terminated"]
          : ["terminated", "active", "active", "active", "pending"],
      );
    }
  }
});

it("preserves the one-active-contract guard for future leases and keeps sale statistics unchanged", async () => {
  await db.query("begin");
  try {
    const nextLease = randomUUID();
    await db.query("savepoint second_active");
    await expect(
      db.query(
        "insert into lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,status) values($1::uuid,$2,$3,$1::text,$4::date+7,$4::date+400,'monthly',15,100,'active')",
        [nextLease, f.tomorrowUnit, f.customer, today],
      ),
    ).rejects.toThrow("lease_one_active_contract_per_unit");
    await db.query("rollback to savepoint second_active");
    const position = await asActor(
      async () =>
        (
          await db.query(
            "select lease_start_date::text from unit_operational_position where id=$1",
            [f.tomorrowUnit],
          )
        ).rows[0],
    );
    expect(position.lease_start_date).toBe(
      (await db.query("select ($1::date+1)::text d", [today])).rows[0].d,
    );
    expect((await snapshot()).pendingLeaseCount).toBe(1);
    const sale = randomUUID();
    await db.query(
      "insert into sale_contracts(id,unit_id,customer_id,contract_no,signed_date,total_amount_xof,payment_plan_type,status) values($1::uuid,$2,$3,$1::text,$4::date+7,1000000,'lump_sum','active')",
      [sale, f.terminatedUnit, f.customer, today],
    );
    const sales = await workspace("active", "sale");
    expect(sales.contracts).toHaveLength(1);
    expect(sales.stats).toMatchObject({ active: 1, pending: 0, total: 1000000 });
  } finally {
    await db.query("rollback");
  }
});

it("preserves RLS, ACLs, legacy column order and every business row", async () => {
  expect(await acl()).toEqual(beforeAcl);
  expect(await businessRows()).toEqual(beforeRows);
  expect(await businessGuards()).toEqual(beforeGuards);
  const columns = (
    await db.query(
      "select attname,format_type(atttypid,atttypmod) type from pg_attribute where attrelid='public.unit_operational_position'::regclass and attnum>0 and not attisdropped order by attnum",
    )
  ).rows;
  expect(columns.map((c) => c.attname)).toEqual([
    "id",
    "building_id",
    "unit_no",
    "legacy_status",
    "ownership",
    "operational_condition",
    "construction_status",
    "occupancy_verified",
    "daily_enabled",
    "lease_enabled",
    "daily_occupied",
    "lease_occupied",
    "cleaning_pending",
    "updated_at",
    "lease_pending",
    "lease_start_date",
  ]);
  expect(columns.slice(-2)).toEqual([
    { attname: "lease_pending", type: "boolean" },
    { attname: "lease_start_date", type: "date" },
  ]);
  await expect(snapshot(f.hiddenProject)).rejects.toThrow("managementPermissionDenied");
  expect(
    (
      await db.query(
        "select has_table_privilege('anon','public.unit_operational_position','select') permitted",
      )
    ).rows[0].permitted,
  ).toBe(false);
});

it("still rejects daily check-in and manual condition changes for allocated future assets", async () => {
  const unit = (await db.query("select updated_at::text from units where id=$1", [f.tomorrowUnit]))
    .rows[0];
  const booking = (
    await db.query("select id from daily_bookings where unit_id=$1", [f.tomorrowUnit])
  ).rows[0];
  await expect(
    asActor(() =>
      db.query("select set_unit_condition_rpc($1,'normal',$2)", [f.tomorrowUnit, unit.updated_at]),
    ),
  ).rejects.toThrow("occupiedUnitRequiresBusinessWorkflow");
  await expect(
    asActor(() => db.query("select daily_check_in_booking_rpc($1,0,null,'{}')", [booking.id])),
  ).rejects.toThrow();
  expect(await businessRows()).toEqual(beforeRows);
});
