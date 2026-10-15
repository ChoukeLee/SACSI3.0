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
  // Reproduce the legacy broad table grants/permissive policies explicitly.
  // Negative tests must exercise the new invoker guards, not pass accidentally
  // because an isolated test fixture happened to revoke direct financial DML.
  await db.query("grant insert,update on public.payments,public.receivables to authenticated");
  await db.query(
    "create policy synthetic_legacy_payment_dml on public.payments for all to authenticated using(true) with check(true)",
  );
  await db.query(
    "create policy synthetic_legacy_receivable_dml on public.receivables for all to authenticated using(true) with check(true)",
  );
}, 45000);
afterAll(async () => {
  await cluster?.close();
});
async function owner() {
  await db.query("reset role");
}
async function login(actor: string) {
  await owner();
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: "authenticated" }),
  ]);
  await db.query("set role authenticated");
}
async function seed(role = "admin", restricted = false) {
  await owner();
  await db.query("select set_config('request.jwt.claims','{}',false)");
  const actor = randomUUID(),
    project = randomUUID(),
    building = randomUUID(),
    unit = randomUUID(),
    customer = randomUUID(),
    payment = randomUUID(),
    receivable = randomUUID();
  await db.query("insert into auth.users(id,email) values($1,$2)", [
    actor,
    `${actor}@test.invalid`,
  ]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,$2,'Synthetic operator')",
    [actor, role],
  );
  await db.query(
    "insert into projects(id,code,display_name,access_mode,allows_long_lease,allows_sale) values($1,$2,'Synthetic',$3,true,true)",
    [project, project, restricted ? "restricted" : "open"],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name) values($1,$2,$3,'Synthetic')",
    [building, project, building],
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status) values($1,$2,$3,'408','4','available')",
    [unit, building, unit],
  );
  await db.query("insert into customers(id,name) values($1,'Synthetic customer')", [customer]);
  await db.query(
    "insert into payments(id,customer_id,unit_id,source_type,payment_date,amount,currency,exchange_rate_to_xof) values($1,$2,$3,'manual','2026-10-01',100,'XOF',1)",
    [payment, customer, unit],
  );
  await db.query(
    "insert into receivables(id,building_id,unit_id,customer_id,source_type,category,title,due_date,amount_xof,paid_amount_xof,status) values($1,$2,$3,$4,'manual','other','Synthetic period','2026-10-01',100,100,'paid')",
    [receivable, building, unit, customer],
  );
  await db.query(
    "insert into payment_receivable_allocations(payment_id,receivable_id,amount_xof,actor_id,request_id) values($1,$2,100,$3,$4)",
    [payment, receivable, actor, randomUUID()],
  );
  await login(actor);
  return { actor, project, building, unit, customer, payment, receivable };
}
async function read(id: string) {
  return (await db.query("select public.payment_context_read_rpc($1) result", [id])).rows[0].result;
}
async function confirm(id: string, input: unknown, request = randomUUID()) {
  return (
    await db.query("select public.confirm_payment_context_rpc($1,$2,$3) result", [
      id,
      input,
      request,
    ])
  ).rows[0].result;
}

async function leasePosition(restricted = false) {
  const f = await seed("admin", restricted),
    contract = randomUUID();
  const first = `ffffffff-ffff-4fff-8fff-${randomUUID().slice(-12)}`;
  const second = `00000000-0000-4000-8000-${randomUUID().slice(-12)}`;
  await owner();
  await db.query(
    "insert into lease_contracts(id,unit_id,customer_id,contract_no,payment_cycle,payment_day,monthly_rent_xof,deposit_amount_xof,deposit_received,status,start_date,expected_end_date) values($1,$2,$3,$4,'monthly',1,100,0,false,'active','2026-08-01','2027-07-31')",
    [contract, f.unit, f.customer, contract],
  );
  await db.query("update units set status='leased' where id=$1", [f.unit]);
  await db.query("delete from payment_receivable_allocations where payment_id=$1", [f.payment]);
  await db.query(
    "update receivables set id=$1,source_type='lease_contract',source_id=$2,category='lease_rent',due_date='2026-08-01',paid_amount_xof=50,status='partial' where id=$3",
    [first, contract, f.receivable],
  );
  await db.query(
    "insert into receivables(id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,status) values($1,$2,$3,$4,'lease_contract',$5,'lease_rent','Synthetic second rent','2026-09-01',100,50,'partial')",
    [second, f.building, f.unit, f.customer, contract],
  );
  await db.query("update payments set source_type='lease_rent',source_id=$1 where id=$2", [
    contract,
    f.payment,
  ]);
  for (const receivable of [first, second])
    await db.query(
      "insert into payment_receivable_allocations(payment_id,receivable_id,amount_xof,actor_id,request_id) values($1,$2,50,$3,$4)",
      [f.payment, receivable, f.actor, randomUUID()],
    );
  await login(f.actor);
  return { ...f, contract, first, second };
}
async function buildingManual(restricted = false) {
  const f = await seed("admin", restricted),
    ledger = randomUUID();
  await owner();
  await db.query("delete from payment_receivable_allocations where payment_id=$1", [f.payment]);
  await db.query(
    "insert into ledger_entries(id,building_id,payment_id,entry_date,direction,category,amount_xof,description) values($1,$2,$3,'2026-10-01','income','other',100,'Synthetic building-only receipt')",
    [ledger, f.building, f.payment],
  );
  await db.query("update payments set unit_id=null,source_id=$1 where id=$2", [ledger, f.payment]);
  await login(f.actor);
  return { ...f, ledger };
}
function explicitPeriods(context: { allocations: Array<{ receivableId: string; token: string }> }) {
  return context.allocations.map((row, index) => ({
    receivableId: row.receivableId,
    expectedToken: row.token,
    start: index ? "2026-09-01" : "2026-08-01",
    end: index ? "2026-09-30" : "2026-08-31",
    source: "Synthetic original contract evidence",
  }));
}

it("new public RPCs are invoker wrappers, anonymous execution and private request-table reads remain denied", async () => {
  await owner();
  expect(
    (
      await db.query(
        "select prosecdef from pg_proc where oid='public.confirm_payment_context_rpc(uuid,jsonb,uuid)'::regprocedure",
      )
    ).rows[0].prosecdef,
  ).toBe(false);
  expect(
    (
      await db.query(
        "select has_function_privilege('anon','public.payment_context_read_rpc(uuid)','execute') allowed",
      )
    ).rows[0].allowed,
  ).toBe(false);
  expect(
    (
      await db.query(
        "select has_table_privilege('authenticated','private.payment_context_requests','select') allowed",
      )
    ).rows[0].allowed,
  ).toBe(false);
});

it("direct authenticated financial DML cannot prefill or mutate new payment confirmation facts", async () => {
  const f = await seed();
  expect(
    (
      await db.query("update payments set notes='Synthetic legacy DML permitted' where id=$1", [
        f.payment,
      ])
    ).rowCount,
  ).toBe(1);
  for (const fields of [
    "actual_collector='Forged collector',collector_basis='Forged evidence'",
    "context_version=1",
    "context_confirmed_by=auth.uid()",
    "context_confirmed_at=now()",
  ]) {
    await expect(
      db.query(`update payments set ${fields} where id=$1`, [f.payment]),
    ).rejects.toThrow("paymentFactsConfirmationRequired");
  }
  await expect(
    db.query("update payments set recorded_by=auth.uid() where id=$1", [f.payment]),
  ).rejects.toThrow("recordingActorImmutable");
  for (const [columns, values] of [
    ["actual_collector,collector_basis", "'Forged collector','Forged evidence'"],
    ["context_version", "1"],
    ["context_confirmed_by", "auth.uid()"],
    ["context_confirmed_at", "now()"],
  ]) {
    await expect(
      db.query(
        `insert into payments(unit_id,source_type,payment_date,amount,currency,exchange_rate_to_xof,${columns}) values($1,'manual','2026-10-01',100,'XOF',1,${values})`,
        [f.unit],
      ),
    ).rejects.toThrow("paymentFactsConfirmationRequired");
  }
  const original = await read(f.payment);
  expect(original).toMatchObject({
    actualCollector: null,
    collectorBasis: null,
    recordedBy: null,
    version: 0,
  });
  expect(
    (
      await db.query(
        "select count(*)::int n from audit_logs where entity_type='payment_context' and entity_id=$1",
        [f.payment],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    (
      await confirm(f.payment, {
        expectedToken: original.token,
        collectorName: "颖",
        collectorBasis: "Verified through the audited RPC",
      })
    ).actualCollector,
  ).toBe("颖");
});

it("direct period DML is denied while legacy paid-amount writes are not represented as fixed", async () => {
  const f = await seed();
  expect(
    (
      await db.query("update receivables set paid_amount_xof=paid_amount_xof where id=$1", [
        f.receivable,
      ])
    ).rowCount,
  ).toBe(1);
  await expect(
    db.query(
      "update receivables set service_period_start='2026-08-01',service_period_end='2026-08-31',service_period_source='Forged source' where id=$1",
      [f.receivable],
    ),
  ).rejects.toThrow("paymentFactsConfirmationRequired");
  await expect(
    db.query("update receivables set service_period_confirmed_by=auth.uid() where id=$1", [
      f.receivable,
    ]),
  ).rejects.toThrow("paymentFactsConfirmationRequired");
  await expect(
    db.query(
      "insert into receivables(building_id,unit_id,customer_id,source_type,category,title,due_date,amount_xof,service_period_start,service_period_end,service_period_source) values($1,$2,$3,'manual','other','Forged period','2026-10-01',100,'2026-08-01','2026-08-31','Forged source')",
      [f.building, f.unit, f.customer],
    ),
  ).rejects.toThrow("paymentFactsConfirmationRequired");
  const initial = await read(f.payment);
  expect(initial.allocations[0].periodStart).toBeNull();
  expect(
    (await confirm(f.payment, { expectedToken: initial.token, periods: explicitPeriods(initial) }))
      .allocations[0].periodStart,
  ).toBe("2026-08-01");
});

it("new direct payment inserts bind recording identity to auth.uid, never a supplied actor", async () => {
  const f = await seed(),
    other = await seed();
  await login(f.actor);
  const payment = (
    await db.query(
      "insert into payments(unit_id,source_type,payment_date,amount,currency,exchange_rate_to_xof,recorded_by) values($1,'manual','2026-10-01',100,'XOF',1,$2) returning id,recorded_by",
      [f.unit, other.actor],
    )
  ).rows[0];
  expect(payment.recorded_by).toBe(f.actor);
  await expect(
    db.query("update payments set recorded_by=$1 where id=$2", [other.actor, payment.id]),
  ).rejects.toThrow("recordingActorImmutable");
});

it("missing current database profile denies both read and private definer confirmation", async () => {
  const f = await seed(),
    initial = await read(f.payment);
  await owner();
  await db.query("delete from user_profiles where id=$1", [f.actor]);
  await login(f.actor);
  await expect(read(f.payment)).rejects.toThrow("paymentContextPermissionDenied");
  await expect(
    confirm(f.payment, {
      expectedToken: initial.token,
      collectorName: "Forged collector",
      collectorBasis: "Unknown profile",
    }),
  ).rejects.toThrow("paymentContextPermissionDenied");
});
it("explicit facts are auditable/idempotent and leave all money, balances, dates and ledger unchanged", async () => {
  const f = await seed(),
    original = await read(f.payment),
    request = randomUUID();
  expect(original.actualCollector).toBeNull();
  expect(original.recordedBy).toBeNull();
  expect(original.allocations[0].periodStart).toBeNull();
  const input = {
    expectedToken: original.token,
    collectorName: "振咏",
    collectorBasis: "明确收据与人工核对",
    periods: [
      {
        receivableId: f.receivable,
        expectedToken: original.allocations[0].token,
        start: "2026-08-26",
        end: "2027-02-25",
        source: "已核对合同账期，不采用到期日推断",
      },
    ],
  };
  const result = await confirm(f.payment, input, request);
  expect(result.actualCollector).toBe("振咏");
  expect(result.confirmedBy).toBe(f.actor);
  expect(result.allocations[0]).toMatchObject({
    periodStart: "2026-08-26",
    periodEnd: "2027-02-25",
  });
  expect(await confirm(f.payment, input, request)).toEqual(result);
  await owner();
  expect(
    (
      await db.query(
        "select amount,currency,exchange_rate_to_xof,payment_date,recorded_by from payments where id=$1",
        [f.payment],
      )
    ).rows[0],
  ).toMatchObject({
    amount: "100.00",
    currency: "XOF",
    exchange_rate_to_xof: "1.000000",
    recorded_by: null,
  });
  expect(
    (
      await db.query(
        "select amount_xof,paid_amount_xof,status,due_date::text from receivables where id=$1",
        [f.receivable],
      )
    ).rows[0],
  ).toEqual({
    amount_xof: "100.00",
    paid_amount_xof: "100.00",
    status: "paid",
    due_date: "2026-10-01",
  });
  expect(
    (
      await db.query(
        "select count(*)::int n from audit_logs where entity_type='payment_context' and entity_id=$1",
        [f.payment],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (await db.query("select count(*)::int n from ledger_entries where payment_id=$1", [f.payment]))
      .rows[0].n,
  ).toBe(0);
});
it("rejects stale context/period tokens, mismatched requests and unrelated receivables atomically", async () => {
  const f = await seed(),
    initial = await read(f.payment),
    request = randomUUID();
  const input = { expectedToken: initial.token, collectorName: "黄姐", collectorBasis: "人工确认" };
  await confirm(f.payment, input, request);
  await expect(confirm(f.payment, input)).rejects.toThrow("paymentContextSnapshotChanged");
  await expect(confirm(f.payment, { ...input, collectorName: "颖" }, request)).rejects.toThrow(
    "paymentContextRequestConflict",
  );
  const fresh = await read(f.payment);
  await expect(
    confirm(f.payment, {
      expectedToken: fresh.token,
      periods: [
        {
          receivableId: randomUUID(),
          expectedToken: initial.allocations[0].token,
          start: "2026-01-01",
          end: "2026-01-31",
          source: "Synthetic",
        },
      ],
    }),
  ).rejects.toThrow("paymentContextTargetMismatch");
  expect((await read(f.payment)).version).toBe(fresh.version);
});
it.each(["boss", "front_desk", "rental_sales"])("role %s cannot confirm facts", async (role) => {
  const f = await seed(role);
  await expect(
    confirm(f.payment, {
      expectedToken: "a".repeat(32),
      collectorName: "颖",
      collectorBasis: "Synthetic",
    }),
  ).rejects.toThrow("paymentContextPermissionDenied");
});
it("restricted project access is checked even by the private definer writer", async () => {
  const f = await seed("admin", true);
  await expect(read(f.payment)).rejects.toThrow();
  await expect(
    confirm(f.payment, {
      expectedToken: "a".repeat(32),
      collectorName: "颖",
      collectorBasis: "Synthetic",
    }),
  ).rejects.toThrow("paymentContextPermissionDenied");
});
it("records the authenticated insertion account, never treats it as actual collector", async () => {
  const f = await seed("finance"),
    payment = randomUUID();
  await owner();
  await db.query(
    "insert into payments(id,unit_id,source_type,payment_date,amount,currency,exchange_rate_to_xof,recorded_by) values($1,$2,'manual','2026-10-01',100,'XOF',1,null)",
    [payment, f.unit],
  );
  await login(f.actor);
  expect(await read(payment)).toMatchObject({
    recordedBy: f.actor,
    actualCollector: null,
    collectorBasis: null,
  });
});
it("concurrent fact confirmations serialize and reject the stale request", async () => {
  const f = await seed(),
    original = await read(f.payment);
  const first = await cluster.connect(),
    second = await cluster.connect();
  const body = {
    expectedToken: original.token,
    collectorName: "颖",
    collectorBasis: "Synthetic concurrency proof",
  };
  try {
    for (const client of [first, second]) {
      await client.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: f.actor, role: "authenticated" }),
      ]);
      await client.query("set role authenticated");
    }
    await first.query("begin");
    await first.query("select public.confirm_payment_context_rpc($1,$2,$3)", [
      f.payment,
      body,
      randomUUID(),
    ]);
    const waiting = second
      .query("select public.confirm_payment_context_rpc($1,$2,$3)", [f.payment, body, randomUUID()])
      .then(
        () => ({ ok: true }),
        (error: Error) => ({ ok: false, error }),
      );
    await first.query("commit");
    const result = await waiting;
    expect(result.ok).toBe(false);
    if ("error" in result) expect(result.error.message).toContain("paymentContextSnapshotChanged");
    expect((await read(f.payment)).version).toBe(1);
  } finally {
    await first.end();
    await second.end();
  }
});
it("new lease collections allocate only the exact applied receivables and remain idempotent", async () => {
  const f = await seed(),
    request = randomUUID();
  const contract = (
    await db.query("select public.lease_lifecycle_rpc('create',$1,$2) result", [
      {
        unitId: f.unit,
        customerId: f.customer,
        startDate: "2026-08-01",
        expectedEndDate: "2027-07-31",
        paymentCycle: "monthly",
        paymentDay: 1,
        monthlyRentXof: 100,
        depositAmountXof: 0,
        depositReceived: false,
        rentFreeDays: 0,
        status: "active",
      },
      randomUUID(),
    ])
  ).rows[0].result.data;
  const before = Number(
    (
      await db.query(
        "select sum(greatest(amount_xof-paid_amount_xof,0)) amount from receivables where source_type='lease_contract' and source_id=$1 and category='lease_rent'",
        [contract.id],
      )
    ).rows[0].amount,
  );
  const args = [
    contract.id,
    "rent_income",
    "2026-10-15",
    150,
    "XOF",
    1,
    "2026-08-31",
    "cash",
    null,
    null,
    request,
  ];
  const sql =
    "select public.record_lease_financial_entry_v2_rpc($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) result";
  const result = (await db.query(sql, args)).rows[0].result;
  expect((await db.query(sql, args)).rows[0].result.idempotent).toBe(true);
  const facts = await read(result.payment_id);
  expect(facts.allocatedXof).toBe(Math.min(before, 150));
  expect(facts.recordedBy).toBe(f.actor);
  expect(facts.actualCollector).toBeNull();
  expect(
    facts.allocations.every((row: { periodStart: string | null }) => row.periodStart === null),
  ).toBe(true);
});
it("daily direct and batch confirmation paths record one exact allocation, never duplicates", async () => {
  const f = await seed(),
    booking = randomUUID(),
    receivable = randomUUID();
  await owner();
  await db.query("update projects set allows_daily_rental=true where id=$1", [f.project]);
  await db.query(
    "insert into unit_business_flags(unit_id,business_type,is_enabled) values($1,'daily_rental',true)",
    [f.unit],
  );
  await db.query(
    "insert into daily_bookings(id,unit_id,customer_id,booking_agent_id,check_in,check_out,nightly_price_xof,total_amount_xof,final_amount_xof,prepaid_amount_xof,status) values($1,$2,$3,$3,'2026-10-01','2026-10-05',100,400,400,0,'confirmed')",
    [booking, f.unit, f.customer],
  );
  await db.query(
    "insert into receivables(id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof) values($1,$2,$3,$4,'daily_booking',$5,'daily_rental','Synthetic daily','2026-10-01',400)",
    [receivable, f.building, f.unit, f.customer, booking],
  );
  await login(f.actor);
  const requestId = randomUUID();
  await db.query("select public.daily_record_payment_rpc($1,100,'2026-10-15',null,$2,'{}')", [
    booking,
    requestId,
  ]);
  await db.query("select public.daily_record_payment_rpc($1,100,'2026-10-15',null,$2,'{}')", [
    booking,
    requestId,
  ]);
  const request = {
    requestId: randomUUID(),
    protocolVersion: "1.0",
    connectorVersion: "0.5.0",
    originalInstruction: "Synthetic daily receipt",
    totalXof: 100,
    rows: [
      {
        lineId: "1",
        sourceText: "Synthetic daily",
        domain: "daily",
        targetId: booking,
        totalXof: 100,
        paymentDate: "2026-10-15",
        paymentMethod: "cash",
        allocations: [{ receivableId: receivable, amountXof: 100 }],
      },
    ],
  };
  const snapshot = (
    await db.query("select public.preview_operator_collection($1) result", [request])
  ).rows[0].result;
  const draft = (
    await db.query(
      "select public.create_operator_collection($1,$2,now()+interval '5 minutes','native') result",
      [JSON.stringify(request), JSON.stringify(snapshot)],
    )
  ).rows[0].result;
  expect(
    (await db.query("select public.confirm_operator_collection($1) result", [draft.id])).rows[0]
      .result.verified,
  ).toBe(true);
  await owner();
  expect(
    (
      await db.query(
        "select count(*)::int n,sum(amount_xof)::int total from payment_receivable_allocations where receivable_id=$1",
        [receivable],
      )
    ).rows[0],
  ).toEqual({ n: 2, total: 200 });
  expect(
    (
      await db.query("select prepaid_amount_xof::int paid from daily_bookings where id=$1", [
        booking,
      ])
    ).rows[0].paid,
  ).toBe(200);
});

it("authorized legacy null-unit payments use the same contract-resolved unit for reading and period confirmation", async () => {
  const f = await leasePosition();
  await owner();
  await db.query("update payments set unit_id=null where id=$1", [f.payment]);
  await login(f.actor);
  const initial = await read(f.payment);
  expect(initial.unitId).toBe(f.unit);
  const result = await confirm(f.payment, {
    expectedToken: initial.token,
    periods: explicitPeriods(initial),
  });
  expect(result.allocations[0].periodStart).toBe("2026-08-01");
  await owner();
  await db.query("update projects set access_mode='restricted' where id=$1", [f.project]);
  await login(f.actor);
  await expect(read(f.payment)).rejects.toThrow("paymentContextPermissionDenied");
  await expect(
    confirm(f.payment, {
      expectedToken: result.token,
      collectorName: "颖",
      collectorBasis: "Synthetic",
    }),
  ).rejects.toThrow("paymentContextPermissionDenied");
});

it("stale allocated-receivable tokens are rejected even when the payment token itself remains current", async () => {
  const f = await seed(),
    otherPayment = randomUUID();
  await owner();
  await db.query("update receivables set amount_xof=200,paid_amount_xof=200 where id=$1", [
    f.receivable,
  ]);
  await db.query(
    "insert into payments(id,unit_id,source_type,payment_date,amount,currency,exchange_rate_to_xof) values($1,$2,'manual','2026-10-01',100,'XOF',1)",
    [otherPayment, f.unit],
  );
  await db.query(
    "insert into payment_receivable_allocations(payment_id,receivable_id,amount_xof,actor_id,request_id) values($1,$2,100,$3,$4)",
    [otherPayment, f.receivable, f.actor, randomUUID()],
  );
  await login(f.actor);
  const initial = await read(f.payment),
    other = await read(otherPayment);
  await confirm(otherPayment, { expectedToken: other.token, periods: explicitPeriods(other) });
  expect((await read(f.payment)).token).toBe(initial.token);
  await expect(
    confirm(f.payment, { expectedToken: initial.token, periods: explicitPeriods(initial) }),
  ).rejects.toThrow("paymentContextSnapshotChanged");
  expect((await read(f.payment)).version).toBe(0);
});

it("valid first period plus invalid second period rolls back all facts, version and audit", async () => {
  const f = await leasePosition(),
    initial = await read(f.payment),
    periods = explicitPeriods(initial);
  periods[1].end = "2026-08-31";
  await expect(
    confirm(f.payment, {
      expectedToken: initial.token,
      collectorName: "颖",
      collectorBasis: "Synthetic",
      periods,
    }),
  ).rejects.toThrow("invalidPaymentContext");
  expect(await read(f.payment)).toEqual(initial);
  await owner();
  expect(
    (
      await db.query(
        "select count(*)::int n from audit_logs where entity_type='payment_context' and entity_id=$1",
        [f.payment],
      )
    ).rows[0].n,
  ).toBe(0);
});

it.each(["project", "role"])(
  "completed request replay rechecks revoked %s authority",
  async (revocation) => {
    const f = await seed("admin", revocation === "project"),
      request = randomUUID();
    if (revocation === "project") {
      await owner();
      await db.query(
        "insert into project_account_access(project_id,account_id,account_email) values($1,$2,$3)",
        [f.project, f.actor, `${f.actor}@test.invalid`],
      );
      await login(f.actor);
    }
    const initial = await read(f.payment),
      input = { expectedToken: initial.token, collectorName: "颖", collectorBasis: "Synthetic" };
    await confirm(f.payment, input, request);
    await owner();
    if (revocation === "project")
      await db.query("delete from project_account_access where project_id=$1 and account_id=$2", [
        f.project,
        f.actor,
      ]);
    else await db.query("update user_profiles set role='boss' where id=$1", [f.actor]);
    await login(f.actor);
    await expect(confirm(f.payment, input, request)).rejects.toThrow(
      "paymentContextPermissionDenied",
    );
  },
);

it("lease receipt and facts confirmation serialize on the contract before opposite-UUID-order receivables", async () => {
  const f = await leasePosition(),
    initial = await read(f.payment);
  expect(initial.allocations.map((row: { receivableId: string }) => row.receivableId)).toEqual([
    f.first,
    f.second,
  ]);
  const first = await cluster.connect(),
    second = await cluster.connect();
  try {
    for (const client of [first, second]) {
      await client.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: f.actor, role: "authenticated" }),
      ]);
      await client.query("set role authenticated");
    }
    const firstPid = (await first.query("select pg_backend_pid() pid")).rows[0].pid;
    const secondPid = (await second.query("select pg_backend_pid() pid")).rows[0].pid;
    await first.query("begin");
    await first.query(
      "select public.record_lease_financial_entry_v2_rpc($1,'rent_income','2026-10-15',50,'XOF',1,'2026-08-31','cash',null,null,$2)",
      [f.contract, randomUUID()],
    );
    const waiting = second
      .query("select public.confirm_payment_context_rpc($1,$2,$3)", [
        f.payment,
        { expectedToken: initial.token, periods: explicitPeriods(initial) },
        randomUUID(),
      ])
      .then(
        () => ({ ok: true }),
        (error: Error) => ({ ok: false, error }),
      );
    await owner();
    let blocked = false;
    for (let i = 0; i < 120; i++) {
      blocked = (
        await db.query("select $1::int=any(pg_blocking_pids($2::int)) blocked", [
          firstPid,
          secondPid,
        ])
      ).rows[0].blocked;
      if (blocked) break;
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });
    }
    expect(blocked).toBe(true);
    expect(
      (
        await db.query(
          "select count(*)::int n from pg_locks where pid=$1 and relation='public.receivables'::regclass and mode='RowShareLock'",
          [secondPid],
        )
      ).rows[0].n,
    ).toBe(0);
    await first.query("commit");
    const result = await waiting;
    expect(result.ok).toBe(false);
    if ("error" in result) expect(result.error.message).toContain("paymentContextSnapshotChanged");
    await login(f.actor);
    expect((await read(f.payment)).version).toBe(0);
  } finally {
    await first.query("rollback");
    await first.end();
    await second.end();
  }
});

it("new move-out actual rent collection records its exact applied allocations and replays without duplicates", async () => {
  const f = await leasePosition(),
    request = randomUUID();
  const c = (
    await db.query("select updated_at::text from lease_contracts where id=$1", [f.contract])
  ).rows[0];
  const input = {
    contractId: f.contract,
    expectedUpdatedAt: c.updated_at,
    actualEndDate: "2026-09-30",
    unpaidRentXof: 100,
    depositDeductionXof: 0,
    depositRefundXof: 0,
    utilityCleared: true,
    rentCollectedConfirmed: true,
    paymentMethod: "cash",
  };
  const sql = "select public.lease_lifecycle_rpc('move_out',$1,$2) result";
  expect((await db.query(sql, [input, request])).rows[0].result.success).toBe(true);
  expect((await db.query(sql, [input, request])).rows[0].result.idempotent).toBe(true);
  await owner();
  const rows = (
    await db.query(
      "select a.receivable_id,a.amount_xof::int amount from payments p join payment_receivable_allocations a on a.payment_id=p.id where p.source_id=$1 and p.request_kind='lease_move_out' order by a.receivable_id",
      [f.contract],
    )
  ).rows;
  expect(rows).toEqual([
    { receivable_id: f.second, amount: 50 },
    { receivable_id: f.first, amount: 50 },
  ]);
});

it("building-only manual receipts support collector facts through their exact bidirectional ledger link", async () => {
  const f = await buildingManual(),
    initial = await read(f.payment),
    request = randomUUID();
  expect(initial).toMatchObject({
    unitId: null,
    buildingId: f.building,
    allocations: [],
    amount: 100,
    actualCollector: null,
  });
  const input = {
    expectedToken: initial.token,
    collectorName: "黄姐",
    collectorBasis: "Synthetic building receipt with explicit confirmation",
  };
  const result = await confirm(f.payment, input, request);
  expect(result.actualCollector).toBe("黄姐");
  expect(await confirm(f.payment, input, request)).toEqual(result);
  await expect(
    confirm(f.payment, {
      expectedToken: result.token,
      periods: [
        {
          receivableId: f.receivable,
          expectedToken: "a".repeat(32),
          start: "2026-08-01",
          end: "2026-08-31",
          source: "Cannot infer a unit or period",
        },
      ],
    }),
  ).rejects.toThrow("paymentContextTargetMismatch");
  await owner();
  expect(
    (await db.query("select amount::int amount,unit_id from payments where id=$1", [f.payment]))
      .rows[0],
  ).toEqual({ amount: 100, unit_id: null });
  expect(
    (await db.query("select amount_xof::int amount from ledger_entries where id=$1", [f.ledger]))
      .rows[0].amount,
  ).toBe(100);
});
it("building-only manual receipts remain denied for a restricted project", async () => {
  const f = await buildingManual(true);
  await expect(read(f.payment)).rejects.toThrow("paymentContextPermissionDenied");
  await expect(
    confirm(f.payment, {
      expectedToken: "a".repeat(32),
      collectorName: "黄姐",
      collectorBasis: "Synthetic inaccessible building",
    }),
  ).rejects.toThrow("paymentContextPermissionDenied");
});
it.each(["source", "payment", "building", "duplicate"])(
  "manual attribution cannot use a tampered %s link",
  async (tamper) => {
    const f = await buildingManual();
    await owner();
    if (tamper === "source")
      await db.query("update payments set source_id=$1 where id=$2", [randomUUID(), f.payment]);
    else if (tamper === "payment")
      await db.query("update ledger_entries set payment_id=null where id=$1", [f.ledger]);
    else if (tamper === "building")
      await db.query("update ledger_entries set building_id=null where id=$1", [f.ledger]);
    else
      await db.query(
        "insert into ledger_entries(building_id,payment_id,entry_date,direction,category,amount_xof) values($1,$2,'2026-10-01','income','other',100)",
        [f.building, f.payment],
      );
    await login(f.actor);
    await expect(read(f.payment)).rejects.toThrow("paymentContextPermissionDenied");
    await expect(
      confirm(f.payment, {
        expectedToken: "a".repeat(32),
        collectorName: "黄姐",
        collectorBasis: "Forged attribution",
      }),
    ).rejects.toThrow("paymentContextPermissionDenied");
  },
);

it.each([
  ["lease", "property_fee"],
  ["lease", "parking_fee"],
  ["sale", "property_fee"],
  ["sale", "parking_fee"],
  ["sale", "sale_agency_income"],
  ["sale", "sale_other_income"],
  ["sale", "sale_registration_fee"],
])(
  "null-unit %s/%s uses only its exact contract source and retains project checks",
  async (domain, sourceType) => {
    const f = await seed(),
      contract = randomUUID();
    await owner();
    if (domain === "lease")
      await db.query(
        "insert into lease_contracts(id,unit_id,customer_id,contract_no,payment_cycle,payment_day,monthly_rent_xof,status,start_date,expected_end_date) values($1,$2,$3,$4,'monthly',1,100,'active','2026-08-01','2027-07-31')",
        [contract, f.unit, f.customer, contract],
      );
    else
      await db.query(
        "insert into sale_contracts(id,unit_id,customer_id,contract_no,signed_date,total_amount_xof,payment_plan_type,status) values($1,$2,$3,$4,'2026-08-01',1000,'lump_sum','active')",
        [contract, f.unit, f.customer, contract],
      );
    await db.query("update payments set unit_id=null,source_type=$1,source_id=$2 where id=$3", [
      sourceType,
      contract,
      f.payment,
    ]);
    await login(f.actor);
    const initial = await read(f.payment);
    expect(initial.unitId).toBe(f.unit);
    expect(
      (
        await confirm(f.payment, {
          expectedToken: initial.token,
          collectorName: "颖",
          collectorBasis: "Synthetic explicit contract source",
        })
      ).actualCollector,
    ).toBe("颖");
    await owner();
    await db.query("update projects set access_mode='restricted' where id=$1", [f.project]);
    await login(f.actor);
    await expect(read(f.payment)).rejects.toThrow("paymentContextPermissionDenied");
    await expect(
      confirm(f.payment, {
        expectedToken: initial.token,
        collectorName: "颖",
        collectorBasis: "Denied after project restriction",
      }),
    ).rejects.toThrow("paymentContextPermissionDenied");
  },
);

it("shared fee source collisions across different lease/sale units remain denied, not guessed", async () => {
  const f = await seed(),
    other = await seed(),
    contract = randomUUID();
  await owner();
  await db.query(
    "insert into lease_contracts(id,unit_id,customer_id,contract_no,payment_cycle,payment_day,monthly_rent_xof,status,start_date,expected_end_date) values($1,$2,$3,$4,'monthly',1,100,'active','2026-08-01','2027-07-31')",
    [contract, f.unit, f.customer, contract],
  );
  await db.query(
    "insert into sale_contracts(id,unit_id,customer_id,contract_no,signed_date,total_amount_xof,payment_plan_type,status) values($1,$2,$3,$4,'2026-08-01',1000,'lump_sum','active')",
    [contract, other.unit, other.customer, contract],
  );
  await db.query(
    "update payments set unit_id=null,source_type='property_fee',source_id=$1 where id=$2",
    [contract, f.payment],
  );
  await login(f.actor);
  await expect(read(f.payment)).rejects.toThrow("paymentContextPermissionDenied");
  await expect(
    confirm(f.payment, {
      expectedToken: "a".repeat(32),
      collectorName: "颖",
      collectorBasis: "Ambiguous source",
    }),
  ).rejects.toThrow("paymentContextPermissionDenied");
});

it("missing shared-fee contract links do not resolve by customer, date or amount", async () => {
  const f = await seed();
  await owner();
  await db.query(
    "update payments set unit_id=null,source_type='parking_fee',source_id=$1 where id=$2",
    [randomUUID(), f.payment],
  );
  await login(f.actor);
  await expect(read(f.payment)).rejects.toThrow("paymentContextPermissionDenied");
  await expect(
    confirm(f.payment, {
      expectedToken: "a".repeat(32),
      collectorName: "颖",
      collectorBasis: "No exact source link",
    }),
  ).rejects.toThrow("paymentContextPermissionDenied");
});
