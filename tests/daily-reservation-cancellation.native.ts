import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { applicationMigrationSql, installApplicationRebuild } from "./helpers/application-rebuild";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";

const migration = "20261111084851_repair_daily_reservation_cancellation.sql";
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>;
let db: pg.Client;
let baselineFixture: Awaited<ReturnType<typeof seed>>;
let baselineFailure: unknown;
let baselineState: Awaited<ReturnType<typeof state>>;

beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await installApplicationRebuild(db, { beforeMigration: migration });
  baselineFixture = await seed({ role: "front_desk", status: "confirmed" });
  const before = await state(baselineFixture);
  await login(baselineFixture.actor);
  try {
    await cancel(baselineFixture);
  } catch (error) {
    baselineFailure = error;
  }
  baselineState = await state(baselineFixture);
  expect(baselineState).toEqual(before);
  await db.query(applicationMigrationSql(migration));
}, 45_000);
afterAll(async () => {
  await cluster?.close();
});

async function login(actor: string | null) {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: "authenticated", email: `${actor}@test.invalid` }),
  ]);
  await db.query("set role authenticated");
}

async function seed({
  role = "admin",
  status = "confirmed",
  unitStatus = "reserved",
  condition = "normal",
}: { role?: string; status?: string; unitStatus?: string; condition?: string } = {}) {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims','{}',false)");
  const actor = randomUUID();
  const project = randomUUID();
  const building = randomUUID();
  const unit = randomUUID();
  const customer = randomUUID();
  const booking = randomUUID();
  const receivable = randomUUID();
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
    "insert into public.units(id,building_id,code,unit_no,floor_label,status,operational_condition) values($1::uuid,$2,$1::text,'901','9F',$3,$4)",
    [unit, building, unitStatus, condition],
  );
  await db.query(
    "insert into public.unit_business_flags(unit_id,business_type,is_enabled) values($1,'daily_rental',true)",
    [unit],
  );
  await db.query("insert into public.customers(id,name) values($1,'Synthetic customer')", [
    customer,
  ]);
  await db.query(
    `insert into public.daily_bookings
      (id,unit_id,customer_id,booking_agent_id,check_in,check_out,nightly_price_xof,total_amount_xof,final_amount_xof,status,notes)
     values($1,$2,$3,$3,current_date,current_date+2,40000,80000,80000,$4,'Keep this reservation note')`,
    [booking, unit, customer, status],
  );
  await db.query(
    `insert into public.receivables
      (id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof)
     values($1,$2,$3,$4,'daily_booking',$5,'daily_rental','Synthetic daily rent',current_date,80000)`,
    [receivable, building, unit, customer, booking],
  );
  return { actor, project, building, unit, customer, booking, receivable };
}

type Fixture = Awaited<ReturnType<typeof seed>>;

async function cancel(fixture: Fixture) {
  return (
    await db.query(
      "select public.daily_cancel_booking_rpc($1,jsonb_build_object('channel','sacsi_web')) result",
      [fixture.booking],
    )
  ).rows[0].result;
}

async function state(fixture: Fixture) {
  await db.query("reset role");
  return (
    await db.query(
      `select to_jsonb(b) booking,to_jsonb(u) unit,to_jsonb(r) receivable,
        coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.cleaning_tasks c where c.unit_id=u.id),'[]') cleaning,
        coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.payments p where p.source_type='daily_booking' and p.source_id=b.id),'[]') payments,
        coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.ledger_entries l join public.payments p on p.id=l.payment_id
          where p.source_type='daily_booking' and p.source_id=b.id),'[]') ledger,
        coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.audit_logs a where a.entity_type='daily_booking' and a.entity_id=b.id),'[]') audit
       from public.daily_bookings b
       join public.units u on u.id=b.unit_id
       join public.receivables r on r.id=$2
       where b.id=$1`,
      [fixture.booking, fixture.receivable],
    )
  ).rows[0];
}

async function seedPayment(fixture: Fixture, amount: number, reversalOf: string | null = null) {
  const id = randomUUID();
  await db.query(
    `insert into public.payments
      (id,unit_id,customer_id,source_type,source_id,payment_date,amount,payment_method,request_id,request_kind,reversal_of_payment_id)
     values($1,$2,$3,'daily_booking',$4,current_date,$5,'cash',$6,$7,$8)`,
    [
      id,
      fixture.unit,
      fixture.customer,
      fixture.booking,
      amount,
      randomUUID(),
      reversalOf ? "daily_reversal" : "daily_payment",
      reversalOf,
    ],
  );
  await db.query(
    `insert into public.ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof)
     values($1,$2,$3,current_date,$4,'daily_rental',$5)`,
    [fixture.building, fixture.unit, id, amount < 0 ? "expense" : "income", Math.abs(amount)],
  );
  return id;
}

it("repairs the captured baseline denial for the same front desk account and order", async () => {
  expect(baselineFailure).toMatchObject({ message: "dailyCancelPermissionDenied", code: "42501" });
  expect(baselineState).toMatchObject({
    booking: { status: "confirmed" },
    unit: { status: "reserved" },
    receivable: { status: "pending" },
    audit: [],
  });
  await login(baselineFixture.actor);
  const result = await cancel(baselineFixture);
  expect(result).toMatchObject({ booking: { id: baselineFixture.booking, status: "cancelled" } });
  const after = await state(baselineFixture);
  expect(after).toMatchObject({
    booking: {
      status: "cancelled",
      prepaid_amount_xof: 0,
      final_amount_xof: 80000,
      notes: "Keep this reservation note",
    },
    unit: { status: "available", operational_condition: "normal" },
    receivable: { status: "cancelled", amount_xof: 80000, paid_amount_xof: 0 },
    cleaning: [],
    payments: [],
    ledger: [],
    audit: [
      {
        actor_id: baselineFixture.actor,
        action: "cancel",
        metadata: { channel: "sacsi_web", next_status: "available" },
      },
    ],
  });
});

it.each([
  ["admin", "confirmed"],
  ["rental_sales", "pending_review"],
])("lets %s cancel an unpaid %s reservation", async (role, status) => {
  const f = await seed({ role, status });
  await login(f.actor);
  await cancel(f);
  expect(await state(f)).toMatchObject({
    booking: { status: "cancelled" },
    receivable: { status: "cancelled" },
    audit: [{ actor_id: f.actor, action: "cancel" }],
  });
});

it.each(["recorded payment", "cached prepaid amount"])(
  "blocks cancellation when the order has a nonzero %s",
  async (paymentCase) => {
    const f = await seed({ role: "front_desk" });
    if (paymentCase === "recorded payment") {
      await seedPayment(f, 40000);
    } else {
      await db.query("update public.daily_bookings set prepaid_amount_xof=40000 where id=$1", [
        f.booking,
      ]);
    }
    const before = await state(f);
    await login(f.actor);
    await expect(cancel(f)).rejects.toThrow("bookingHasPayments");
    expect(await state(f)).toEqual(before);
  },
);

it("preserves a fully reversed payment and its ledger while cancelling the zero-balance reservation", async () => {
  const f = await seed({ role: "rental_sales" });
  const original = await seedPayment(f, 40000);
  await seedPayment(f, -40000, original);
  const before = await state(f);
  await login(f.actor);
  await cancel(f);
  const after = await state(f);
  expect(after).toMatchObject({
    booking: { status: "cancelled" },
    receivable: { status: "cancelled" },
    audit: [{ actor_id: f.actor, action: "cancel" }],
  });
  expect(after.payments).toEqual(before.payments);
  expect(after.ledger).toEqual(before.ledger);
});

it.each(["boss", "finance"])("denies the read-only %s role", async (role) => {
  const f = await seed({ role });
  const before = await state(f);
  await login(f.actor);
  await expect(cancel(f)).rejects.toThrow("dailyCancelPermissionDenied");
  expect(await state(f)).toEqual(before);
});

it("denies an unauthenticated call and an account outside the order's project", async () => {
  const f = await seed({ role: "front_desk" });
  await db.query("update public.projects set access_mode='restricted' where id=$1", [f.project]);
  const before = await state(f);
  await login(null);
  await expect(cancel(f)).rejects.toThrow("dailyCancelPermissionDenied");
  await login(f.actor);
  await expect(cancel(f)).rejects.toThrow("bookingNotFound");
  expect(await state(f)).toEqual(before);
});

it.each(["front_desk", "rental_sales"])(
  "prevents %s from bypassing cancellation safeguards through a table update",
  async (role) => {
    const f = await seed({ role });
    const before = await state(f);
    await login(f.actor);
    await expect(
      db.query("update public.daily_bookings set status='cancelled' where id=$1", [f.booking]),
    ).rejects.toThrow("dailyCancelPermissionDenied");
    expect(await state(f)).toEqual(before);
  },
);

it("keeps an actual check-in outside the ordinary reservation cancellation flow", async () => {
  const f = await seed({ role: "front_desk", status: "checked_in", unitStatus: "daily_occupied" });
  const before = await state(f);
  await login(f.actor);
  await expect(cancel(f)).rejects.toThrow("bookingCannotBeCancelled");
  await expect(
    db.query("select public.daily_void_erroneous_checkin_rpc($1,'Synthetic correction')", [
      f.booking,
    ]),
  ).rejects.toThrow("dailyCancelPermissionDenied");
  expect(await state(f)).toEqual(before);
});

it.each([
  ["maintenance", "maintenance"],
  ["locked", "locked"],
  ["sold", "normal"],
])("preserves a %s room and its %s operational condition", async (unitStatus, condition) => {
  const f = await seed({ role: "rental_sales", unitStatus, condition });
  await login(f.actor);
  await cancel(f);
  expect(await state(f)).toMatchObject({
    booking: { status: "cancelled" },
    unit: { status: unitStatus, operational_condition: condition },
    audit: [{ metadata: { next_status: unitStatus } }],
  });
});

it("keeps pending cleaning and cancels only the reservation's receivable", async () => {
  const f = await seed({ role: "front_desk", unitStatus: "cleaning_pending" });
  await db.query("insert into public.cleaning_tasks(unit_id,is_completed) values($1,false)", [
    f.unit,
  ]);
  const before = await state(f);
  await login(f.actor);
  await cancel(f);
  const after = await state(f);
  expect(after).toMatchObject({
    booking: { status: "cancelled" },
    unit: { status: "cleaning_pending" },
    receivable: { status: "cancelled" },
    audit: [{ metadata: { next_status: "cleaning_pending" } }],
  });
  expect(after.cleaning).toEqual(before.cleaning);
});
