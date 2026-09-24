import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import type pg from "pg";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { checkNativeAdvisors } from "./helpers/native-advisors";
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await installApplicationRebuild(db);
  if (process.env.SACSI_LEASE_ADVISORS === "1") await checkNativeAdvisors(db, cluster.port);
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
  await owner(`insert into auth.users(id,email) values($1,$2)`, [actor, actor + "@test.invalid"]);
  await db.query(`insert into user_profiles(id,role,display_name) values($1,$2,'Synthetic')`, [
    actor,
    role,
  ]);
  await db.query(
    `insert into projects(id,code,display_name,allows_long_lease) values($1::uuid,$1::text,'Synthetic',true)`,
    [project],
  );
  await db.query(
    `insert into buildings(id,project_id,code,display_name) values($1::uuid,$2,$1::text,'Synthetic')`,
    [building, project],
  );
  await db.query(
    `insert into units(id,building_id,code,unit_no,floor_label,status) values($1::uuid,$2,$1::text,'408','4','available')`,
    [unit, building],
  );
  await db.query(`insert into customers(id,name) values($1,'Synthetic customer')`, [customer]);
  await login(actor);
  return { actor, unit, customer };
}
function payload(f: Awaited<ReturnType<typeof seed>>, extra: Record<string, unknown> = {}) {
  return {
    unitId: f.unit,
    customerId: f.customer,
    startDate: "2026-01-01",
    expectedEndDate: "2026-03-31",
    paymentCycle: "monthly",
    paymentDay: 31,
    monthlyRentXof: 600000,
    depositAmountXof: 1200000,
    depositReceived: false,
    rentFreeDays: 0,
    status: "draft",
    ...extra,
  };
}
async function rpc(operation: string, input: unknown, id = randomUUID(), client = db) {
  return (
    await client.query("select public.lease_lifecycle_rpc($1,$2,$3) v", [operation, input, id])
  ).rows[0].v;
}
async function create(f: Awaited<ReturnType<typeof seed>>, extra: Record<string, unknown> = {}) {
  return (await rpc("create", payload(f, extra))).data;
}
function change(c: any) {
  return { contractId: c.id, expectedUpdatedAt: c.updated_at };
}
function moveout(c: any, extra: Record<string, unknown> = {}) {
  return {
    ...change(c),
    actualEndDate: "2026-03-31",
    unpaidRentXof: 0,
    depositDeductionXof: 0,
    depositRefundXof: 0,
    utilityCleared: true,
    rentCollectedConfirmed: true,
    paymentMethod: "cash",
    ...extra,
  };
}
async function counts(f: Awaited<ReturnType<typeof seed>>) {
  return (
    await owner(
      `select
 (select count(*)::int from lease_contracts where unit_id=$1) contracts,
 (select count(*)::int from payments where unit_id=$1) payments,
 (select count(*)::int from ledger_entries where unit_id=$1) ledger,
 (select count(*)::int from receivables where unit_id=$1) receivables,
 (select count(*)::int from lease_settlements where unit_id=$1) settlements,
 (select status from units where id=$1) status`,
      [f.unit],
    )
  ).rows[0];
}

it("creates contract, calendar-clamped schedule, deposit receipt, ledger and authenticated audit atomically", async () => {
  const f = await seed(),
    input = payload(f, { status: "active", depositReceived: true }),
    id = randomUUID();
  const result = await rpc("create", input, id);
  expect(result.success).toBe(true);
  expect((await rpc("create", input, id)).idempotent).toBe(true);
  expect(await counts(f)).toEqual({
    contracts: 1,
    payments: 1,
    ledger: 1,
    receivables: 4,
    settlements: 0,
    status: "leased",
  });
  expect(
    (
      await db.query(
        "select due_date::text from receivables where source_id=$1 and category='lease_rent' order by due_date",
        [result.data.id],
      )
    ).rows.map((r) => r.due_date),
  ).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  const audit = (
    await db.query(
      "select actor_id,metadata from audit_logs where entity_id=$1 and action='create'",
      [result.data.id],
    )
  ).rows[0];
  expect(audit.actor_id).toBe(f.actor);
  expect(audit.metadata.request_id).toBe(id);
  await login(f.actor);
  await expect(rpc("create", { ...input, monthlyRentXof: 1 }, id)).rejects.toThrow(
    "requestIdConflict",
  );
});
it("serializes competing active contracts and duplicate requests across database connections", async () => {
  const f = await seed(),
    input = payload(f, { status: "active", depositReceived: true }),
    id = randomUUID();
  const clients = await Promise.all([cluster.connect(), cluster.connect()]);
  try {
    for (const client of clients) await login(f.actor, client);
    const results = await Promise.all(clients.map((client) => rpc("create", input, id, client)));
    expect(results.filter((r) => r.idempotent)).toHaveLength(1);
    await expect(rpc("create", input, randomUUID(), clients[0])).rejects.toThrow(
      "leaseActiveConflict",
    );
    expect((await counts(f)).payments).toBe(1);
  } finally {
    for (const client of clients) await client.end();
  }
});
it.each(["payments", "ledger_entries", "receivables", "audit_logs", "lease_lifecycle_requests"])(
  "rolls back the entire create if %s rejects a write",
  async (table) => {
    const f = await seed();
    const schema = table === "lease_lifecycle_requests" ? "private" : "public";
    await owner(`create or replace function private.test_reject_write() returns trigger language plpgsql as $$ begin raise exception 'injected_failure'; end $$;
 create trigger test_reject before insert on ${schema}.${table} for each row execute function private.test_reject_write();`);
    try {
      await login(f.actor);
      await expect(
        rpc("create", payload(f, { status: "active", depositReceived: true })),
      ).rejects.toThrow("injected_failure");
      expect(await counts(f)).toEqual({
        contracts: 0,
        payments: 0,
        ledger: 0,
        receivables: 0,
        settlements: 0,
        status: "available",
      });
    } finally {
      await owner(`drop trigger test_reject on ${schema}.${table}`);
    }
  },
);
it("activates a draft once and preserves sold ownership status", async () => {
  const f = await seed("rental_sales"),
    c = await create(f);
  await owner("update units set status='sold' where id=$1", [f.unit]);
  await login(f.actor);
  const input = change(c),
    id = randomUUID();
  expect((await rpc("activate", input, id)).success).toBe(true);
  expect((await rpc("activate", input, id)).idempotent).toBe(true);
  expect((await counts(f)).status).toBe("sold");
});
it("rolls activation back if schedule generation fails and rejects stale contract versions", async () => {
  const f = await seed(),
    c = await create(f);
  await owner(
    "update lease_contracts set commencement_state='pending_project_opening',start_date=null,expected_end_date=null,updated_at=now() where id=$1",
    [c.id],
  );
  await login(f.actor);
  await expect(rpc("activate", change(c))).rejects.toThrow("leaseChanged");
  const current = (await owner("select to_jsonb(l) c from lease_contracts l where id=$1", [c.id]))
    .rows[0].c;
  await login(f.actor);
  await expect(rpc("activate", change(current))).rejects.toThrow("leaseDatesRequireReview");
  expect((await counts(f)).status).toBe("available");
});
it("terminates once, cancels existing receivables and retains a sold unit", async () => {
  const f = await seed(),
    c = await create(f, { status: "active" });
  await owner("update units set status='sold' where id=$1", [f.unit]);
  await login(f.actor);
  const id = randomUUID(),
    input = change(c);
  await rpc("terminate", input, id);
  expect((await rpc("terminate", input, id)).idempotent).toBe(true);
  expect((await counts(f)).status).toBe("sold");
  expect(
    (
      await db.query(
        "select count(*)::int n from receivables where source_id=$1 and status<>'cancelled'",
        [c.id],
      )
    ).rows[0].n,
  ).toBe(0);
});
it.each(["boss", "front_desk", "finance"])(
  "denies create to %s even through private function invocation",
  async (role) => {
    const f = await seed(role);
    await expect(rpc("create", payload(f))).rejects.toThrow("leasePermissionDenied");
    await expect(
      db.query("select private.lease_lifecycle($1,$2,$3)", ["create", payload(f), randomUUID()]),
    ).rejects.toThrow("leasePermissionDenied");
  },
);
it("denies anonymous, service role and direct request table access", async () => {
  const f = await seed();
  const result = (
    await owner(`select has_function_privilege('anon','public.lease_lifecycle_rpc(text,jsonb,uuid)','execute') anon,
 has_function_privilege('service_role','public.lease_lifecycle_rpc(text,jsonb,uuid)','execute') service,
 has_table_privilege('authenticated','private.lease_lifecycle_requests','select') direct`)
  ).rows[0];
  expect(result).toEqual({ anon: false, service: false, direct: false });
  await login(f.actor);
  expect((await create(f)).id).toBeTruthy();
});
it("move-out applies only actual rent to existing debt and records deposit refund without fabricating receivables", async () => {
  const f = await seed(),
    c = await create(f, { status: "active", depositReceived: true });
  const id = randomUUID(),
    input = moveout(c, {
      unpaidRentXof: 600000,
      depositDeductionXof: 200000,
      depositRefundXof: 1000000,
    });
  const done = await rpc("move_out", input, id);
  expect(done.success).toBe(true);
  expect((await rpc("move_out", input, id)).idempotent).toBe(true);
  expect(await counts(f)).toEqual({
    contracts: 1,
    payments: 4,
    ledger: 5,
    receivables: 4,
    settlements: 1,
    status: "available",
  });
  expect(
    (
      await db.query(
        "select sum(paid_amount_xof)::text amount from receivables where source_id=$1 and category='lease_rent'",
        [c.id],
      )
    ).rows[0].amount,
  ).toBe("600000.00");
  expect(
    (
      await db.query(
        "select sum(case when direction='liability_in' then amount_xof when direction='liability_out' then -amount_xof else 0 end)::text amount from ledger_entries where unit_id=$1",
        [f.unit],
      )
    ).rows[0].amount,
  ).toBe("0.00");
});
it.each([
  [{ unpaidRentXof: 1, rentCollectedConfirmed: false }, "leaseCollectionConfirmationRequired"],
  [{ unpaidRentXof: 2000000 }, "leaseCollectionExceedsOutstanding"],
  [{ depositRefundXof: 1200000 }, "leaseDepositReviewRequired"],
  [{ depositRefundXof: -1 }, "invalidLeaseSettlement"],
])("rejects unsafe move-out input %j", async (extra, error) => {
  const f = await seed(),
    c = await create(f, { status: "active" });
  await expect(rpc("move_out", moveout(c, extra))).rejects.toThrow(error);
  expect((await counts(f)).settlements).toBe(0);
});
it("does not invent money when moving out with no collection", async () => {
  const f = await seed(),
    c = await create(f, { status: "active" });
  await rpc("move_out", moveout(c));
  expect((await counts(f)).payments).toBe(0);
  expect(
    (
      await db.query(
        "select sum(paid_amount_xof)::text amount from receivables where source_id=$1",
        [c.id],
      )
    ).rows[0].amount,
  ).toBe("0.00");
});
it("rolls back rent, refund, deduction, room and schedule if settlement insertion fails", async () => {
  const f = await seed(),
    c = await create(f, { status: "active", depositReceived: true });
  await owner(
    `create trigger test_reject before insert on public.lease_settlements for each row execute function private.test_reject_write();`,
  );
  try {
    await login(f.actor);
    await expect(
      rpc("move_out", moveout(c, { unpaidRentXof: 600000, depositRefundXof: 1200000 })),
    ).rejects.toThrow("injected_failure");
    expect(await counts(f)).toEqual({
      contracts: 1,
      payments: 1,
      ledger: 1,
      receivables: 4,
      settlements: 0,
      status: "leased",
    });
  } finally {
    await owner("drop trigger test_reject on public.lease_settlements");
  }
});
async function pay(c: any, id = randomUUID(), amount = 1800000, client = db) {
  return (
    await client.query(
      "select public.record_lease_financial_entry_v2_rpc($1,'rent_income','2026-03-31',$2,'XOF',1,'2026-03-31','cash',null,null,$3) v",
      [c.id, amount, id],
    )
  ).rows[0].v;
}
it("posts payment and next-period receivable in one transaction and checks retry payload", async () => {
  const f = await seed(),
    c = await create(f, { status: "active" }),
    id = randomUUID();
  await pay(c, id);
  expect((await pay(c, id)).idempotent).toBe(true);
  await expect(pay(c, id, 1)).rejects.toThrow("requestIdConflict");
  expect((await counts(f)).receivables).toBe(4);
  expect(
    (
      await db.query(
        "select count(*)::int n from receivables where source_id=$1 and due_date='2026-04-01'",
        [c.id],
      )
    ).rows[0].n,
  ).toBe(1);
});
it("rolls back the payment itself when next-period receivable insertion fails", async () => {
  const f = await seed(),
    c = await create(f, { status: "active" });
  await owner(
    "create trigger test_reject before insert on public.receivables for each row execute function private.test_reject_write();",
  );
  try {
    await login(f.actor);
    await expect(pay(c)).rejects.toThrow("injected_failure");
    expect((await counts(f)).payments).toBe(0);
    expect(
      (await db.query("select paid_through_date from lease_contracts where id=$1", [c.id])).rows[0]
        .paid_through_date,
    ).toBeNull();
  } finally {
    await owner("drop trigger test_reject on public.receivables");
  }
});

it.each(["activate", "terminate"])(
  "rolls all %s changes back when audit fails",
  async (operation) => {
    const f = await seed(),
      c = await create(f, { status: operation === "terminate" ? "active" : "draft" });
    const before = await counts(f);
    await owner(
      "create trigger test_reject before insert on public.audit_logs for each row execute function private.test_reject_write()",
    );
    try {
      await login(f.actor);
      await expect(rpc(operation, change(c))).rejects.toThrow("injected_failure");
      expect(await counts(f)).toEqual(before);
      expect(
        (await db.query("select status from lease_contracts where id=$1", [c.id])).rows[0].status,
      ).toBe(c.status);
    } finally {
      await owner("drop trigger test_reject on public.audit_logs");
    }
  },
);
it("two different activation requests cannot activate two drafts for one room", async () => {
  const f = await seed(),
    a = await create(f),
    b = await create(f);
  const clients = await Promise.all([cluster.connect(), cluster.connect()]);
  try {
    for (const client of clients) await login(f.actor, client);
    const results = await Promise.allSettled([
      rpc("activate", change(a), randomUUID(), clients[0]),
      rpc("activate", change(b), randomUUID(), clients[1]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect((await counts(f)).receivables).toBe(3);
  } finally {
    for (const client of clients) await client.end();
  }
});
it("two settlement requests cannot double-refund the same deposit", async () => {
  const f = await seed(),
    c = await create(f, { status: "active", depositReceived: true });
  const clients = await Promise.all([cluster.connect(), cluster.connect()]);
  try {
    for (const client of clients) await login(f.actor, client);
    const results = await Promise.allSettled(
      clients.map((client) =>
        rpc("move_out", moveout(c, { depositRefundXof: 1200000 }), randomUUID(), client),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await counts(f)).settlements).toBe(1);
    expect(
      (
        await db.query(
          "select count(*)::int n from payments where source_id=$1 and source_type='lease_deposit_refund'",
          [c.id],
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    for (const client of clients) await client.end();
  }
});
it("checks actor, current role and project scope even on a previously successful request", async () => {
  const f = await seed(),
    input = payload(f),
    id = randomUUID();
  await rpc("create", input, id);
  const other = await seed();
  await expect(rpc("create", input, id)).rejects.toThrow("requestIdConflict");
  await owner("update user_profiles set role='boss' where id=$1", [f.actor]);
  await login(f.actor);
  await expect(rpc("create", input, id)).rejects.toThrow("leasePermissionDenied");
  await owner("update user_profiles set role='admin' where id=$1", [f.actor]);
  await db.query(
    "update projects set code='CIMAC' where id=(select b.project_id from buildings b join units u on u.building_id=b.id where u.id=$1)",
    [f.unit],
  );
  await login(f.actor);
  await expect(rpc("create", input, id)).rejects.toThrow("leaseAccessDenied");
  // Prevent the synthetic CIMAC code from colliding with later fixtures.
  await owner("update projects set code=id::text where code='CIMAC'");
  expect(other.actor).not.toBe(f.actor);
});
it("requires finance role for settlement and admin for administrative termination", async () => {
  const f = await seed(),
    c = await create(f, { status: "active" });
  await owner("update user_profiles set role='rental_sales' where id=$1", [f.actor]);
  await login(f.actor);
  await expect(rpc("move_out", moveout(c))).rejects.toThrow("leasePermissionDenied");
  await expect(rpc("terminate", change(c))).rejects.toThrow("leasePermissionDenied");
  await owner("update user_profiles set role='finance' where id=$1", [f.actor]);
  await login(f.actor);
  expect((await rpc("move_out", moveout(c))).success).toBe(true);
});
it("does not cancel future paid rent and does not refund missing historical deposits", async () => {
  const f = await seed(),
    c = await create(f, { status: "active", depositReceived: true });
  await owner(
    "update receivables set paid_amount_xof=1,status='partial' where source_id=$1 and category='lease_rent' and due_date='2026-03-31'",
    [c.id],
  );
  await login(f.actor);
  await expect(
    rpc("move_out", moveout(c, { actualEndDate: "2026-02-28", depositRefundXof: 1200000 })),
  ).rejects.toThrow("leaseReceivableReviewRequired");
  await owner("delete from ledger_entries where unit_id=$1;", [f.unit]);
  await db.query("delete from payments where source_id=$1", [c.id]);
  await login(f.actor);
  await expect(rpc("move_out", moveout(c, { depositRefundXof: 1200000 }))).rejects.toThrow(
    "leaseDepositReviewRequired",
  );
});
it("keeps combined receipts atomic through the legacy compatibility entrypoint", async () => {
  const f = await seed(),
    c = await create(f, { status: "active" }),
    rentId = randomUUID(),
    propertyId = randomUUID();
  const args = [c.id, rentId, propertyId];
  const sql =
    "select public.record_combined_lease_payment_rpc($1,'2026-03-31',1800000,120000,'2026-03-31','cash',null,'RENT','PROPERTY',$2,$3) v";
  expect((await db.query(sql, args)).rows[0].v.success).toBe(true);
  expect((await db.query(sql, args)).rows[0].v.rent.idempotent).toBe(true);
  expect((await counts(f)).payments).toBe(2);
  expect(
    (
      await db.query(
        "select count(*)::int n from receivables where source_id=$1 and due_date='2026-04-01'",
        [c.id],
      )
    ).rows[0].n,
  ).toBe(1);
});
it("rolls back combined rent and next-period receivable if the property receipt fails", async () => {
  const f = await seed(),
    c = await create(f, { status: "active" });
  await owner(`create function private.test_reject_property() returns trigger language plpgsql as $$ begin
 if new.source_type='property_fee' then raise exception 'property_failure'; end if; return new; end $$;
 create trigger test_reject before insert on public.payments for each row execute function private.test_reject_property();`);
  try {
    await login(f.actor);
    await expect(
      db.query(
        "select public.record_combined_lease_payment_rpc($1,'2026-03-31',1800000,120000,'2026-03-31','cash',null,'RENT','PROPERTY',$2,$3)",
        [c.id, randomUUID(), randomUUID()],
      ),
    ).rejects.toThrow("property_failure");
    expect((await counts(f)).payments).toBe(0);
    expect((await counts(f)).receivables).toBe(3);
  } finally {
    await owner("drop trigger test_reject on public.payments");
  }
});

it("rejects deposit refund when payment evidence and liability ledger disagree", async () => {
  const f = await seed(),
    c = await create(f, { status: "active", depositReceived: true });
  await owner(
    "update ledger_entries set amount_xof=1 where unit_id=$1 and category='lease_deposit'",
    [f.unit],
  );
  await login(f.actor);
  await expect(rpc("move_out", moveout(c, { depositRefundXof: 1200000 }))).rejects.toThrow(
    "leaseDepositReviewRequired",
  );
});
it("allows later actual collection of retained arrears after move-out without creating another period", async () => {
  const f = await seed(),
    c = await create(f, { status: "active" });
  await rpc("move_out", moveout(c));
  await pay(c);
  expect((await counts(f)).receivables).toBe(3);
  await expect(pay(c, randomUUID(), 1)).rejects.toThrow("leaseClosedRentReviewRequired");
});
it("cannot refund the same deposit again using the standalone finance API after settlement", async () => {
  const f = await seed(),
    c = await create(f, { status: "active", depositReceived: true });
  await rpc("move_out", moveout(c, { depositRefundXof: 1200000 }));
  await expect(
    db.query(
      "select public.record_lease_financial_entry_v2_rpc($1,'deposit_refund','2026-03-31',1,'XOF',1,null,'cash',null,null,$2)",
      [c.id, randomUUID()],
    ),
  ).rejects.toThrow("leaseDepositReviewRequired");
});
it("serializes financial retries and next-period generation across connections", async () => {
  const f = await seed(),
    c = await create(f, { status: "active" }),
    id = randomUUID();
  const clients = await Promise.all([cluster.connect(), cluster.connect()]);
  try {
    for (const client of clients) await login(f.actor, client);
    const result = await Promise.all(clients.map((client) => pay(c, id, 1800000, client)));
    expect(result.filter((r) => r.idempotent)).toHaveLength(1);
    expect((await counts(f)).payments).toBe(1);
    expect((await counts(f)).receivables).toBe(4);
  } finally {
    for (const client of clients) await client.end();
  }
});

it("does not elevate a rental salesperson into a long-lease cashier through contract creation", async () => {
  const f = await seed("rental_sales");
  await expect(create(f, { depositReceived: true })).rejects.toThrow(
    "leaseFinancePermissionDenied",
  );
  expect((await counts(f)).contracts).toBe(0);
  await login(f.actor);
  expect((await create(f)).deposit_received).toBe(false);
});
