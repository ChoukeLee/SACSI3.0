import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";

const migration = "20261024223452_cimac_customer_billing_set_based_read.sql";
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
const actor = randomUUID(),
  finance = randomUUID(),
  project = randomUUID(),
  otherProject = randomUUID(),
  building = randomUUID(),
  otherBuilding = randomUUID();
let baseline: Array<{ query: unknown[]; value: unknown }> = [];
async function login(id = actor) {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, role: "authenticated" }),
  ]);
  await db.query("set role authenticated");
}
async function owner(sql: string, args: unknown[] = []) {
  await db.query("reset role");
  return db.query(sql, args);
}
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  const manifest = JSON.parse(
    await readFile("supabase/baselines/rebuild-manifest.json", "utf8"),
  ) as { overlays: Array<{ file: string }> };
  await installApplicationRebuild(
    db,
    manifest.overlays.some((s) => s.file === migration) ? { beforeMigration: migration } : {},
  );
  for (const [id, role] of [
    [actor, "admin"],
    [finance, "finance"],
  ]) {
    await db.query("insert into auth.users(id,email) values($1::uuid,$1::text||'@test.invalid')", [
      id,
    ]);
    await db.query("insert into user_profiles(id,role,display_name) values($1,$2,$3)", [
      id,
      role,
      role,
    ]);
  }
  await db.query(
    "insert into projects(id,code,display_name,allows_long_lease,allows_sale) values($1,'CIMAC','Synthetic CIMAC',true,true),($2,'OTHER','Synthetic other',true,true)",
    [project, otherProject],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name) values($1,$2,'CIMAC-B','Synthetic CIMAC'),($3,$4,'OTHER-B','Synthetic Other')",
    [building, project, otherBuilding, otherProject],
  );
  await db.query(
    "create temporary table perf_customers(n int primary key,id uuid not null); insert into perf_customers select i,gen_random_uuid() from generate_series(1,404) i; insert into customers(id,name) select id,'Synthetic customer '||lpad(n::text,4,'0') from perf_customers where n<=4",
  );
  await db.query(
    "create temporary table perf_units(n int primary key,id uuid not null); insert into perf_units select i,gen_random_uuid() from generate_series(1,588) i",
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status,kind) select id,$1,'PERF-'||n::text,'P-'||n::text,'G','leased','storefront' from perf_units where n<=4",
    [building],
  );
  await db.query(
    "create temporary table perf_leases(n int primary key,id uuid not null); insert into perf_leases select i,gen_random_uuid() from generate_series(1,263) i; insert into lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,status) select l.id,u.id,c.id,'PERF-LEASE-'||l.n,current_date-30,current_date+365,'monthly',1,100000,'active' from perf_leases l join perf_units u on u.n=l.n join perf_customers c on c.n=l.n where l.n<=4",
  );
  await db.query(
    "insert into receivables(building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,currency) select $1,u.id,c.id,'lease_contract',l.id,'lease_rent','Synthetic due',current_date-1,100000,'XOF' from perf_leases l join perf_units u on u.n=l.n join perf_customers c on c.n=l.n where l.n<=4",
    [building],
  );
  await login();
  for (const query of [
    [null, null, 1],
    [null, "PERF-LEASE-2", 1],
    [null, "P-3", 1],
    [null, "missing", 1],
  ])
    baseline.push({
      query,
      value: (await db.query("select cimac_customer_account_rpc($1,$2,$3) value", query)).rows[0]
        .value,
    });
  await owner(await readFile(`supabase/migrations/${migration}`, "utf8"));
}, 45000);
afterAll(async () => {
  await cluster?.close();
});

it("preserves exact authorized legacy output, filtering, and null-period facts", async () => {
  await login();
  for (const entry of baseline)
    expect(
      (await db.query("select cimac_customer_account_rpc($1,$2,$3) value", entry.query)).rows[0]
        .value,
    ).toEqual(entry.value);
  expect(
    (
      await owner(
        "select proacl::text acl,prosecdef,proconfig from pg_proc where oid='private.cimac_customer_account(uuid,text,integer)'::regprocedure",
      )
    ).rows[0],
  ).toMatchObject({
    prosecdef: true,
    proconfig: expect.arrayContaining(['search_path=""', "plan_cache_mode=force_custom_plan"]),
  });
});

it("keeps contradictory unit/building history for review but excludes it from valid balances, preserving building-only bills", async () => {
  const wrongBuilding = randomUUID();
  await owner(
    "insert into buildings(id,project_id,code,display_name) values($1,$2,'CIMAC-MISMATCH','Synthetic mismatch')",
    [wrongBuilding, project],
  );
  const fixture = (
    await db.query(
      "select c.id customer,u.id unit,l.id contract from perf_customers c join perf_units u on u.n=c.n join perf_leases l on l.n=c.n where c.n=1",
    )
  ).rows[0];
  await db.query(
    "insert into receivables(building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,currency) values($1,$2,$3,'lease_contract',$4,'property_fee','Contradictory historical building',current_date-1,777,'XOF'),($5,null,$3,'manual',null,'other','Valid building-only legacy bill',current_date-1,888,'XOF')",
    [wrongBuilding, fixture.unit, fixture.customer, fixture.contract, building],
  );
  await login();
  const value = (
    await db.query("select cimac_customer_account_rpc($1,null,1) value", [fixture.customer])
  ).rows[0].value;
  expect(value.receivables).toHaveLength(3);
  expect(
    value.receivables.find(
      (r: { title: string }) => r.title === "Contradictory historical building",
    ).collectible,
  ).toBe(false);
  expect(value.customer.balances[0].outstanding).toBe("100888.00");
});

it("reads a production-sized global inventory under a 3-second budget without bypassing current role or project scope", async () => {
  await owner(
    "insert into customers(id,name) select id,'Synthetic customer '||lpad(n::text,4,'0') from perf_customers where n>4",
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status,kind) select id,case when n<=190 then $1::uuid else $2::uuid end,'PERF-'||n::text,'P-'||n::text,'G','leased','storefront' from perf_units where n>4",
    [building, otherBuilding],
  );
  await db.query(
    "insert into lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,status) select l.id,u.id,c.id,'PERF-LEASE-'||l.n,current_date-30,current_date+365,'monthly',1,100000,'active' from perf_leases l join perf_units u on u.n=case when l.n<=77 then l.n else l.n+113 end join perf_customers c on c.n=case when l.n<=77 then ((l.n-1)%40)+1 else ((l.n-78)%364)+41 end where l.n>4",
  );
  await db.query(
    "insert into sale_contracts(unit_id,customer_id,contract_no,signed_date,payment_plan_type,status) select u.id,c.id,'PERF-SALE-'||i,current_date-30,'lump_sum','draft' from generate_series(1,199) i join perf_units u on u.n=190+i join perf_customers c on c.n=((i-1)%364)+41",
  );
  await db.query(
    "insert into receivables(building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,currency) select u.building_id,u.id,c.customer_id,'lease_contract',c.id,'lease_rent','Synthetic production-sized due',current_date-1,100000,'XOF' from lease_contracts c join units u on u.id=c.unit_id where c.contract_no like 'PERF-%' and not exists(select 1 from receivables r where r.source_id=c.id)",
  );
  await db.query(
    "create temporary table perf_payments(n int primary key,id uuid not null); insert into perf_payments select i,gen_random_uuid() from generate_series(1,2654) i; insert into payments(id,customer_id,unit_id,source_type,source_id,payment_date,amount,currency) select p.id,c.customer_id,c.unit_id,'lease_rent',c.id,current_date-1,1000,'XOF' from perf_payments p join perf_leases lookup on lookup.n=((p.n-1)%263)+1 join lease_contracts c on c.id=lookup.id",
  );
  await db.query(
    "insert into ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof) select u.building_id,p.unit_id,p.id,p.payment_date,'income','lease_rent',p.amount from payments p join units u on u.id=p.unit_id",
  );
  await db.query(
    "insert into ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof) select u.building_id,p.unit_id,p.id,p.payment_date,'income','property_fee',1 from payments p join units u on u.id=p.unit_id order by p.id limit 4",
  );
  await db.query("analyze");
  const counts = (
    await db.query(
      "select (select count(*) from customers)::int customers,(select count(*) from units)::int units,(select count(*) from lease_contracts)::int leases,(select count(*) from sale_contracts)::int sales,(select count(*) from payments)::int payments,(select count(*) from ledger_entries)::int ledger",
    )
  ).rows[0];
  expect(counts).toEqual({
    customers: 404,
    units: 588,
    leases: 263,
    sales: 199,
    payments: 2654,
    ledger: 2658,
  });
  await login();
  await db.query("set statement_timeout='3s'");
  const times: number[] = [];
  for (let i = 0; i < 6; i++) {
    const start = performance.now();
    const value = (await db.query("select cimac_customer_account_rpc(null,null,1) value")).rows[0]
      .value;
    times.push(performance.now() - start);
    expect(value.customerPage.total).toBe(40);
    expect(value.customerPage.rows).toHaveLength(40);
    expect(value.complete).toBe(true);
    expect(
      value.contracts.every((c: { data: { unit_id: string } }) =>
        value.units.some((u: { id: string }) => u.id === c.data.unit_id),
      ),
    ).toBe(true);
  }
  console.log(
    JSON.stringify({
      cimacReadPerformance: { counts, timesMs: times.map((n) => Math.round(n)), budgetMs: 3000 },
    }),
  );
  expect(Math.max(...times)).toBeLessThan(3000);
  await owner("update projects set access_mode='restricted' where id=$1", [project]);
  await login(finance);
  await expect(db.query("select cimac_customer_account_rpc(null,null,1)")).rejects.toThrow(
    "cimacBillingPermissionDenied",
  );
});

it("covers the three new FK indexes without changing default-deny private table grants", async () => {
  const r = (
    await owner(
      "select count(*)::int n from pg_indexes where schemaname='private' and indexname in ('cimac_billing_requests_customer','cimac_fee_terms_recorder','cimac_meter_readings_recorder')",
    )
  ).rows[0];
  expect(r.n).toBe(3);
  await login();
  await expect(db.query("select * from private.cimac_billing_requests")).rejects.toThrow();
});
