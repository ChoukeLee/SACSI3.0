import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";

const migration = "20261102184837_cimac_b17_apartment_directory.sql";
const admin = randomUUID(),
  secondAdmin = randomUUID(),
  finance = randomUUID(),
  desk = randomUUID(),
  outsider = randomUUID();
const project = randomUUID(),
  other = randomUUID(),
  building = randomUUID(),
  otherBuilding = randomUUID();
const shops = [1701, 1702, 1703, 1704].map((number) => ({ id: randomUUID(), number }));
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
let originalFacts: unknown, originalUnits: unknown;
let applied: string[];
const facts = `select jsonb_build_object(
 'contracts',(select jsonb_agg(to_jsonb(t) order by id) from lease_contracts t),
 'payments',(select jsonb_agg(to_jsonb(t) order by id) from payments t),
 'ledger',(select jsonb_agg(to_jsonb(t) order by id) from ledger_entries t),
 'receivables',(select jsonb_agg(to_jsonb(t) order by id) from receivables t),
 'feeRules',(select jsonb_agg(to_jsonb(t) order by id) from property_fee_rules t),
 'customers',(select jsonb_agg(to_jsonb(t) order by id) from customers t),
 'flags',(select jsonb_agg(to_jsonb(t) order by unit_id,business_type) from unit_business_flags t)) value`;

async function owner(sql: string, params: unknown[] = []) {
  if (/^rollback\b/i.test(sql)) {
    const result = await db.query(sql, params);
    await db.query("reset role");
    return result;
  }
  await db.query("reset role");
  return db.query(sql, params);
}
async function login(actor: string | null = admin, jwtRole = "authenticated") {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      sub: actor,
      role: jwtRole,
      app_metadata: { role: "admin" },
      user_metadata: { role: "admin" },
    }),
  ]);
  await db.query("set role authenticated");
}
async function initialize(request = randomUUID(), actor: string | null = admin) {
  await login(actor);
  return (await db.query("select public.cimac_apartments_initialize_rpc($1) value", [request]))
    .rows[0].value;
}
async function counts() {
  return (
    await owner(
      `select (select count(*)::integer from public.cimac_apartment_profiles) profiles,
    (select count(*)::integer from public.units where building_id=$1 and unit_no ~ '^[2-5][0-9]{2}$') rooms,
    (select count(*)::integer from public.audit_logs where entity_type='cimac_apartment_initialization') audits`,
      [building],
    )
  ).rows[0];
}

beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  applied = await installApplicationRebuild(db);
  for (const [id, role] of [
    [admin, "admin"],
    [secondAdmin, "admin"],
    [finance, "finance"],
    [desk, "front_desk"],
    [outsider, "admin"],
  ]) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [id, `${id}@test.invalid`]);
    await db.query(
      "insert into public.user_profiles(id,role,display_name) values($1,$2,'Synthetic actor')",
      [id, role],
    );
  }
  await db.query(
    `insert into public.projects(id,code,display_name,access_mode,allows_long_lease)
    values($1,'CIMAC','Synthetic park','restricted',true),($2,'OTHER','Synthetic other','open',true)`,
    [project, other],
  );
  for (const id of [admin, secondAdmin, finance, desk])
    await db.query(
      "insert into public.project_account_access(project_id,account_email,account_id) values($1,$2,$3)",
      [project, `${id}@test.invalid`, id],
    );
  await db.query(
    `insert into public.buildings(id,project_id,code,display_name)
    values($1,$2,'CIMAC-B17','Synthetic B17'),($3,$4,'OTHER-B17','Synthetic unrelated')`,
    [building, project, otherBuilding, other],
  );
  for (const shop of shops)
    await db.query(
      `insert into public.units(id,building_id,code,unit_no,floor_label,kind,status,asset_subtype,construction_status,occupancy_verified,area_sqm)
      values($1,$2,$3,$4,'G','storefront','reserved','apartment_ground_floor_shop','operational',true,57.75)`,
      [shop.id, building, `CIMAC-B17-${shop.number}`, `${shop.number}`],
    );
  const foreign = (
    await db.query(
      `insert into public.units(building_id,code,unit_no,floor_label,kind,status)
    values($1,'OTHER-201','201','2F','apartment','available') returning id`,
      [otherBuilding],
    )
  ).rows[0].id;
  const customer = (
    await db.query(
      "insert into public.customers(name,notes) values('Synthetic original tenant','Retain original documentary history') returning id",
    )
  ).rows[0].id;
  const lease = (
    await db.query(
      `insert into public.lease_contracts(unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,status)
    values($1,$2,'APARTMENT-HISTORY',current_date,current_date+365,'monthly',1,100,'draft') returning id`,
      [shops[0].id, customer],
    )
  ).rows[0].id;
  const payment = (
    await db.query(
      `insert into public.payments(customer_id,unit_id,source_type,source_id,payment_date,amount,currency)
    values($1,$2,'lease_deposit',$3,current_date,10,'XOF') returning id`,
      [customer, shops[0].id, lease],
    )
  ).rows[0].id;
  await db.query(
    `insert into public.ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,currency)
    values($1,$2,$3,current_date,'liability_in','lease_deposit',10,'XOF')`,
    [building, shops[0].id, payment],
  );
  await db.query(
    `insert into public.receivables(building_id,unit_id,customer_id,source_type,category,title,due_date,amount_xof,paid_amount_xof,status,currency)
    values($1,$2,$3,'lease_contract','lease_rent','Synthetic original history',current_date,100,0,'pending','XOF')`,
    [building, shops[0].id, customer],
  );
  await db.query(
    `insert into public.property_fee_rules(unit_id,monthly_amount_xof,start_date,end_date,notes)
    values($1,12345,'2027-04-01','2028-03-31','Keep independent original fees')`,
    [shops[0].id],
  );
  await db.query(
    "insert into public.unit_business_flags(unit_id,business_type) values($1,'long_lease'),($2,'long_lease')",
    [shops[0].id, foreign],
  );
  originalFacts = (await db.query(facts)).rows[0].value;
  originalUnits = (
    await db.query("select jsonb_agg(to_jsonb(u) order by id) value from public.units u")
  ).rows[0].value;
}, 45000);
beforeEach(async () => {
  await owner("begin");
});
afterEach(async () => {
  await owner("rollback");
});
afterAll(async () => {
  await cluster?.close();
});

it("cleanly rebuilds schema without inserting any business rows, and exposes only an invoker authenticated RPC", async () => {
  expect(applied).toContain(migration);
  expect(await counts()).toEqual({ profiles: 0, rooms: 0, audits: 0 });
  const access = (
    await owner(`select p.prosecdef,
    has_function_privilege('anon',p.oid,'execute') anon,
    has_function_privilege('service_role',p.oid,'execute') service,
    has_function_privilege('authenticated',p.oid,'execute') authenticated
    from pg_proc p where p.oid='public.cimac_apartments_initialize_rpc(uuid)'::regprocedure`)
  ).rows[0];
  expect(access).toEqual({ prosecdef: false, anon: false, service: false, authenticated: true });
  const table = (
    await owner(
      "select relrowsecurity from pg_class where oid='public.cimac_apartment_profiles'::regclass",
    )
  ).rows[0];
  expect(table.relrowsecurity).toBe(true);
});

it("requires a real admin and B17 project ACL, ignoring editable JWT role metadata", async () => {
  for (const actor of [finance, desk, outsider, null]) {
    await owner("savepoint denied");
    await expect(initialize(randomUUID(), actor)).rejects.toThrow("CimacApartmentsDenied");
    await owner("rollback to savepoint denied");
  }
  await owner("savepoint invalid");
  await login();
  await expect(db.query("select public.cimac_apartments_initialize_rpc(null)")).rejects.toThrow(
    "CimacApartmentsInvalidRequest",
  );
  await owner("rollback to savepoint invalid");
  expect(await counts()).toEqual({ profiles: 0, rooms: 0, audits: 0 });
});

it("cannot initialize a disabled B17 building even as an authorized admin", async () => {
  await owner("update public.buildings set is_active=false where id=$1", [building]);
  await owner("savepoint disabled");
  await expect(initialize()).rejects.toThrow("CimacApartmentsDenied");
  await owner("rollback to savepoint disabled");
  expect(await counts()).toEqual({ profiles: 0, rooms: 0, audits: 0 });
});

it("atomically creates the confirmed 64-room catalogue, prices and terms, with all actual occupancy and readiness unknown", async () => {
  const request = randomUUID();
  const result = await initialize(request);
  expect(result).toMatchObject({
    success: true,
    requestId: request,
    projectId: project,
    buildingId: building,
    actorId: admin,
    roomCount: 64,
    idempotent: false,
  });
  expect(result.unitIds).toHaveLength(64);
  expect(new Set(result.unitIds).size).toBe(64);
  const rows = (
    await owner(`select a.*,u.unit_no,u.code,u.floor_label,u.kind,u.asset_subtype,u.layout,u.status,
    u.construction_status,u.occupancy_verified,u.area_sqm
    from public.cimac_apartment_profiles a join public.units u on u.id=a.unit_id order by floor_number,room_suffix`)
  ).rows;
  expect(rows).toHaveLength(64);
  let one = 0,
    two = 0,
    east = 0;
  for (const row of rows) {
    const bedrooms = [11, 15, 16].includes(row.room_suffix) ? 2 : 1;
    const facing = [1, 3, 5, 7, 9, 10, 12, 13, 15].includes(row.room_suffix) ? "east" : "west";
    bedrooms === 1 ? one++ : two++;
    if (facing === "east") east++;
    expect(row).toMatchObject({
      building_id: building,
      bedrooms,
      facing,
      created_by: admin,
      monthly_rent_xof: bedrooms === 1 ? "350000.00" : "600000.00",
      monthly_property_fee_xof: bedrooms === 1 ? "30000.00" : "40000.00",
      deposit_months: 2,
      rent_prepay_months: 6,
      property_prepay_months: 12,
      unit_no: `${row.floor_number * 100 + row.room_suffix}`,
      code: `CIMAC-B17-${row.floor_number * 100 + row.room_suffix}`,
      floor_label: `${row.floor_number}F`,
      kind: "apartment",
      asset_subtype: "apartment",
      layout: bedrooms === 1 ? "一室一厅" : "两室",
      construction_status: "unverified",
      occupancy_verified: false,
      area_sqm: null,
    });
    expect([2, 3, 4, 5]).toContain(row.floor_number);
  }
  expect({ one, two, east, west: 64 - east }).toEqual({ one: 52, two: 12, east: 36, west: 28 });
  const audit = (
    await owner(
      "select actor_id,actor_role,action,before_data,after_data,metadata from public.audit_logs where entity_id=$1",
      [request],
    )
  ).rows;
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    actor_id: admin,
    actor_role: "admin",
    action: "initialize",
    before_data: [],
    metadata: { project_id: project, building_id: building, request_id: request, result },
  });
  expect(audit[0].after_data).toHaveLength(64);
  expect((await owner(facts)).rows[0].value).toEqual(originalFacts);
  expect(
    (
      await owner(
        "select jsonb_agg(to_jsonb(u) order by id) value from public.units u where not(id=any($1::uuid[]))",
        [result.unitIds],
      )
    ).rows[0].value,
  ).toEqual(originalUnits);
});

it("recovers only the original request without replay or cross-actor reuse, and allows later real state changes", async () => {
  const request = randomUUID(),
    first = await initialize(request);
  expect(await initialize(request)).toEqual({ ...first, idempotent: true });
  await owner(
    "update public.units set occupancy_verified=true,construction_status='operational',area_sqm=55 where id=$1",
    [first.unitIds[0]],
  );
  expect(await initialize(request)).toEqual({ ...first, idempotent: true });
  await owner("savepoint reused");
  await expect(initialize(request, secondAdmin)).rejects.toThrow("CimacApartmentsRequestConflict");
  await owner("rollback to savepoint reused");
  await owner("savepoint duplicate");
  await expect(initialize()).rejects.toThrow("CimacApartmentsAlreadyInitialized");
  await owner("rollback to savepoint duplicate");
  expect(await counts()).toEqual({ profiles: 64, rooms: 64, audits: 1 });
});

it("detects catalogue identity drift instead of re-creating rooms or silently overwriting changes", async () => {
  const request = randomUUID(),
    first = await initialize(request);
  await owner("update public.units set unit_no='201-corrected' where id=$1", [first.unitIds[0]]);
  await owner("savepoint drift");
  await expect(initialize(request)).rejects.toThrow("CimacApartmentsInitializationDrift");
  await owner("rollback to savepoint drift");
  expect(await counts()).toEqual({ profiles: 64, rooms: 63, audits: 1 });
  expect(
    (
      await owner("select count(*)::integer count from public.units where id=any($1::uuid[])", [
        first.unitIds,
      ])
    ).rows[0].count,
  ).toBe(64);
  expect(
    (await owner("select unit_no from public.units where id=$1", [first.unitIds[0]])).rows[0]
      .unit_no,
  ).toBe("201-corrected");
});

it("fails the whole batch for an existing target room without modifying original records", async () => {
  const conflict = (
    await owner(
      `insert into public.units(building_id,code,unit_no,floor_label,kind)
    values($1,'ORIGINAL-216','216','2F','apartment') returning id`,
      [building],
    )
  ).rows[0].id;
  await owner("savepoint collision");
  await expect(initialize()).rejects.toThrow("CimacApartmentsRoomConflict");
  await owner("rollback to savepoint collision");
  expect(await counts()).toEqual({ profiles: 0, rooms: 1, audits: 0 });
  expect((await owner("select code from public.units where id=$1", [conflict])).rows[0].code).toBe(
    "ORIGINAL-216",
  );
  expect((await owner(facts)).rows[0].value).toEqual(originalFacts);
});

it("rolls back earlier inserted rooms when a hidden foreign unit owns a target's globally unique code", async () => {
  await owner("update public.projects set access_mode='restricted' where id=$1", [other]);
  await owner(
    `insert into public.units(building_id,code,unit_no,floor_label,kind)
    values($1,'CIMAC-B17-516','foreign-516','5F','apartment')`,
    [otherBuilding],
  );
  await owner("savepoint collision");
  await expect(initialize()).rejects.toThrow("CimacApartmentsRoomConflict");
  await owner("rollback to savepoint collision");
  expect(await counts()).toEqual({ profiles: 0, rooms: 0, audits: 0 });
  expect((await owner(facts)).rows[0].value).toEqual(originalFacts);
});

it("limits profile reads to authorized app roles within B17 and blocks ordinary direct profile writes", async () => {
  const result = await initialize();
  for (const actor of [finance, secondAdmin]) {
    await login(actor);
    expect(
      (await db.query("select count(*)::integer count from public.cimac_apartment_profiles"))
        .rows[0].count,
    ).toBe(64);
  }
  await login(outsider);
  expect(
    (await db.query("select count(*)::integer count from public.cimac_apartment_profiles")).rows[0]
      .count,
  ).toBe(0);
  await login(desk);
  expect(
    (await db.query("select count(*)::integer count from public.cimac_apartment_profiles")).rows[0]
      .count,
  ).toBe(0);
  await owner("savepoint direct_write");
  await login();
  await expect(
    db.query("update public.cimac_apartment_profiles set monthly_rent_xof=1 where unit_id=$1", [
      result.unitIds[0],
    ]),
  ).rejects.toThrow("permission denied");
  await owner("rollback to savepoint direct_write");
  await owner("savepoint direct_delete");
  await login();
  await expect(
    db.query("delete from public.cimac_apartment_profiles where unit_id=$1", [result.unitIds[0]]),
  ).rejects.toThrow("permission denied");
  await owner("rollback to savepoint direct_delete");
  await owner("savepoint direct_insert");
  await login();
  await expect(
    db.query(
      `insert into public.cimac_apartment_profiles select * from public.cimac_apartment_profiles limit 1`,
    ),
  ).rejects.toThrow("CimacApartmentsProfileDenied");
  await owner("rollback to savepoint direct_insert");
});

it("rejects forged cross-building profiles and noncanonical prices or terms even with a fabricated transaction context", async () => {
  const unit = (
    await owner(
      `insert into public.units(building_id,code,unit_no,floor_label,kind,asset_subtype,layout,construction_status,occupancy_verified)
    values($1,'CIMAC-B17-201','201','2F','apartment','apartment','一室一厅','unverified',false) returning id`,
      [building],
    )
  ).rows[0].id;
  const insert = `insert into public.cimac_apartment_profiles(unit_id,building_id,floor_number,room_suffix,bedrooms,facing,monthly_rent_xof,
    monthly_property_fee_xof,deposit_months,rent_prepay_months,property_prepay_months,source_reference,created_by)
    values($1,$2,2,1,1,'east',$3,30000,2,$4,12,'User-confirmed B17 floors 2-5 room plan and XOF reference terms; 2026-11-02',$5)`;
  for (const [bid, rent, months, error] of [
    [otherBuilding, 350000, 6, "CimacApartmentsProfileDenied"],
    [building, 1, 6, "check constraint"],
    [building, 350000, 1, "check constraint"],
  ]) {
    await owner("savepoint forged");
    await login();
    await db.query("select set_config('app.cimac_apartment_request_id',$1,true)", [randomUUID()]);
    await expect(db.query(insert, [unit, bid, rent, months, admin])).rejects.toThrow(
      error as string,
    );
    await owner("rollback to savepoint forged");
  }
  expect((await counts()).profiles).toBe(0);
});

it("rejects forged initialization audit records outside the real RPC context", async () => {
  await login();
  await expect(
    db.query(
      `insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,metadata)
    values($1,'admin','initialize','cimac_apartment_initialization',$2,jsonb_build_object('project_id',$3::text,'building_id',$4::text))`,
      [admin, randomUUID(), project, building],
    ),
  ).rejects.toThrow("CimacApartmentsAuditDenied");
});
