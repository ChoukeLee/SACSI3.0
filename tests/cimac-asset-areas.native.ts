import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";

const membershipMigration = "20261025115930_cimac_customer_profiles_membership_links.sql";
const areaMigration = "20261025115933_cimac_asset_area_profiles_correction.sql";
const admin = randomUUID(),
  finance = randomUUID(),
  outsider = randomUUID();
const project = randomUUID(),
  other = randomUUID(),
  building = randomUUID(),
  otherBuilding = randomUUID();
const warehouse = randomUUID(),
  shop = randomUUID(),
  foreign = randomUUID(),
  customer = randomUUID();
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
let originalFacts: unknown;
const facts = `select jsonb_build_object(
 'contracts',(select jsonb_agg(to_jsonb(t) order by id) from lease_contracts t),
 'payments',(select jsonb_agg(to_jsonb(t) order by id) from payments t),
 'ledger',(select jsonb_agg(to_jsonb(t) order by id) from ledger_entries t),
 'receivables',(select jsonb_agg(to_jsonb(t) order by id) from receivables t),
 'feeRules',(select jsonb_agg(to_jsonb(t) order by id) from property_fee_rules t),
 'customers',(select jsonb_agg(to_jsonb(t) order by id) from customers t)) value`;
async function owner(sql: string, params: unknown[] = []) {
  await db.query("reset role");
  return db.query(sql, params);
}
async function login(actor: string | null = admin) {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: "authenticated" }),
  ]);
  await db.query("set role authenticated");
}
async function row(id = warehouse, area = "545") {
  const current = (await owner("select updated_at::text from units where id=$1", [id])).rows[0];
  return {
    unitId: id,
    expectedUpdatedAt: current.updated_at,
    areaSqm: area,
    sourceReference: "Synthetic latest financial sheet + explicit area authorization",
  };
}
async function sync(rows: unknown[], request = randomUUID(), actor: string | null = admin) {
  await login(actor);
  return (await db.query("select cimac_asset_areas_sync_rpc($1,$2) value", [request, { rows }]))
    .rows[0].value;
}
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  const applied = await installApplicationRebuild(db);
  if (!applied.includes(membershipMigration))
    await db.query(readFileSync(resolve("supabase/migrations", membershipMigration), "utf8"));
  if (!applied.includes(areaMigration))
    await db.query(readFileSync(resolve("supabase/migrations", areaMigration), "utf8"));
  for (const [id, role] of [
    [admin, "admin"],
    [finance, "finance"],
    [outsider, "admin"],
  ]) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [id, `${id}@test.invalid`]);
    await db.query(
      "insert into user_profiles(id,role,display_name) values($1,$2,'Synthetic actor')",
      [id, role],
    );
  }
  await db.query(
    "insert into projects(id,code,display_name,access_mode,allows_long_lease) values($1,'CIMAC','Synthetic park','restricted',true),($2,'OTHER','Synthetic other','open',true)",
    [project, other],
  );
  for (const id of [admin, finance])
    await db.query(
      "insert into project_account_access(project_id,account_email,account_id) values($1,$2,$3)",
      [project, `${id}@test.invalid`, id],
    );
  await db.query(
    "insert into buildings(id,project_id,code,display_name) values($1,$2,'AREA-C','Synthetic park'),($3,$4,'AREA-O','Synthetic other')",
    [building, project, otherBuilding, other],
  );
  for (const [id, bid, no, area] of [
    [warehouse, building, "warehouse", 513],
    [shop, building, "shop", 64],
    [foreign, otherBuilding, "foreign", 88],
  ])
    await db.query(
      "insert into units(id,building_id,code,unit_no,floor_label,kind,status,area_sqm) values($1,$2,$3,$3,'G','storefront','reserved',$4)",
      [id, bid, no, area],
    );
  await db.query(
    "insert into customers(id,name,notes) values($1,'Synthetic warehouse tenant','Original notes')",
    [customer],
  );
  const lease = (
    await db.query(
      "insert into lease_contracts(unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,status) values($1,$2,'AREA-LEASE',current_date,current_date+365,'monthly',1,100,'draft') returning id",
      [warehouse, customer],
    )
  ).rows[0].id;
  await db.query(
    "insert into property_fee_rules(unit_id,monthly_amount_xof,start_date,end_date,notes) values($1,230850,'2027-04-01','2028-03-31','Original warehouse rule; not automatically recalculated')",
    [warehouse],
  );
  const payment = (
    await db.query(
      "insert into payments(customer_id,unit_id,source_type,source_id,payment_date,amount,currency) values($1,$2,'lease_deposit',$3,current_date,10,'XOF') returning id",
      [customer, warehouse, lease],
    )
  ).rows[0].id;
  await db.query(
    "insert into ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,currency) values($1,$2,$3,current_date,'liability_in','lease_deposit',10,'XOF')",
    [building, warehouse, payment],
  );
  await db.query(
    "insert into receivables(building_id,unit_id,customer_id,source_type,category,title,due_date,amount_xof,paid_amount_xof,status,currency) values($1,$2,$3,'lease_contract','lease_rent','Synthetic history',current_date,100,0,'pending','XOF')",
    [building, warehouse, customer],
  );
  originalFacts = (await db.query(facts)).rows[0].value;
}, 45000);
afterAll(async () => {
  await cluster?.close();
});

it("is security invoker, authenticated-only, and requires the real admin plus park ACL", async () => {
  const privileges = (
    await owner(
      "select p.prosecdef,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('service_role',p.oid,'execute') service from pg_proc p where p.oid='cimac_asset_areas_sync_rpc(uuid,jsonb)'::regprocedure",
    )
  ).rows[0];
  expect(privileges).toEqual({ prosecdef: false, anon: false, service: false });
  const input = await row();
  for (const actor of [finance, outsider, null])
    await expect(sync([input], randomUUID(), actor)).rejects.toThrow("CimacCustomerSyncDenied");
});
it("changes only the explicit asset area, records the actual actor and is exactly idempotent", async () => {
  const input = await row(),
    request = randomUUID();
  const old = (await owner("select to_jsonb(u) value from units u where id=$1", [warehouse]))
    .rows[0].value;
  const result = await sync([input], request);
  expect(result).toMatchObject({
    success: true,
    actorId: admin,
    projectId: project,
    requestId: request,
    idempotent: false,
  });
  expect(result.rows[0]).toMatchObject({ unitId: warehouse, areaSqm: 545 });
  expect(await sync([input], request)).toMatchObject({ idempotent: true, rows: result.rows });
  const saved = (await owner("select to_jsonb(u) value from units u where id=$1", [warehouse]))
    .rows[0].value;
  expect({ ...saved, area_sqm: old.area_sqm, updated_at: old.updated_at }).toEqual(old);
  expect((await owner(facts)).rows[0].value).toEqual(originalFacts);
  const audit = (
    await db.query(
      "select actor_id,actor_role,before_data,after_data,metadata from audit_logs where entity_id=$1",
      [request],
    )
  ).rows;
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    actor_id: admin,
    actor_role: "admin",
    metadata: { project_id: project },
  });
  expect(audit[0].before_data[0].area_sqm).toBe(513);
  expect(audit[0].after_data[0].area_sqm).toBe(545);
  await expect(sync([{ ...input, areaSqm: "546" }], request)).rejects.toThrow(
    "CimacAreaSyncRequestConflict",
  );
});
it("rejects foreign assets, invalid area precision, missing keys, extra fields, and duplicate assets", async () => {
  await expect(sync([await row(foreign)])).rejects.toThrow("CimacAreaSyncDenied");
  for (const area of ["0", "-1", "NaN", "Infinity", "5e2", "54.555", "100000000"])
    await expect(sync([await row(warehouse, area)])).rejects.toThrow("CimacAreaSyncInvalid");
  const valid = await row();
  await expect(sync([{ ...valid, payment: 1 }])).rejects.toThrow("CimacCustomerSyncInvalid");
  const { sourceReference: _omitted, ...incomplete } = valid;
  await expect(sync([incomplete])).rejects.toThrow("CimacCustomerSyncInvalid");
  await expect(sync([valid, valid])).rejects.toThrow("CimacAreaSyncInvalid");
});
it("rolls back the complete batch if another asset changed, leaving no success audit", async () => {
  const a = await row(warehouse, "546"),
    b = await row(shop, "65"),
    request = randomUUID();
  await owner("update units set updated_at=clock_timestamp() where id=$1", [shop]);
  const baseline = (await db.query("select jsonb_agg(to_jsonb(u) order by id) value from units u"))
    .rows[0].value;
  await expect(sync([a, b], request)).rejects.toThrow("CimacAreaSyncConflict");
  expect(
    (await owner("select jsonb_agg(to_jsonb(u) order by id) value from units u")).rows[0].value,
  ).toEqual(baseline);
  expect(
    (await db.query("select count(*)::int n from audit_logs where entity_id=$1", [request])).rows[0]
      .n,
  ).toBe(0);
});
