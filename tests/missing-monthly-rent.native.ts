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
}, 60000);
afterAll(async () => {
  await cluster?.close();
});
async function owner() {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims','{}',false)");
}
async function login(id: string, role = "authenticated", client = db) {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, role }),
  ]);
  await client.query("set role authenticated");
}
async function seed(role = "admin", restricted = false) {
  await owner();
  const f = {
    actor: randomUUID(),
    project: randomUUID(),
    building: randomUUID(),
    unit: randomUUID(),
    customer: randomUUID(),
    contract: randomUUID(),
    oldBill: randomUUID(),
  };
  await db.query("insert into auth.users(id,email) values($1,$2)", [
    f.actor,
    f.actor + "@test.invalid",
  ]);
  await db.query("insert into user_profiles(id,role,display_name) values($1,$2,'Synthetic')", [
    f.actor,
    role,
  ]);
  await db.query(
    "insert into projects(id,code,display_name,access_mode,allows_long_lease) values($1::uuid,$1::text,'Synthetic',$2,true)",
    [f.project, restricted ? "restricted" : "open"],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name) values($1::uuid,$2,$1::text,'Synthetic')",
    [f.building, f.project],
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status) values($1::uuid,$2,$1::text,'TEST','G','leased')",
    [f.unit, f.building],
  );
  await db.query("insert into customers(id,name) values($1,'Synthetic tenant')", [f.customer]);
  await db.query(
    "insert into lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,expected_end_confirmed,payment_cycle,payment_day,monthly_rent_xof,deposit_amount_xof,status,commencement_state,paid_through_date) values($1::uuid,$2,$3,$1::text,'2026-06-27','2027-06-26',false,'monthly',27,700000,0,'active','started','2026-07-31')",
    [f.contract, f.unit, f.customer],
  );
  await db.query(
    "insert into receivables(id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,status) values($1,$2,$3,$4,'lease_contract',$5,'lease_rent','Old August debt','2026-08-01',700000,0,'overdue')",
    [f.oldBill, f.building, f.unit, f.customer, f.contract],
  );
  await login(f.actor);
  return f;
}
async function review(contract: string, client = db) {
  return (await client.query("select public.missing_rent_collection_review_rpc($1) v", [contract]))
    .rows[0].v;
}
async function payload(f: Awaited<ReturnType<typeof seed>>) {
  return {
    expectedToken: (await review(f.contract)).token,
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    amountXof: 700000,
    paymentDate: "2026-10-02",
    paymentMethod: "cash",
    reason:
      "Synthetic explicit October payment. Prior August/September facts require independent review.",
    inputSource: "natural_language",
  };
}
async function execute(contract: string, input: unknown, id = randomUUID(), client = db) {
  return (
    await client.query("select public.collect_missing_monthly_rent_rpc($1,$2,$3) v", [
      contract,
      input,
      id,
    ])
  ).rows[0].v;
}
async function status(id: string, client = db) {
  return (await client.query("select public.missing_rent_collection_status_rpc($1) v", [id]))
    .rows[0].v;
}

it("atomically creates and settles only the explicit missing month, preserving old debt and historical coverage", async () => {
  const f = await seed(),
    original = await review(f.contract),
    input = await payload(f),
    id = randomUUID();
  const result = await execute(f.contract, input, id);
  expect(result).toMatchObject({
    status: "completed",
    requestId: id,
    actorId: f.actor,
    contractId: f.contract,
    amountXof: 700000,
    paidThroughDate: "2026-07-31",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
  });
  const s = await status(id);
  expect(s.currentReceivable).toMatchObject({
    status: "paid",
    amount_xof: 700000,
    paid_amount_xof: 700000,
    service_period_start: "2026-10-01",
    service_period_end: "2026-10-31",
    service_period_confirmed_by: f.actor,
  });
  expect(s.currentPayments).toHaveLength(1);
  expect(s.currentPayments[0]).toMatchObject({
    amount: 700000,
    currency: "XOF",
    payment_date: "2026-10-02",
    payment_method: "cash",
    recorded_by: f.actor,
    actual_collector: null,
  });
  const after = await review(f.contract);
  expect(after.contract).toEqual(original.contract);
  expect(after.receivables.find((r: { id: string }) => r.id === f.oldBill)).toEqual(
    original.receivables[0],
  );
  expect(after.payments).toHaveLength(1);
  expect((await execute(f.contract, input, id)).idempotent).toBe(true);
  expect((await review(f.contract)).payments).toHaveLength(1);
  await expect(execute(f.contract, { ...input, paymentMethod: "check" }, id)).rejects.toThrow(
    "requestIdConflict",
  );
});
it.each(["finance", "rental_sales", "boss"])("rejects non-admin role %s", async (role) => {
  const f = await seed(role);
  await expect(review(f.contract)).rejects.toThrow("missingRentPermissionDenied");
});
it("rejects service-role claims even with an admin profile", async () => {
  const f = await seed();
  await login(f.actor, "service_role");
  await expect(review(f.contract)).rejects.toThrow("missingRentPermissionDenied");
});
it("rechecks scope, protocol disablement, and actor on replay", async () => {
  const f = await seed(),
    input = await payload(f),
    id = randomUUID();
  await execute(f.contract, input, id);
  await owner();
  await db.query("update private.missing_rent_collection_protocol set enabled=false");
  await login(f.actor);
  await expect(status(id)).rejects.toThrow("missingRentPermissionDenied");
  await owner();
  await db.query("update private.missing_rent_collection_protocol set enabled=true");
  const other = await seed();
  await expect(status(id)).rejects.toThrow("missingRentPermissionDenied");
  await expect(execute(f.contract, input, id)).rejects.toThrow("requestIdConflict");
  await owner();
  await db.query("update projects set access_mode='restricted' where id=$1", [f.project]);
  await login(f.actor);
  await expect(status(id)).rejects.toThrow("missingRentPermissionDenied");
  expect(other.actor).not.toBe(f.actor);
});
it.each([
  { periodStart: "2026-10-02" },
  { periodEnd: "2026-11-01" },
  { periodEnd: "2026-10-32" },
  { amountXof: 0 },
  { amountXof: -1 },
  { amountXof: 700000.5 },
  { amountXof: 600000 },
  { paymentMethod: "offset" },
  { paymentDate: "2099-01-01" },
  { currency: "USD" },
  { actualCollector: "guessed" },
  { coverage: { throughDate: "2026-10-31" } },
  { reason: "" },
])("rejects invalid/unsupported input without creating bills or money: %j", async (patch) => {
  const f = await seed(),
    input = await payload(f),
    before = await review(f.contract);
  await expect(execute(f.contract, { ...input, ...patch })).rejects.toThrow();
  expect(await review(f.contract)).toEqual(before);
});
it("rejects stale snapshots", async () => {
  const f = await seed(),
    input = await payload(f);
  await owner();
  await db.query("update lease_contracts set signer_name='Changed' where id=$1", [f.contract]);
  await login(f.actor);
  await expect(execute(f.contract, input)).rejects.toThrow("missingRentSnapshotChanged");
});
it.each(["pending", "paid", "cancelled"])(
  "rejects an existing October bill (%s), even one lacking period evidence",
  async (s) => {
    const f = await seed();
    await owner();
    await db.query(
      "insert into receivables(building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,status) values($1,$2,$3,'lease_contract',$4,'lease_rent','Existing','2026-10-27',700000,$5,$6)",
      [f.building, f.unit, f.customer, f.contract, s === "paid" ? 700000 : 0, s],
    );
    await login(f.actor);
    const input = await payload(f),
      before = await review(f.contract);
    await expect(execute(f.contract, input)).rejects.toThrow(
      "missingRentExistingBillRequiresReview",
    );
    expect(await review(f.contract)).toEqual(before);
  },
);
it("rejects an overlapping period with a due date outside October", async () => {
  const f = await seed();
  await owner();
  await db.query(
    "update receivables set service_period_start='2026-08-01',service_period_end='2026-10-31',service_period_source='Synthetic overlap' where id=$1",
    [f.oldBill],
  );
  await login(f.actor);
  await expect(execute(f.contract, await payload(f))).rejects.toThrow(
    "missingRentExistingBillRequiresReview",
  );
});
it("rejects an existing same-date rent payment, avoiding unallocated duplicates", async () => {
  const f = await seed();
  await owner();
  await db.query(
    "insert into payments(unit_id,customer_id,source_id,source_type,payment_date,amount,currency,exchange_rate_to_xof) values($1,$2,$3,'lease_rent','2026-10-02',700000,'XOF',1)",
    [f.unit, f.customer, f.contract],
  );
  await login(f.actor);
  await expect(execute(f.contract, await payload(f))).rejects.toThrow(
    "missingRentExistingPaymentRequiresReview",
  );
});
it("rolls back the new receivable when downstream payment fails", async () => {
  const f = await seed(),
    input = await payload(f);
  await owner();
  await db.query(
    "create function public.test_missing_rent_abort() returns trigger language plpgsql as $$ begin raise exception 'syntheticPaymentFailure'; end; $$; create trigger test_missing_rent_abort before insert on payments for each row execute function public.test_missing_rent_abort()",
  );
  await login(f.actor);
  const before = await review(f.contract);
  try {
    await expect(execute(f.contract, input)).rejects.toThrow("syntheticPaymentFailure");
    expect(await review(f.contract)).toEqual(before);
  } finally {
    await owner();
    await db.query(
      "drop trigger test_missing_rent_abort on payments; drop function public.test_missing_rent_abort()",
    );
  }
});
it("serializes concurrent requests for the same missing period", async () => {
  const f = await seed(),
    input = await payload(f),
    other = await cluster.connect();
  await login(f.actor, "authenticated", other);
  const results = await Promise.allSettled([
    execute(f.contract, input, randomUUID()),
    execute(f.contract, input, randomUUID(), other),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await review(f.contract)).payments).toHaveLength(1);
  await other.end();
});
