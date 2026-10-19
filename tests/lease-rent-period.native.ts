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
  const f = {
    actor: randomUUID(),
    project: randomUUID(),
    building: randomUUID(),
    unit: randomUUID(),
    customer: randomUUID(),
    contract: randomUUID(),
    payment: randomUUID(),
    paid: randomUUID(),
    auto: randomUUID(),
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
    "insert into units(id,building_id,code,unit_no,floor_label,status) values($1::uuid,$2,$1::text,'TEST','1','leased')",
    [f.unit, f.building],
  );
  await db.query("insert into customers(id,name) values($1,'Synthetic tenant')", [f.customer]);
  await db.query(
    "insert into lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,deposit_amount_xof,status,commencement_state,paid_through_date) values($1::uuid,$2,$3,$1::text,'2026-06-27','2027-06-26','monthly',27,700000,0,'active','started','2026-08-26')",
    [f.contract, f.unit, f.customer],
  );
  await db.query(
    "insert into payments(id,unit_id,customer_id,source_id,source_type,payment_date,amount,currency,exchange_rate_to_xof,payment_method,notes) values($1,$2,$3,$4,'lease_rent','2026-07-27',700000,'XOF',1,'check','Legacy coverage 2026-08-26')",
    [f.payment, f.unit, f.customer, f.contract],
  );
  await db.query(
    "insert into receivables(id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,status,notes) values($1,$2,$3,$4,'lease_contract',$5,'lease_rent','Synthetic paid','2026-07-27',700000,700000,'paid','Legacy period')",
    [f.paid, f.building, f.unit, f.customer, f.contract],
  );
  await db.query(
    "insert into receivables(id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,status,notes) values($1,$2,$3,$4,'lease_contract',$5,'lease_rent','Synthetic automatic','2026-08-27',700000,0,'overdue','根据租金已缴至日期 2026-08-26 自动生成')",
    [f.auto, f.building, f.unit, f.customer, f.contract],
  );
  await db.query(
    "insert into ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,description) values($1,$2,$3,'2026-07-27','income','lease_rent',700000,'Synthetic unchanged ledger')",
    [f.building, f.unit, f.payment],
  );
  await login(f.actor);
  return f;
}
async function review(contract: string) {
  return (await db.query("select public.lease_rent_period_review_rpc($1) v", [contract])).rows[0].v;
}
async function input(f: Awaited<ReturnType<typeof seed>>) {
  return {
    expectedToken: (await review(f.contract)).token,
    paymentId: f.payment,
    receivableId: f.paid,
    paidThroughDate: "2026-06-30",
    reason: "Synthetic explicit owner confirmation",
  };
}
async function correct(contract: string, payload: unknown, id = randomUUID(), client = db) {
  return (
    await client.query("select public.correct_lease_rent_period_rpc($1,$2,$3) v", [
      contract,
      payload,
      id,
    ])
  ).rows[0].v;
}

it("corrects the confirmed end without inventing a start, preserves money, and retires only untouched auto debt", async () => {
  const f = await seed(),
    original = await review(f.contract),
    payload = await input(f),
    id = randomUUID();
  expect((await correct(f.contract, payload, id)).success).toBe(true);
  const after = await review(f.contract);
  expect(after.paidThroughDate).toBe("2026-06-30");
  const beforePayment = original.payments[0],
    afterPayment = after.payments[0];
  expect({ ...afterPayment, notes: beforePayment.notes }).toEqual(beforePayment);
  expect(after.receivables.find((r: { id: string }) => r.id === f.auto).status).toBe("cancelled");
  expect(after.receivables.find((r: { id: string }) => r.id === f.paid)).toMatchObject({
    amount_xof: 700000,
    paid_amount_xof: 700000,
    service_period_start: null,
    service_period_end: "2026-06-30",
  });
  expect(
    after.receivables.find((r: { due_date: string }) => r.due_date === "2026-07-01"),
  ).toMatchObject({ amount_xof: 700000, paid_amount_xof: 0 });
  expect(await correct(f.contract, payload, id)).toEqual(await correct(f.contract, payload, id));
  const workspace = (
    await db.query("select public.contract_workspace_read_rpc('lease',$1,'detail',$2) v", [
      { buildingId: f.building },
      f.contract,
    ])
  ).rows[0].v;
  const accrual = workspace.accruals[f.contract];
  if (accrual?.startedPeriods > 0) expect(accrual.amount).toBe(accrual.startedPeriods * 700000);
  await expect(correct(f.contract, { ...payload, reason: "Changed" }, id)).rejects.toThrow(
    "requestIdConflict",
  );
  await owner();
  expect(
    (
      await db.query(
        "select count(*)::int n from audit_logs where action='correct_lease_rent_period' and entity_id=$1",
        [f.contract],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (await db.query("select amount_xof from ledger_entries where payment_id=$1", [f.payment]))
      .rows[0].amount_xof,
  ).toBe("700000.00");
});

it("then records the separately confirmed cash month without paying the obsolete August bill", async () => {
  const f = await seed();
  await correct(f.contract, await input(f));
  await db.query(
    "select public.record_lease_financial_entry_v2_rpc($1,'rent_income','2026-08-12',700000,'XOF',1,'2026-07-31','cash','Synthetic July rent',null,$2)",
    [f.contract, randomUUID()],
  );
  const after = await review(f.contract);
  expect(after.paidThroughDate).toBe("2026-07-31");
  expect(after.payments).toHaveLength(2);
  expect(
    after.payments.find((p: { payment_method: string }) => p.payment_method === "cash"),
  ).toMatchObject({ payment_date: "2026-08-12", amount: 700000 });
  expect(
    after.receivables
      .filter(
        (r: { status: string; paid_amount_xof: number }) =>
          r.status !== "cancelled" && r.paid_amount_xof === 0,
      )
      .map((r: { due_date: string }) => r.due_date),
  ).toEqual(["2026-08-01"]);
});

it("rejects finance/front-desk identities and inaccessible projects", async () => {
  for (const role of ["finance", "front_desk", "boss"]) {
    const f = await seed(role);
    await expect(review(f.contract)).rejects.toThrow("leasePeriodPermissionDenied");
  }
  const f = await seed("admin", true);
  await expect(review(f.contract)).rejects.toThrow("leasePeriodPermissionDenied");
});

it("rejects stale snapshots, wrong targets, malformed dates and arbitrary edit keys", async () => {
  const f = await seed(),
    payload = await input(f);
  for (const patch of [
    { paymentId: randomUUID() },
    { receivableId: randomUUID() },
    { paidThroughDate: "2026-02-30" },
    { paidThroughDate: "2026-06-01" },
    { amount: 1 },
    { expectedToken: "0".repeat(32) },
  ]) {
    await expect(correct(f.contract, { ...payload, ...patch })).rejects.toThrow();
    expect((await review(f.contract)).paidThroughDate).toBe("2026-08-26");
  }
  await owner();
  await db.query("update lease_contracts set signer_name='Concurrent update' where id=$1", [
    f.contract,
  ]);
  await login(f.actor);
  await expect(correct(f.contract, payload)).rejects.toThrow("leasePeriodChanged");
});

it("refuses manual bills, partial collections and ambiguous additional receipts", async () => {
  for (const scenario of ["manual", "partial", "other_payment"]) {
    const f = await seed();
    await owner();
    if (scenario === "manual")
      await db.query("update receivables set notes='Manual business invoice' where id=$1", [
        f.auto,
      ]);
    if (scenario === "partial")
      await db.query("update receivables set paid_amount_xof=1,status='partial' where id=$1", [
        f.auto,
      ]);
    if (scenario === "other_payment")
      await db.query(
        "insert into payments(unit_id,customer_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof) values($1,$2,'lease_rent',$3,'2026-08-12',700000,'XOF',1)",
        [f.unit, f.customer, f.contract],
      );
    await login(f.actor);
    await expect(correct(f.contract, await input(f))).rejects.toThrow("leasePeriodReviewRequired");
  }
});

it("rolls every change back if audit persistence fails", async () => {
  const f = await seed(),
    payload = await input(f),
    initial = await review(f.contract);
  await owner();
  await db.query(
    "create function private.reject_period_audit() returns trigger language plpgsql as $$ begin if new.action='correct_lease_rent_period' then raise exception 'Synthetic audit failure'; end if; return new; end $$; create trigger reject_period_audit before insert on public.audit_logs for each row execute function private.reject_period_audit()",
  );
  try {
    await login(f.actor);
    await expect(correct(f.contract, payload)).rejects.toThrow("Synthetic audit failure");
    expect(await review(f.contract)).toEqual(initial);
  } finally {
    await owner();
    await db.query(
      "drop trigger reject_period_audit on public.audit_logs; drop function private.reject_period_audit()",
    );
  }
});

it("serializes concurrent corrections and does not expose new functions to anonymous or service role", async () => {
  const f = await seed(),
    payload = await input(f),
    id = randomUUID(),
    other = await cluster.connect();
  await other.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: f.actor, role: "authenticated" }),
  ]);
  await other.query("set role authenticated");
  const results = await Promise.all([
    correct(f.contract, payload, id),
    correct(f.contract, payload, id, other),
  ]);
  expect(results[0]).toEqual(results[1]);
  await owner();
  expect(
    (
      await db.query(
        "select has_function_privilege('anon','public.correct_lease_rent_period_rpc(uuid,jsonb,uuid)','execute') anon, has_function_privilege('service_role','public.correct_lease_rent_period_rpc(uuid,jsonb,uuid)','execute') service,has_table_privilege('authenticated','private.lease_rent_period_requests','select') direct",
      )
    ).rows[0],
  ).toEqual({ anon: false, service: false, direct: false });
});
