import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";

let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>;
let db: pg.Client;

beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await installApplicationRebuild(db);
}, 45_000);
afterAll(async () => {
  await cluster?.close();
});

async function login(actor: string | null, client = db) {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: "authenticated" }),
  ]);
  await client.query("set role authenticated");
}

async function seed(status = "checked_in", role = "admin", notes: string | null = null) {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims','{}',false)");
  const actor = randomUUID();
  const project = randomUUID();
  const building = randomUUID();
  const unit = randomUUID();
  const otherUnit = randomUUID();
  const agent = randomUUID();
  const booking = randomUUID();
  await db.query("insert into auth.users(id,email) values($1,$2)", [
    actor,
    `${actor}@test.invalid`,
  ]);
  await db.query(
    "insert into public.user_profiles(id,role,display_name) values($1,$2,'Synthetic')",
    [actor, role],
  );
  await db.query(
    "insert into public.projects(id,code,display_name,allows_daily_rental) values($1::uuid,$1::text,'Synthetic',true)",
    [project],
  );
  await db.query(
    "insert into public.buildings(id,project_id,code,display_name) values($1::uuid,$2,$1::text,'Synthetic')",
    [building, project],
  );
  await db.query(
    `insert into public.units(id,building_id,code,unit_no,floor_label)
     values($1::uuid,$2,$1::text,'Test 1','1'),($3::uuid,$2,$3::text,'Test 2','1')`,
    [unit, building, otherUnit],
  );
  await db.query(
    "insert into public.unit_business_flags(unit_id,business_type,is_enabled) values($1,'daily_rental',true),($2,'daily_rental',true)",
    [unit, otherUnit],
  );
  await db.query("insert into public.customers(id,name) values($1,'Synthetic agent')", [agent]);
  await db.query(
    `insert into public.daily_bookings
      (id,unit_id,customer_id,booking_agent_id,check_in,check_out,nightly_price_xof,total_amount_xof,final_amount_xof,status,notes,updated_at)
     values($1,$2,$3,$3,current_date-2,current_date-1,40000,40000,40000,$4,$5,'2026-01-01 12:34:56.123456+00')`,
    [booking, unit, agent, status, notes],
  );
  await db.query(
    `insert into public.receivables(building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof)
     values($1,$2,$3,'daily_booking',$4,'daily_rental','Synthetic',current_date-2,40000)`,
    [building, unit, agent, booking],
  );
  return { actor, project, unit, otherUnit, booking };
}

async function discount(booking: string, amount: number | null, reason = "Synthetic correction") {
  return (
    await db.query("select public.daily_apply_discount_rpc($1,$2,$3) result", [
      booking,
      amount,
      reason,
    ])
  ).rows[0].result;
}
async function snapshot(booking: string) {
  await db.query("reset role");
  return (
    await db.query("select public.daily_booking_operation_snapshot($1,null) result", [booking])
  ).rows[0].result;
}

it("clears a discount, restores the receivable and preserves payments, dates, room and cleaning", async () => {
  const f = await seed();
  await login(f.actor);
  await db.query(
    "select public.daily_record_payment_rpc($1,20000,current_date,null,$2,'{}'::jsonb)",
    [f.booking, randomUUID()],
  );
  await discount(f.booking, 115);
  const before = await snapshot(f.booking);
  await login(f.actor);
  await discount(f.booking, 0, "Undo mistaken discount");
  const after = await snapshot(f.booking);
  expect(after.booking).toEqual({
    ...before.booking,
    manual_discount_amount_xof: 0,
    manual_discount_reason: "Undo mistaken discount",
    final_amount_xof: 40000,
    updated_at: expect.any(String),
  });
  expect(after.payments).toEqual(before.payments);
  expect(after.cleaningTasks).toEqual(before.cleaningTasks);
  expect(after.unit).toEqual(before.unit);
  expect(after.receivables).toHaveLength(1);
  expect(after.receivables[0]).toMatchObject({ amount_xof: 40000, paid_amount_xof: 20000 });
  const audits = (
    await db.query(
      "select actor_id,before_data,after_data from public.audit_logs where entity_id=$1 and action='apply_discount' order by created_at",
      [f.booking],
    )
  ).rows;
  expect(audits.at(-1)).toMatchObject({
    actor_id: f.actor,
    before_data: { manual_discount_amount_xof: 115, final_amount_xof: 39885 },
    after_data: { manual_discount_amount_xof: 0, final_amount_xof: 40000 },
  });
});

it.each([null, -1, 40001])(
  "rejects invalid discount %s without modifying the order",
  async (amount) => {
    const f = await seed();
    const before = await snapshot(f.booking);
    await login(f.actor);
    await expect(discount(f.booking, amount)).rejects.toThrow();
    expect(await snapshot(f.booking)).toEqual(before);
  },
);

it.each(["confirmed", "checked_out", "cancelled"])(
  "does not clear a discount on a %s order",
  async (status) => {
    const f = await seed(status);
    const before = await snapshot(f.booking);
    await login(f.actor);
    await expect(discount(f.booking, 0)).rejects.toThrow("bookingNotCheckedIn");
    expect(await snapshot(f.booking)).toEqual(before);
  },
);

it("requires a reason and a permitted authenticated role", async () => {
  const f = await seed();
  await login(f.actor);
  await expect(discount(f.booking, 0, " ")).rejects.toThrow("discountReasonRequired");
  await login(null);
  await expect(discount(f.booking, 0)).rejects.toThrow("dailyWritePermissionDenied");
});

it("enforces the existing room/project scope for zero discounts", async () => {
  const f = await seed("checked_in", "front_desk");
  await db.query("update public.projects set access_mode='restricted' where id=$1", [f.project]);
  const before = await snapshot(f.booking);
  await login(f.actor);
  await expect(discount(f.booking, 0)).rejects.toThrow("dailyWritePermissionDenied");
  expect(await snapshot(f.booking)).toEqual(before);
});
