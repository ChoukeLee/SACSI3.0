import { randomUUID } from "node:crypto";
import type pg from "pg";
import { beforeAll, afterAll, it, expect } from "vitest";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await installApplicationRebuild(db);
  expect(
    (
      await db.query(
        "select to_regprocedure('public.operator_task_inbox_page_rpc(jsonb,integer)') value",
      )
    ).rows[0].value,
  ).not.toBeNull();
}, 45000);
afterAll(async () => {
  await cluster?.close();
});
async function owner(sql: string, args: unknown[] = []) {
  await db.query("reset role");
  return db.query(sql, args);
}
async function login(actor: string, role = "authenticated") {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role }),
  ]);
  await db.query(`set role ${role}`);
}
async function actor(role = "admin") {
  const id = randomUUID();
  await owner("insert into auth.users(id,email) values($1,$2)", [id, `${id}@test.invalid`]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,$2,'Synthetic inbox actor')",
    [id, role],
  );
  return id;
}
async function fixture() {
  const f = {
    actor: await actor(),
    project: randomUUID(),
    building: randomUUID(),
    unit: randomUUID(),
    customer: randomUUID(),
    booking: randomUUID(),
  };
  await owner(
    "insert into projects(id,code,display_name,allows_daily_rental) values($1::uuid,$1::text,'Synthetic inbox project',true)",
    [f.project],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name) values($1::uuid,$2,$1::text,'Synthetic inbox building')",
    [f.building, f.project],
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status) values($1::uuid,$2,$1::text,'408','4','available')",
    [f.unit, f.building],
  );
  await db.query("insert into customers(id,name) values($1,'Synthetic inbox agent')", [f.customer]);
  await db.query(
    "insert into unit_business_flags(unit_id,business_type,is_enabled,default_price_xof) values($1,'daily_rental',true,10000)",
    [f.unit],
  );
  await db.query(
    "insert into daily_bookings(id,unit_id,customer_id,check_in,check_out,checkout_mode,nightly_price_xof,total_amount_xof,prepaid_amount_xof,status) values($1,$2,$3,'2026-10-01','2026-10-03','fixed',10000,20000,0,'confirmed')",
    [f.booking, f.unit, f.customer],
  );
  return f;
}
type F = Awaited<ReturnType<typeof fixture>>;
async function insert(
  f: F,
  kind = "confirmations",
  status = "pending",
  expired = false,
  request = randomUUID(),
  created = "2026-10-10T12:00:00Z",
) {
  const id = randomUUID(),
    expiry = expired ? "2000-01-01T00:00:00Z" : "2090-01-01T00:00:00Z";
  await owner("select 1");
  if (kind === "confirmations")
    await db.query(
      "insert into private.operator_payment_confirmations(id,actor_id,request_id,booking_id,request_data,expected_snapshot,expires_at,created_at,status,confirmed_at) values($1,$2,$3,$4,'{}','{}',$5,$6,$7,case when $7='completed' then now() else null end)",
      [id, f.actor, request, f.booking, expiry, created, status],
    );
  if (kind === "collections")
    await db.query(
      "insert into private.operator_collection_batches(id,actor_id,request_id,request_data,expected_snapshot,deployment,expires_at,created_at,status) values($1,$2,$3,'{}',$4,'synthetic',$5,$6,$7)",
      [id, f.actor, request, JSON.stringify([{ unit: { id: f.unit } }]), expiry, created, status],
    );
  if (kind === "daily-workflows")
    await db.query(
      "insert into private.operator_daily_workflows(id,actor_id,request_id,booking_id,request_data,expected_snapshot,deployment,expires_at,created_at,status) values($1,$2,$3,$4,'{}','{}','synthetic',$5,$6,$7)",
      [id, f.actor, request, f.booking, expiry, created, status],
    );
  if (kind === "booking-operations")
    await db.query(
      "insert into private.operator_booking_operations(id,actor_id,request_id,unit_id,request_data,expected_snapshot,deployment,expires_at,created_at,status) values($1,$2,$3,$4,$5,'{}','synthetic',$6,$7,$8)",
      [
        id,
        f.actor,
        request,
        f.unit,
        JSON.stringify({ operation: "check_in", bookingId: f.booking }),
        expiry,
        created,
        status,
      ],
    );
  return { id, request };
}
async function read(filters: Record<string, string> = {}, page = 1) {
  return (
    await db.query("select public.operator_task_inbox_page_rpc($1,$2) value", [filters, page])
  ).rows[0].value;
}
it("pages the complete own scope beyond100, filters exactly and never calls a completed record expired", async () => {
  const f = await fixture();
  for (let i = 0; i < 105; i++) await insert(f);
  const done = await insert(f, "confirmations", "completed", true);
  await insert(f, "confirmations", "pending", true);
  await insert(f, "collections", "superseded");
  await insert(f, "daily-workflows");
  await insert(f, "booking-operations");
  await login(f.actor);
  const first = await read();
  expect(first.counts).toEqual({
    all: 110,
    pending: 107,
    completed: 1,
    expired: 1,
    superseded: 1,
    unknown: 0,
  });
  expect(first.total).toBe(110);
  expect(first.items).toHaveLength(30);
  const all = [];
  for (let page = 1; page <= 4; page++) {
    const batch = await read({}, page);
    all.push(...batch.items);
  }
  expect(all).toHaveLength(110);
  expect(new Set(all.map((item: { id: string }) => item.id)).size).toBe(110);
  const completed = await read({ state: "completed" });
  expect(completed.items[0]).toMatchObject({
    id: done.id,
    state: "completed",
    sourceStatus: "completed",
  });
  expect(completed.total).toBe(1);
  const search = await read({
    search: done.request,
    kind: "confirmations",
    dateFrom: "2026-10-10",
    dateTo: "2026-10-10",
  });
  expect(search.total).toBe(1);
  expect(search.items[0].id).toBe(done.id);
  expect((await read({ dateTo: "2026-10-09" })).total).toBe(0);
  expect(
    (await db.query("select public.operator_task_inbox() value")).rows[0].value.items,
  ).toHaveLength(100);
});
it("never reveals somebody else's confirmation, even to an administrator", async () => {
  const a = await fixture(),
    b = await fixture();
  const own = await insert(a),
    other = await insert(b);
  await login(a.actor);
  expect((await read({ search: other.request })).total).toBe(0);
  expect((await read({ search: own.request })).total).toBe(1);
  await login(b.actor);
  expect((await read({ search: own.request })).total).toBe(0);
});
it("rechecks role and project access without exposing the private source tables", async () => {
  const f = await fixture();
  await insert(f);
  await login(f.actor);
  expect((await read()).total).toBe(1);
  await owner("update projects set access_mode='restricted' where id=$1", [f.project]);
  await login(f.actor);
  expect((await read()).total).toBe(0);
  await owner("update projects set access_mode='open' where id=$1", [f.project]);
  await owner("update user_profiles set role='boss' where id=$1", [f.actor]);
  await login(f.actor);
  expect((await read()).total).toBe(0);
  await expect(db.query("select * from private.operator_payment_confirmations")).rejects.toThrow(
    "permission denied",
  );
});
it.each([
  { actorId: randomUUID() },
  { state: "executing" },
  { kind: "someone-else" },
  { search: "%" },
  { dateFrom: "2026-02-30" },
  { dateFrom: "2026-10-20", dateTo: "2026-10-01" },
])("rejects invalid/identity-expanding input %j", async (filters) => {
  const f = await fixture();
  await login(f.actor);
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters))
    if (typeof value === "string") query[key] = value;
  await expect(read(query)).rejects.toThrow();
});
it("denies anonymous/service RPC execution and keeps the public wrapper invoker", async () => {
  const r = (
    await owner(
      "select prosecdef,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('service_role',oid,'execute') service from pg_proc where oid='public.operator_task_inbox_page_rpc(jsonb,integer)'::regprocedure",
    )
  ).rows[0];
  expect(r).toEqual({ prosecdef: false, anon: false, service: false });
});
