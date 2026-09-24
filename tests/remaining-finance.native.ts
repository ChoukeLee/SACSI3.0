import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import type pg from "pg";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await installApplicationRebuild(db);
  await db.query(
    "create function private.test_reject_write() returns trigger language plpgsql as $$ begin raise exception 'injected_failure'; end $$",
  );
}, 45000);
afterAll(async () => {
  await cluster?.close();
});
async function owner(sql: string, args: unknown[] = []) {
  await db.query("reset role");
  return db.query(sql, args);
}
async function login(actor: string, client = db) {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: "authenticated" }),
  ]);
  await client.query("set role authenticated");
}
async function seed(role = "admin") {
  const actor = randomUUID(),
    project = randomUUID(),
    building = randomUUID(),
    unit = randomUUID(),
    customer = randomUUID();
  await owner("insert into auth.users(id,email) values($1,$2)", [actor, actor + "@test.invalid"]);
  await db.query("insert into user_profiles(id,role,display_name) values($1,$2,'Synthetic')", [
    actor,
    role,
  ]);
  await db.query(
    "insert into projects(id,code,display_name,allows_sale,allows_daily_rental) values($1::uuid,$1::text,'Synthetic',true,true)",
    [project],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name) values($1::uuid,$2,$1::text,'Synthetic')",
    [building, project],
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status) values($1::uuid,$2,$1::text,'408','4','sold')",
    [unit, building],
  );
  await db.query("insert into customers(id,name) values($1,'颖')", [customer]);
  await db.query(
    "insert into unit_business_flags(unit_id,business_type,is_enabled) values($1,'daily_rental',true)",
    [unit],
  );
  await login(actor);
  return { actor, project, building, unit, customer };
}
async function rpc(op: string, input: unknown, id = randomUUID(), client = db) {
  return (await client.query("select public.finance_operation_rpc($1,$2,$3) v", [op, input, id]))
    .rows[0].v;
}
function manual(f: Awaited<ReturnType<typeof seed>>, extra = {}) {
  return {
    buildingId: f.building,
    unitId: f.unit,
    entryDate: "2026-09-24",
    direction: "income",
    category: "other_income",
    amount: 100,
    currency: "XOF",
    exchangeRateToXof: 1,
    receiptNo: "EXTERNAL",
    ...extra,
  };
}
async function counts(f: Awaited<ReturnType<typeof seed>>) {
  return (
    await owner(
      `select
 (select count(*)::int from payments where unit_id=$1) payments,
 (select count(*)::int from ledger_entries where unit_id=$1) ledger,
 (select count(*)::int from receivables where unit_id=$1) receivables,
 (select count(*)::int from private.finance_operation_requests where actor_id=$2) requests`,
      [f.unit, f.actor],
    )
  ).rows[0];
}
async function sale(f: Awaited<ReturnType<typeof seed>>) {
  const id = randomUUID();
  return (
    await owner(
      "insert into sale_contracts(id,unit_id,customer_id,contract_no,signed_date,total_amount_xof,payment_plan_type,status) values($1::uuid,$2,$3,$1::text,'2026-01-01',1000,'flexible_installment','active') returning id,updated_at::text",
      [id, f.unit, f.customer],
    )
  ).rows[0];
}
const flex = (c: any) => ({
  contractId: c.id,
  expectedUpdatedAt: c.updated_at,
  installmentNo: 1,
  dueDate: "2026-09-01",
  amountXof: 100,
});
it("rechecks current role and project access before replaying completed finance operations", async () => {
  const f = await seed(),
    input = manual(f),
    id = randomUUID();
  await rpc("manual_entry", input, id);
  await owner("update user_profiles set role='boss' where id=$1", [f.actor]);
  await login(f.actor);
  await expect(rpc("manual_entry", input, id)).rejects.toThrow("financePermissionDenied");
  await owner("update user_profiles set role='admin' where id=$1", [f.actor]);
  await db.query("update projects set code='CIMAC' where id=$1", [f.project]);
  await login(f.actor);
  try {
    await expect(rpc("manual_entry", input, id)).rejects.toThrow("financeAccessDenied");
  } finally {
    await owner("update projects set code=id::text where id=$1", [f.project]);
  }
});
it("serializes independent sale payments and rejects the overpayment without partial effects", async () => {
  const f = await seed(),
    c = await sale(f);
  await login(f.actor);
  const s = (await rpc("sale_installment", flex(c))).data;
  const clients = await Promise.all([cluster.connect(), cluster.connect()]);
  try {
    for (const client of clients) await login(f.actor, client);
    const results = await Promise.allSettled(
      clients.map((client) =>
        rpc(
          "sale_payment",
          { contractId: c.id, scheduleId: s.id, amount: 70, paymentDate: "2026-09-24" },
          randomUUID(),
          client,
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failure.reason.message).toContain("paymentExceedsOutstanding");
    expect((await counts(f)).payments).toBe(1);
  } finally {
    for (const client of clients) await client.end();
  }
});
const backfill = (f: Awaited<ReturnType<typeof seed>>) => ({
  unitId: f.unit,
  customerId: f.customer,
  checkIn: "2026-01-01",
  checkOut: "2026-01-03",
  nightlyPriceXof: 100,
  prepaidAmountXof: 50,
  reason: "Synthetic backfill",
});

it("backfills historical accounts once without changing current room status and rejects overlap", async () => {
  const f = await seed(),
    input = backfill(f),
    id = randomUUID();
  expect((await rpc("daily_backfill", input, id)).success).toBe(true);
  expect((await rpc("daily_backfill", input, id)).idempotent).toBe(true);
  await expect(rpc("daily_backfill", input)).rejects.toThrow("doubleBooked");
  expect(await counts(f)).toEqual({ payments: 1, ledger: 1, receivables: 1, requests: 1 });
  expect((await db.query("select status from units where id=$1", [f.unit])).rows[0].status).toBe(
    "sold",
  );
  expect(
    (
      await db.query("select amount_xof,paid_amount_xof from receivables where unit_id=$1", [
        f.unit,
      ])
    ).rows[0],
  ).toEqual({ amount_xof: "200.00", paid_amount_xof: "50.00" });
});
it.each(["daily_bookings", "receivables", "payments", "ledger_entries", "audit_logs"])(
  "backfill leaves no partial booking or account when %s fails",
  async (table) => {
    const f = await seed();
    await owner(
      `create trigger reject_backfill before insert on public.${table} for each row execute function private.test_reject_write()`,
    );
    try {
      await login(f.actor);
      await expect(rpc("daily_backfill", backfill(f))).rejects.toThrow("injected_failure");
      expect(await counts(f)).toEqual({ payments: 0, ledger: 0, receivables: 0, requests: 0 });
      expect(
        (await db.query("select count(*)::int n from daily_bookings where unit_id=$1", [f.unit]))
          .rows[0].n,
      ).toBe(0);
    } finally {
      await owner(`drop trigger reject_backfill on public.${table}`);
    }
  },
);
it("rejects a non-agent customer or blacklisted agent in direct database calls", async () => {
  const f = await seed();
  await owner("update customers set is_blacklisted=true where id=$1", [f.customer]);
  await login(f.actor);
  await expect(rpc("daily_backfill", backfill(f))).rejects.toThrow("invalidBookingAgent");
  await owner("update customers set is_blacklisted=false,name='Unknown' where id=$1", [f.customer]);
  await login(f.actor);
  await expect(rpc("daily_backfill", backfill(f))).rejects.toThrow("invalidBookingAgent");
});
it("repairs daily balances atomically and rolls back undo-checkin if audit fails", async () => {
  const f = await seed();
  await rpc("daily_backfill", backfill(f));
  const b = (
    await owner(
      "update daily_bookings set status='checked_in' where unit_id=$1 returning id,updated_at::text",
      [f.unit],
    )
  ).rows[0];
  await db.query("update receivables set paid_amount_xof=0 where source_id=$1", [b.id]);
  await login(f.actor);
  await rpc("daily_sync", { bookingId: b.id });
  expect(
    (await owner("select paid_amount_xof from receivables where source_id=$1", [b.id])).rows[0]
      .paid_amount_xof,
  ).toBe("50.00");
  const current = (
    await db.query("select updated_at::text from daily_bookings where id=$1", [b.id])
  ).rows[0];
  const input = {
    bookingId: b.id,
    expectedUpdatedAt: current.updated_at,
    targetStatus: "available",
  };
  await db.query(
    "create trigger reject_undo before insert on audit_logs for each row execute function private.test_reject_write()",
  );
  try {
    await login(f.actor);
    await expect(rpc("daily_undo_checkin", input)).rejects.toThrow("injected_failure");
    expect(
      (await owner("select status from daily_bookings where id=$1", [b.id])).rows[0].status,
    ).toBe("checked_in");
    expect((await db.query("select status from units where id=$1", [f.unit])).rows[0].status).toBe(
      "sold",
    );
  } finally {
    await owner("drop trigger reject_undo on audit_logs");
  }
  await login(f.actor);
  expect((await rpc("daily_undo_checkin", input)).success).toBe(true);
});
it("transfer updates use version checks and termination audit failure rolls everything back", async () => {
  const f = await seed(),
    c = await sale(f);
  await login(f.actor);
  await rpc("sale_installment", flex(c));
  let current = (await owner("select updated_at::text from sale_contracts where id=$1", [c.id]))
    .rows[0];
  await login(f.actor);
  await rpc("sale_transfer", {
    contractId: c.id,
    expectedUpdatedAt: current.updated_at,
    status: "completed",
    transferDate: "2026-09-20",
  });
  current = (await owner("select updated_at::text from sale_contracts where id=$1", [c.id]))
    .rows[0];
  await db.query(
    "create trigger reject_termination before insert on audit_logs for each row execute function private.test_reject_write()",
  );
  try {
    await login(f.actor);
    await expect(
      rpc("sale_terminate", {
        contractId: c.id,
        expectedUpdatedAt: current.updated_at,
        reason: "Synthetic",
      }),
    ).rejects.toThrow("injected_failure");
    expect(
      (await owner("select status,transfer_status from sale_contracts where id=$1", [c.id]))
        .rows[0],
    ).toEqual({ status: "active", transfer_status: "completed" });
    expect(
      (await db.query("select status from receivables where source_id=$1", [c.id])).rows[0].status,
    ).not.toBe("cancelled");
  } finally {
    await owner("drop trigger reject_termination on audit_logs");
  }
});

it("posts receipt, linked ledger, original currency and authenticated audit in one transaction", async () => {
  const f = await seed(),
    input = manual(f, { currency: "USD", amount: 2, exchangeRateToXof: 600 }),
    id = randomUUID();
  const r = await rpc("manual_entry", input, id);
  expect(r.success).toBe(true);
  expect(r.data.amount_xof).toBe(1200);
  expect(r.data.payment_id).toBeTruthy();
  expect((await rpc("manual_entry", input, id)).idempotent).toBe(true);
  const rows = await owner(
    "select currency,amount,exchange_rate_to_xof,external_receipt_no from payments where id=$1",
    [r.data.payment_id],
  );
  expect(rows.rows[0]).toMatchObject({
    currency: "USD",
    amount: "2.00",
    external_receipt_no: "EXTERNAL",
  });
  expect(
    (await db.query("select actor_id from audit_logs where entity_id=$1", [r.data.id])).rows[0]
      .actor_id,
  ).toBe(f.actor);
  expect(await counts(f)).toEqual({ payments: 1, ledger: 1, receivables: 0, requests: 1 });
});
it.each(["payments", "ledger_entries", "audit_logs", "finance_operation_requests"])(
  "rolls back every manual effect if %s fails",
  async (table) => {
    const f = await seed(),
      id = randomUUID(),
      schema = table === "finance_operation_requests" ? "private" : "public";
    await owner(
      `create trigger reject_manual before insert on ${schema}.${table} for each row execute function private.test_reject_write()`,
    );
    try {
      await login(f.actor);
      await expect(rpc("manual_entry", manual(f), id)).rejects.toThrow("injected_failure");
      expect(await counts(f)).toEqual({ payments: 0, ledger: 0, receivables: 0, requests: 0 });
    } finally {
      await owner(`drop trigger reject_manual on ${schema}.${table}`);
    }
    await login(f.actor);
    expect((await rpc("manual_entry", manual(f), id)).success).toBe(true);
  },
);
it("serializes duplicate manual requests and rejects altered payload and actor", async () => {
  const f = await seed(),
    id = randomUUID(),
    input = manual(f),
    clients = await Promise.all([cluster.connect(), cluster.connect()]);
  try {
    for (const c of clients) await login(f.actor, c);
    const results = await Promise.all(clients.map((c) => rpc("manual_entry", input, id, c)));
    expect(results.filter((r) => r.idempotent)).toHaveLength(1);
  } finally {
    for (const c of clients) await c.end();
  }
  await login(f.actor);
  await expect(rpc("manual_entry", { ...input, amount: 101 }, id)).rejects.toThrow(
    "requestIdConflict",
  );
  const other = await seed();
  await expect(rpc("manual_entry", input, id)).rejects.toThrow("requestIdConflict");
  expect((await counts(f)).payments).toBe(1);
  expect(other.actor).not.toBe(f.actor);
});
it.each([
  { amount: 0 },
  { amount: -1 },
  { amount: "NaN" },
  { exchangeRateToXof: 0 },
  { exchangeRateToXof: 2 },
  { entryDate: "infinity" },
  { direction: "arbitrary" },
])("rejects malformed manual payload %j", async (extra) => {
  const f = await seed();
  await expect(rpc("manual_entry", manual(f, extra))).rejects.toThrow();
  expect((await counts(f)).ledger).toBe(0);
});
it("rejects mismatched building and low-privilege callers", async () => {
  const f = await seed(),
    other = await seed();
  await login(f.actor);
  await expect(rpc("manual_entry", manual(f, { buildingId: other.building }))).rejects.toThrow(
    "unitBuildingMismatch",
  );
  const low = await seed("front_desk");
  await expect(rpc("manual_entry", manual(low))).rejects.toThrow("financePermissionDenied");
});
it("private request table and helpers cannot be called directly by clients", async () => {
  const r = await owner(
    "select has_function_privilege('anon','public.finance_operation_rpc(text,jsonb,uuid)','execute') anon,has_function_privilege('service_role','public.finance_operation_rpc(text,jsonb,uuid)','execute') service,has_function_privilege('authenticated','private.post_sale_payment_core(uuid,uuid,numeric,date,text,uuid)','execute') bypass,has_table_privilege('authenticated','private.finance_operation_requests','select') direct",
  );
  expect(r.rows[0]).toEqual({ anon: false, service: false, bypass: false, direct: false });
});
it("creates one flexible installment and its receivable, rejects stale edits, and replays committed identity", async () => {
  const f = await seed(),
    c = await sale(f),
    input = flex(c),
    id = randomUUID();
  await login(f.actor);
  const r = await rpc("sale_installment", input, id);
  expect(r.data.installment_no).toBe(1);
  expect((await rpc("sale_installment", input, id)).idempotent).toBe(true);
  await expect(rpc("sale_installment", { ...input, installmentNo: 2 })).rejects.toThrow(
    "financeRecordChanged",
  );
  expect((await counts(f)).receivables).toBe(1);
});
it.each(["sale_payment_schedule", "receivables", "audit_logs"])(
  "rolls back installment and receivable when %s fails",
  async (table) => {
    const f = await seed(),
      c = await sale(f);
    await owner(
      `create trigger reject_flex before insert on public.${table} for each row execute function private.test_reject_write()`,
    );
    try {
      await login(f.actor);
      await expect(rpc("sale_installment", flex(c))).rejects.toThrow("injected_failure");
      expect((await counts(f)).receivables).toBe(0);
      expect(
        (
          await db.query(
            "select count(*)::int n from sale_payment_schedule where sale_contract_id=$1",
            [c.id],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await owner(`drop trigger reject_flex on public.${table}`);
    }
  },
);
it("sale payment uses actor-bound replay, partial balances, and rejects payload substitution", async () => {
  const f = await seed(),
    c = await sale(f);
  await login(f.actor);
  const s = (await rpc("sale_installment", flex(c))).data;
  const id = randomUUID();
  const pay = () =>
    db.query("select public.record_sale_payment_rpc($1,$2,40,$3,null,$4) v", [
      c.id,
      s.id,
      "2026-09-24",
      id,
    ]);
  expect((await pay()).rows[0].v.success).toBe(true);
  expect((await pay()).rows[0].v.idempotent).toBe(true);
  await expect(
    db.query("select public.record_sale_payment_rpc($1,$2,41,$3,null,$4)", [
      c.id,
      s.id,
      "2026-09-24",
      id,
    ]),
  ).rejects.toThrow("requestIdConflict");
  expect((await counts(f)).payments).toBe(1);
});
it("terminates atomically without erasing receipts or already-paid receivables", async () => {
  const f = await seed(),
    c = await sale(f);
  await login(f.actor);
  const s = (await rpc("sale_installment", flex(c))).data;
  await db.query("select public.record_sale_payment_rpc($1,$2,100,$3,null,$4)", [
    c.id,
    s.id,
    "2026-09-24",
    randomUUID(),
  ]);
  const current = (await owner("select updated_at::text from sale_contracts where id=$1", [c.id]))
    .rows[0];
  await login(f.actor);
  expect(
    (
      await rpc("sale_terminate", {
        contractId: c.id,
        expectedUpdatedAt: current.updated_at,
        reason: "Synthetic test",
      })
    ).success,
  ).toBe(true);
  expect((await counts(f)).payments).toBe(1);
  expect(
    (await db.query("select status from receivables where source_id=$1", [c.id])).rows[0].status,
  ).toBe("paid");
});
