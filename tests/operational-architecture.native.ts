import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>;
let db: Awaited<ReturnType<typeof cluster.connect>>;
const actor = "00000000-0000-4000-8000-000000000001";
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await installApplicationRebuild(db);
  await db.query("insert into auth.users(id,email) values($1,'admin@sacsi.com')", [actor]);
  await db.query(
    "insert into public.user_profiles(id,role,display_name) values($1,'admin','Test')",
    [actor],
  );
}, 45000);
afterAll(async () => {
  await cluster?.close();
});

it("profiles, not email claims, control SQL roles", async () => {
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, email: "front@sacsi.com", role: "authenticated" }),
  ]);
  expect((await db.query("select public.current_user_role() role")).rows[0].role).toBe("admin");
  await db.query("update public.user_profiles set role='front_desk' where id=$1", [actor]);
  expect((await db.query("select public.current_user_role() role")).rows[0].role).toBe(
    "front_desk",
  );
  await db.query("update public.user_profiles set role='admin' where id=$1", [actor]);
});
it("summary and export include all 2550 rows while detail is bounded", async () => {
  await db.query(`insert into public.ledger_entries(entry_date,direction,category,amount_xof)
    select '2026-10-06','income','other_income',100 from generate_series(1,2550)`);
  await db.query("set role authenticated");
  try {
    const result = (await db.query("select public.finance_read_rpc('ledger','{}',2,false) result"))
      .rows[0].result;
    expect(result.total).toBe(2550);
    expect(result.rows).toHaveLength(50);
    expect(result.summary.income).toBe(255000);
    const exported = (await db.query("select public.finance_read_rpc('ledger','{}',1,true) result"))
      .rows[0].result;
    expect(exported.rows).toHaveLength(2550);
    expect(exported.summary).toEqual(result.summary);
    const none = (
      await db.query(
        `select public.finance_read_rpc('ledger','{"dateFrom":"2026-10-07"}',1,false) result`,
      )
    ).rows[0].result;
    expect(none.total).toBe(0);
    expect(none.summary.income).toBe(0);
  } finally {
    await db.query("reset role");
  }
});
it("deposits are cash movement but not operating revenue", async () => {
  await db.query(
    "insert into public.ledger_entries(entry_date,direction,category,amount_xof) values('2026-10-06','liability_in','lease_deposit',200)",
  );
  const result = (await db.query("select public.finance_read_rpc('ledger','{}',1,false) result"))
    .rows[0].result;
  expect(result.summary.income).toBe(255000);
  expect(result.summary.liability_in).toBe(200);
});
it("anonymous users cannot invoke finance reads", async () => {
  expect(
    (
      await db.query(
        "select has_function_privilege('anon','public.finance_read_rpc(text,jsonb,integer,boolean)','execute') allowed",
      )
    ).rows[0].allowed,
  ).toBe(false);
});

async function asset(status = "available") {
  const project = randomUUID(),
    building = randomUUID(),
    unit = randomUUID(),
    customer = randomUUID();
  await db.query("reset role");
  await db.query(
    "insert into projects(id,code,display_name,allows_sale,allows_daily_rental) values($1,$2,'Test',true,true)",
    [project, project],
  );
  await db.query("insert into buildings(id,project_id,code,display_name) values($1,$2,$3,'Test')", [
    building,
    project,
    building,
  ]);
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status,construction_status,occupancy_verified) values($1,$2,$3,'408','4',$4,'operational',true)",
    [unit, building, unit, status],
  );
  await db.query(
    "insert into unit_business_flags(unit_id,business_type,is_enabled) values($1,'daily_rental',true)",
    [unit],
  );
  await db.query("insert into customers(id,name) values($1,'Synthetic')", [customer]);
  return { project, building, unit, customer };
}
it("unit conditions preserve sold ownership and cannot be cleared by stale clients", async () => {
  const f = await asset("sold");
  const version = (await db.query("select updated_at::text from units where id=$1", [f.unit]))
    .rows[0].updated_at;
  await db.query("set role authenticated");
  await db.query("select public.set_unit_condition_rpc($1,'maintenance',$2)", [f.unit, version]);
  const position = (await db.query("select * from unit_operational_position where id=$1", [f.unit]))
    .rows[0];
  expect(position.ownership).toBe("sold");
  expect(position.legacy_status).toBe("sold");
  expect(position.operational_condition).toBe("maintenance");
  expect(position.daily_enabled).toBe(true);
  await expect(
    db.query("select public.set_unit_condition_rpc($1,'normal',$2)", [f.unit, version]),
  ).rejects.toThrow("unitRecordChanged");
  await db.query("reset role");
});
it("a rejected audit insert rolls back the unit condition change", async () => {
  const f = await asset();
  const version = (await db.query("select updated_at::text from units where id=$1", [f.unit]))
    .rows[0].updated_at;
  await db.query(
    "create function private.reject_condition_audit() returns trigger language plpgsql as $$begin raise exception 'injected_audit_failure';end;$$;create trigger reject_condition_audit before insert on audit_logs for each row execute function private.reject_condition_audit()",
  );
  try {
    await db.query("set role authenticated");
    await expect(
      db.query("select public.set_unit_condition_rpc($1,'maintenance',$2)", [f.unit, version]),
    ).rejects.toThrow("injected_audit_failure");
    expect(
      (await db.query("select operational_condition from units where id=$1", [f.unit])).rows[0]
        .operational_condition,
    ).toBe("normal");
  } finally {
    await db.query("reset role");
    await db.query("drop trigger reject_condition_audit on audit_logs");
  }
});
it("new sale installments and receipts have explicit foreign-key identities", async () => {
  const f = await asset("sold"),
    contract = randomUUID();
  const c = (
    await db.query(
      "insert into sale_contracts(id,unit_id,customer_id,contract_no,signed_date,total_amount_xof,payment_plan_type,status) values($1,$2,$3,$4,'2026-01-01',1000,'flexible_installment','active') returning updated_at::text",
      [contract, f.unit, f.customer, contract],
    )
  ).rows[0];
  await db.query("set role authenticated");
  const schedule = (
    await db.query("select finance_operation_rpc('sale_installment',$1,$2) result", [
      {
        contractId: contract,
        expectedUpdatedAt: c.updated_at,
        installmentNo: 1,
        dueDate: "2026-10-06",
        amountXof: 100,
      },
      randomUUID(),
    ])
  ).rows[0].result.data;
  const linked = (
    await db.query("select receivable_id from sale_payment_schedule where id=$1", [schedule.id])
  ).rows[0];
  expect(linked.receivable_id).toBeTruthy();
  const request = randomUUID();
  await db.query("select finance_operation_rpc('sale_payment',$1,$2)", [
    { contractId: contract, scheduleId: schedule.id, amount: 50, paymentDate: "2026-10-06" },
    request,
  ]);
  const allocation = (
    await db.query("select * from payment_receivable_allocations where request_id=$1", [request])
  ).rows[0];
  expect(allocation.receivable_id).toBe(linked.receivable_id);
  expect(allocation.amount_xof).toBe("50.00");
  expect(allocation.actor_id).toBe(actor);
  await db.query("reset role");
});
it("inbox is actor-bound and rechecks project access", async () => {
  const f = await asset(),
    id = randomUUID(),
    other = randomUUID();
  await db.query("insert into auth.users(id,email) values($1,'other@test.invalid')", [other]);
  await db.query("insert into user_profiles(id,role,display_name) values($1,'admin','Other')", [
    other,
  ]);
  for (const [owner, identifier] of [
    [actor, id],
    [other, randomUUID()],
  ])
    await db.query(
      "insert into private.operator_booking_operations(id,request_id,actor_id,unit_id,request_data,expected_snapshot,deployment,expires_at) values($1,$2,$3,$4,$5,'{}','test',now()+interval '5 minutes')",
      [identifier, randomUUID(), owner, f.unit, { operation: "create", unitId: f.unit }],
    );
  await db.query("set role authenticated");
  const inbox = (await db.query("select public.operator_task_inbox() result")).rows[0].result;
  expect(inbox.items.filter((i: { id: string }) => i.id === id)).toHaveLength(1);
  expect(inbox.pending).toBe(1);
  await db.query("reset role");
  await db.query("update projects set access_mode='restricted' where id=$1", [f.project]);
  await db.query("set role authenticated");
  expect(
    (await db.query("select public.operator_task_inbox() result")).rows[0].result.items,
  ).toHaveLength(0);
  await db.query("reset role");
});
