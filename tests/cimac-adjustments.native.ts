import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import {
  decodeCimacCollectionPosition,
  decodeCimacWriteResult,
  parseCimacRefundInput,
} from "../src/features/finance/cimac-billing-service";
import { decodeCimacCustomerAccount } from "../src/features/finance/cimac-billing-model";

const migration = "20261024232058_cimac_customer_collection_adjustments.sql";
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
const admin = randomUUID(),
  finance = randomUUID(),
  boss = randomUUID(),
  denied = randomUUID();
let project: string, building: string, preserved: boolean;
const today = new Date().toISOString().slice(0, 10);
async function owner(sql: string, args: unknown[] = []) {
  await db.query("reset role");
  return db.query(sql, args);
}
async function login(actor = admin, client = db) {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: "authenticated" }),
  ]);
  await client.query("set role authenticated");
}
async function rpc(name: string, input: unknown, id = randomUUID(), actor = admin, client = db) {
  await login(actor, client);
  return (await client.query(`select ${name}($1,$2) value`, [input, id])).rows[0].value;
}
async function position(id: string, actor = admin) {
  await login(actor);
  const value = (await db.query("select cimac_collection_position_rpc($1) value", [id])).rows[0]
    .value;
  expect(() => decodeCimacCollectionPosition(value, id)).not.toThrow();
  return value;
}
async function seed(customer = randomUUID()) {
  const unit = randomUUID(),
    contract = randomUUID(),
    receivable = randomUUID();
  await owner(
    "insert into customers(id,name) values($1,'Synthetic adjustment customer') on conflict do nothing",
    [customer],
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,kind,status) values($1::uuid,$2,$1::text,$1::text,'G','storefront','leased')",
    [unit, building],
  );
  await db.query(
    "insert into lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,status) values($1::uuid,$2,$3,$1::text,current_date-30,current_date+365,'monthly',1,100000,'active')",
    [contract, unit, customer],
  );
  await db.query(
    "insert into receivables(id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,currency,status,management_status) values($1,$2,$3,$4,'lease_contract',$5,'lease_rent','Synthetic adjustment rent',current_date-1,100000,0,'XOF','pending','managed')",
    [receivable, building, unit, customer, contract],
  );
  return { customer, unit, contract, receivable };
}
async function collect(two = true, paymentDate = today) {
  const first = await seed(),
    second = two ? await seed(first.customer) : null;
  const f = second ? [first, second] : [first];
  const rs = (
    await owner(
      "select id,updated_at::text from receivables where id=any($1::uuid[]) order by id",
      [f.map((x) => x.receivable)],
    )
  ).rows;
  const result = await rpc("cimac_collect_customer_rpc", {
    customerId: first.customer,
    paymentDate,
    currency: "XOF",
    amount: String(f.length * 100000),
    paymentMethod: "bank_transfer",
    allocations: rs.map((r) => ({
      receivableId: r.id,
      amount: "100000",
      expectedOutstanding: "100000",
      expectedUpdatedAt: r.updated_at,
    })),
  });
  return { f, paymentId: result.paymentId as string, customer: first.customer };
}
function adjustment(p: any, kind: "refund" | "reversal", amounts?: number[]) {
  const shares = p.allocations
    .map((a: any, i: number) => ({
      receivableId: a.receivableId,
      amount: String(amounts?.[i] ?? Number(a.remainingAmount)),
      expectedRemaining: a.remainingAmount,
      expectedPaid: a.paidAmount,
      expectedUpdatedAt: a.updatedAt,
    }))
    .filter((a: any) => Number(a.amount) > 0);
  return {
    originalPaymentId: p.originalPaymentId,
    customerId: p.customerId,
    currency: "XOF",
    amount: String(shares.reduce((a: number, b: any) => a + Number(b.amount), 0)),
    reason: kind === "refund" ? "Synthetic actual refund" : "Synthetic wrong receipt",
    expectedPositionToken: p.positionToken,
    allocations: shares,
    ...(kind === "refund" ? { paymentDate: today, paymentMethod: "cash" } : {}),
  };
}
const snapshot =
  "select md5(jsonb_build_object('customers',(select jsonb_agg(to_jsonb(x) order by id) from customers x),'leases',(select jsonb_agg(to_jsonb(x) order by id) from lease_contracts x),'receivables',(select jsonb_agg(to_jsonb(x) order by id) from receivables x),'payments',(select jsonb_agg(to_jsonb(x) order by id) from payments x),'ledger',(select jsonb_agg(to_jsonb(x) order by id) from ledger_entries x),'allocations',(select jsonb_agg(to_jsonb(x) order by payment_id,receivable_id) from payment_receivable_allocations x),'journal',(select jsonb_agg(to_jsonb(x) order by request_id) from private.cimac_billing_requests x))::text) hash";
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await installApplicationRebuild(db, { beforeMigration: migration });
  for (const [id, role] of [
    [admin, "admin"],
    [finance, "finance"],
    [boss, "boss"],
    [denied, "front_desk"],
  ]) {
    await db.query("insert into auth.users(id,email) values($1::uuid,$1::text||'@test.invalid')", [
      id,
    ]);
    await db.query("insert into user_profiles(id,role,display_name) values($1,$2,$3)", [
      id,
      role,
      role,
    ]);
  }
  project = (
    await db.query(
      "insert into projects(code,display_name,allows_long_lease) values('CIMAC','Synthetic CIMAC',true) returning id",
    )
  ).rows[0].id;
  building = (
    await db.query(
      "insert into buildings(project_id,code,display_name) values($1,'A','Synthetic') returning id",
      [project],
    )
  ).rows[0].id;
  await collect();
  const before = (await owner(snapshot)).rows[0].hash;
  try {
    await db.query(await readFile(`supabase/migrations/${migration}`, "utf8"));
  } catch (error) {
    throw new Error(JSON.stringify(error));
  }
  preserved = (await owner(snapshot)).rows[0].hash === before;
}, 45000);
afterAll(async () => {
  await cluster?.close();
});

it("installs additively, preserves old facts and locks down new relations/functions", async () => {
  expect(preserved).toBe(true);
  expect(
    (
      await owner(
        "select has_function_privilege('anon','public.cimac_refund_collection_rpc(jsonb,uuid)','execute') anon,has_function_privilege('service_role','public.cimac_reverse_collection_rpc(jsonb,uuid)','execute') service",
      )
    ).rows[0],
  ).toEqual({ anon: false, service: false });
  await login();
  await expect(
    db.query("select * from private.cimac_collection_adjustments"),
  ).rejects.toMatchObject({ code: "42501" });
});
it("keeps an ordinary legacy receipt with NULL request_kind insertable/updateable", async () => {
  const f = await seed();
  const p = (
    await owner(
      "insert into payments(customer_id,unit_id,source_type,source_id,payment_date,amount,currency) values($1,$2,'lease_deposit',$3,current_date,1,'XOF') returning id",
      [f.customer, f.unit, f.contract],
    )
  ).rows[0].id;
  await db.query("update payments set notes='Synthetic legacy note' where id=$1", [p]);
  expect(
    (await db.query("select request_kind,notes from payments where id=$1", [p])).rows[0],
  ).toEqual({ request_kind: null, notes: "Synthetic legacy note" });
  const ledger = (
    await db.query(
      "insert into ledger_entries(building_id,unit_id,entry_date,direction,category,amount_xof,currency) values($1,$2,current_date,'income','lease_rent',1,'XOF') returning id",
      [building, f.unit],
    )
  ).rows[0].id;
  await db.query(
    "update ledger_entries set description='Synthetic standalone ledger' where id=$1",
    [ledger],
  );
  await db.query("delete from ledger_entries where id=$1", [ledger]);
});
it("records two actual refunds, restores receivables and preserves original receipt/ledger/allocations", async () => {
  const c = await collect();
  const original = (
    await owner(
      "select jsonb_build_object('p',(select to_jsonb(p) from payments p where id=$1),'l',(select jsonb_agg(to_jsonb(l) order by id) from ledger_entries l where payment_id=$1),'a',(select jsonb_agg(to_jsonb(a) order by receivable_id) from payment_receivable_allocations a where payment_id=$1)) value",
      [c.paymentId],
    )
  ).rows[0].value;
  const p = await position(c.paymentId);
  expect(p.canReverse).toBe(true);
  const id = randomUUID(),
    input = adjustment(p, "refund", [20000, 10000]);
  const one = await rpc("cimac_refund_collection_rpc", input, id, finance);
  expect(() =>
    decodeCimacWriteResult(
      one,
      parseCimacRefundInput({ ...input, requestId: id }),
      "refund",
      finance,
    ),
  ).not.toThrow();
  expect(one).toMatchObject({
    kind: "refund",
    amount: "30000",
    remainingAfter: "170000.00",
    paymentMethod: "cash",
    success: true,
  });
  await login(finance);
  expect(
    (await db.query("select cimac_billing_request_rpc($1) value", [id])).rows[0].value,
  ).toMatchObject({ paymentId: one.paymentId, kind: "refund", idempotent: true });
  await login(admin);
  expect(
    (await db.query("select cimac_billing_request_rpc($1) value", [id])).rows[0].value,
  ).toEqual({ status: "not_found", requestId: id });
  const after = await position(c.paymentId);
  expect(after).toMatchObject({ canReverse: false, canRefund: true, refundedAmount: "30000.00" });
  const two = await rpc("cimac_refund_collection_rpc", adjustment(after, "refund", [10000, 0]));
  expect(two.remainingAfter).toBe("160000.00");
  expect(await rpc("cimac_refund_collection_rpc", input, id, finance)).toMatchObject({
    paymentId: one.paymentId,
    idempotent: true,
  });
  const now = (
    await owner(
      "select jsonb_build_object('p',(select to_jsonb(p) from payments p where id=$1),'l',(select jsonb_agg(to_jsonb(l) order by id) from ledger_entries l where payment_id=$1),'a',(select jsonb_agg(to_jsonb(a) order by receivable_id) from payment_receivable_allocations a where payment_id=$1)) value",
      [c.paymentId],
    )
  ).rows[0].value;
  expect(now).toEqual(original);
  await login();
  expect(
    (
      await db.query("select cimac_customer_collection_proofs_rpc($1) value", [
        [c.paymentId, one.paymentId, two.paymentId],
      ])
    ).rows[0].value.every((x: any) => x.verified),
  ).toBe(true);
  const context = (await db.query("select payment_context_read_rpc($1) value", [one.paymentId]))
    .rows[0].value;
  expect(context).toMatchObject({ allocatedXof: -30000, readOnly: true, unitId: null });
  let projected = 0;
  for (const f of c.f) {
    const projection = (
      await db.query("select cimac_lease_collection_projection_rpc($1) value", [f.contract])
    ).rows[0].value;
    projected += projection.payments.reduce(
      (sum: number, x: any) => sum + Number(x.cimac_contract_allocation.amount),
      0,
    );
  }
  expect(projected).toBe(160000);
  const account = (await db.query("select cimac_customer_account_rpc($1) value", [c.customer]))
    .rows[0].value;
  expect(() => decodeCimacCustomerAccount(account, c.customer)).not.toThrow();
  expect(account.payments.filter((x: any) => x.cimac_adjustment)).toHaveLength(2);
  expect(account.receivables.reduce((n: number, x: any) => n + Number(x.paid_amount_xof), 0)).toBe(
    160000,
  );
  expect(
    (
      await db.query("select cimac_collection_adjustments_rpc($1) value", [
        [one.paymentId, two.paymentId],
      ])
    ).rows[0].value,
  ).toHaveLength(2);
  const reconciliation = (await db.query("select finance_reconciliation_rpc() value")).rows[0]
    .value;
  expect(
    reconciliation.issues.filter((x: any) =>
      [c.paymentId, one.paymentId, two.paymentId].includes(x.entity_id),
    ),
  ).toEqual([]);
  const over = adjustment(await position(c.paymentId), "refund", [100000, 90000]);
  await expect(rpc("cimac_refund_collection_rpc", over)).rejects.toMatchObject({
    message: "cimacBillingInvalidInput",
  });
  await expect(
    rpc("cimac_reverse_collection_rpc", adjustment(await position(c.paymentId), "reversal")),
  ).rejects.toMatchObject({ message: "cimacBillingSnapshotChanged" });
});
it("full wrong-receipt reversal is original-period offset, not actual refund cash", async () => {
  await login();
  const before = (await db.query("select management_operating_snapshot_rpc($1) value", [project]))
    .rows[0].value;
  const day = (await owner("select (current_date-35)::text as date_value")).rows[0].date_value;
  const c = await collect(true, day);
  const input = adjustment(await position(c.paymentId), "reversal");
  const id = randomUUID(),
    result = await rpc("cimac_reverse_collection_rpc", input, id);
  expect(result).toMatchObject({
    kind: "reversal",
    amount: "200000",
    remainingAfter: "0.00",
    paymentDate: day,
    effectiveDate: day,
    paymentMethod: "offset",
  });
  expect(await rpc("cimac_reverse_collection_rpc", input, id)).toMatchObject({
    idempotent: true,
    paymentId: result.paymentId,
  });
  expect((await position(c.paymentId)).canRefund).toBe(false);
  expect(
    (
      await owner(
        "select amount::text,payment_date::text,reversal_of_payment_id from payments where id=$1",
        [result.paymentId],
      )
    ).rows[0],
  ).toEqual({ amount: "-200000.00", payment_date: day, reversal_of_payment_id: c.paymentId });
  expect(
    (
      await db.query(
        "select sum(paid_amount_xof)::text paid from receivables where id=any($1::uuid[])",
        [c.f.map((x) => x.receivable)],
      )
    ).rows[0].paid,
  ).toBe("0.00");
  await login();
  const after = (await db.query("select management_operating_snapshot_rpc($1) value", [project]))
    .rows[0].value;
  expect(after.netCollected).toBe(before.netCollected);
  expect(after.excludedCount).toBe(before.excludedCount);
  expect(after.trend.map((x: any) => [x.month, x.net, x.excluded])).toEqual(
    before.trend.map((x: any) => [x.month, x.net, x.excluded]),
  );
});
it("counts actual refunds as negative income, not expenses, and allows re-collection of restored debt", async () => {
  await login();
  const before = (await db.query("select management_operating_snapshot_rpc($1) value", [project]))
    .rows[0].value;
  const c = await collect(false),
    p = await position(c.paymentId);
  const refund = await rpc("cimac_refund_collection_rpc", adjustment(p, "refund", [20000]));
  await login();
  const after = (await db.query("select management_operating_snapshot_rpc($1) value", [project]))
    .rows[0].value;
  expect(Number(after.netCollected) - Number(before.netCollected)).toBe(80000);
  expect(after.excludedCount).toBe(before.excludedCount);
  expect(
    (
      await owner("select direction,amount_xof::text from ledger_entries where payment_id=$1", [
        refund.paymentId,
      ])
    ).rows,
  ).toEqual([{ direction: "income", amount_xof: "-20000.00" }]);
  const r = (
    await db.query("select updated_at::text from receivables where id=$1", [c.f[0].receivable])
  ).rows[0];
  await rpc("cimac_collect_customer_rpc", {
    customerId: c.customer,
    currency: "XOF",
    amount: "20000",
    paymentDate: today,
    paymentMethod: "cash",
    allocations: [
      {
        receivableId: c.f[0].receivable,
        amount: "20000",
        expectedOutstanding: "20000",
        expectedUpdatedAt: r.updated_at,
      },
    ],
  });
  const pos = await position(c.paymentId);
  expect(pos.allocations[0].paidAmount).toBe("100000.00");
});
it("enforces role, project and exact idempotency payload isolation", async () => {
  const c = await collect(false),
    p = await position(c.paymentId),
    input = adjustment(p, "refund", [1]);
  for (const actor of [boss, denied])
    await expect(
      rpc("cimac_refund_collection_rpc", input, randomUUID(), actor),
    ).rejects.toMatchObject({ code: "42501" });
  const id = randomUUID();
  await rpc("cimac_refund_collection_rpc", input, id);
  await expect(
    rpc("cimac_refund_collection_rpc", { ...input, reason: "Changed" }, id),
  ).rejects.toMatchObject({ message: "cimacBillingRequestIdConflict" });
  await owner("update projects set access_mode='restricted' where id=$1", [project]);
  await db.query(
    "insert into project_account_access(project_id,account_email,account_id) values($1,$2,$3)",
    [project, `${admin}@test.invalid`, admin],
  );
  try {
    await expect(position(c.paymentId, finance)).rejects.toMatchObject({ code: "42501" });
    await expect(
      rpc("cimac_refund_collection_rpc", input, randomUUID(), finance),
    ).rejects.toMatchObject({ code: "42501" });
    await login(finance);
    expect((await db.query("select * from payments where id=$1", [c.paymentId])).rows).toHaveLength(
      0,
    );
    expect(
      (await db.query("select cimac_customer_collection_proof_rpc($1) value", [c.paymentId]))
        .rows[0].value,
    ).toBe(false);
  } finally {
    await owner("update projects set access_mode='open' where id=$1", [project]);
  }
});
it("serializes different request IDs for the same original and never over-refunds", async () => {
  const c = await collect(false),
    input = adjustment(await position(c.paymentId), "refund", [75000]);
  const left = await cluster.connect(),
    right = await cluster.connect();
  try {
    const results = await Promise.allSettled([
      rpc("cimac_refund_collection_rpc", input, randomUUID(), admin, left),
      rpc("cimac_refund_collection_rpc", input, randomUUID(), admin, right),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(
      results
        .filter((x) => x.status === "rejected")
        .map((x) => (x as PromiseRejectedResult).reason.message),
    ).toEqual(["cimacBillingSnapshotChanged"]);
    expect(Number((await position(c.paymentId)).remainingAmount)).toBe(25000);
  } finally {
    await left.end();
    await right.end();
  }
});
it("fails proof on raw-paid or private-journal/ledger tampering and reports reconciliation anomaly", async () => {
  const c = await collect(false);
  await owner("update receivables set paid_amount_xof=0,status='pending' where id=$1", [
    c.f[0].receivable,
  ]);
  await login();
  expect(
    (await db.query("select cimac_customer_collection_proof_rpc($1) value", [c.paymentId])).rows[0]
      .value,
  ).toBe(false);
  await expect(position(c.paymentId)).rejects.toMatchObject({
    message: "cimacBillingVerificationFailed",
  });
  const d = await collect(false),
    result = await rpc(
      "cimac_refund_collection_rpc",
      adjustment(await position(d.paymentId), "refund", [10000]),
    );
  await owner(
    "alter table private.cimac_collection_adjustment_lines disable trigger guard_cimac_adjustment_line",
  );
  await db.query(
    "update private.cimac_collection_adjustment_lines set amount=amount+1 where adjustment_id=(select id from private.cimac_collection_adjustments where payment_id=$1)",
    [result.paymentId],
  );
  await db.query(
    "alter table private.cimac_collection_adjustment_lines enable trigger guard_cimac_adjustment_line",
  );
  await login();
  expect(
    (await db.query("select cimac_customer_collection_proof_rpc($1) value", [result.paymentId]))
      .rows[0].value,
  ).toBe(false);
  const checks = [
    "update private.cimac_billing_requests set result=jsonb_set(result,'{customerId}',to_jsonb(gen_random_uuid()::text)) where request_id=$1",
    "update audit_logs set metadata=jsonb_set(metadata,'{project_id}',to_jsonb(gen_random_uuid()::text)) where id=(select (result->>'auditId')::uuid from private.cimac_billing_requests where request_id=$1)",
    "alter table public.ledger_entries disable trigger guard_cimac_adjustment_ledger; update public.ledger_entries set amount_xof=amount_xof-1 where payment_id=(select (result->>'paymentId')::uuid from private.cimac_billing_requests where request_id=$1); alter table public.ledger_entries enable trigger guard_cimac_adjustment_ledger",
  ];
  for (const sql of checks) {
    const clean = await collect(false),
      request = randomUUID(),
      child = await rpc(
        "cimac_refund_collection_rpc",
        adjustment(await position(clean.paymentId), "refund", [1000]),
        request,
      );
    // All corruption is confined to this fresh disposable native database.
    await owner("begin");
    try {
      if (sql.includes(";")) {
        for (const statement of sql.split(";"))
          await db.query(statement, statement.includes("$1") ? [request] : []);
      } else await db.query(sql, [request]);
      await login();
      expect(
        (await db.query("select cimac_customer_collection_proof_rpc($1) value", [child.paymentId]))
          .rows[0].value,
      ).toBe(false);
      const reconciliation = (await db.query("select finance_reconciliation_rpc() value")).rows[0]
        .value;
      expect(
        reconciliation.issues.some(
          (x: any) =>
            x.entity_id === child.paymentId && x.code === "cimac_customer_collection_mismatch",
        ),
      ).toBe(true);
    } finally {
      await db.query("rollback");
      await db.query("reset role");
    }
  }
});
it("rejects exact INSERT/UPDATE/DELETE bypasses for each protected correction fact", async () => {
  const c = await collect(false),
    result = await rpc(
      "cimac_refund_collection_rpc",
      adjustment(await position(c.paymentId), "refund", [10000]),
    );
  const statements = [
    ["update payments set notes='forged' where id=$1", [result.paymentId]],
    ["delete from payments where id=$1", [result.paymentId]],
    [
      "insert into payments(customer_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,request_kind) values($1,'cimac_customer_refund',$2,current_date,1,'XOF',1,'cimac_customer_refund')",
      [c.customer, c.paymentId],
    ],
    ["update ledger_entries set amount_xof=-1 where payment_id=$1", [result.paymentId]],
    ["delete from ledger_entries where payment_id=$1", [result.paymentId]],
    [
      "insert into ledger_entries(payment_id,building_id,unit_id,entry_date,direction,category,amount_xof,currency) values($1,$2,$3,current_date,'income','lease_rent',-1,'XOF')",
      [result.paymentId, building, c.f[0].unit],
    ],
    [
      "insert into payment_receivable_allocations(payment_id,receivable_id,amount_xof,request_id,actor_id) values($1,$2,1,$3,$4)",
      [result.paymentId, c.f[0].receivable, randomUUID(), admin],
    ],
    [
      "update private.cimac_collection_adjustments set reason='forged' where payment_id=$1",
      [result.paymentId],
    ],
    ["delete from private.cimac_collection_adjustments where payment_id=$1", [result.paymentId]],
    [
      "update private.cimac_collection_adjustment_lines set amount=1 where adjustment_id=(select id from private.cimac_collection_adjustments where payment_id=$1)",
      [result.paymentId],
    ],
    [
      "delete from private.cimac_collection_adjustment_lines where adjustment_id=(select id from private.cimac_collection_adjustments where payment_id=$1)",
      [result.paymentId],
    ],
    [
      "insert into private.cimac_collection_adjustment_lines(adjustment_id,receivable_id,amount,before_paid,before_remaining,before_updated_at) values($1,$2,1,1,1,now())",
      [randomUUID(), c.f[0].receivable],
    ],
    [
      "insert into private.cimac_collection_adjustments(id,request_id,original_payment_id,payment_id,customer_id,kind,amount,payment_date,effective_date,payment_method,reason,actor_id,audit_id) values($1,$2,$3,$4,$5,'refund',1,current_date,current_date,'cash','Forged',$6,$7)",
      [randomUUID(), randomUUID(), c.paymentId, result.paymentId, c.customer, admin, randomUUID()],
    ],
    ["update payment_receivable_allocations set amount_xof=1 where payment_id=$1", [c.paymentId]],
    ["delete from payment_receivable_allocations where payment_id=$1", [c.paymentId]],
  ] as const;
  for (const [sql, args] of statements)
    await expect(owner(sql, [...args])).rejects.toMatchObject({
      code: "42501",
      message: "cimacBillingProtectedPayment",
    });
  // Exercise hypothetical corrupt child allocation UPDATE/DELETE too. Only this
  // disposable native test disables its exact guard to construct the bad row.
  await owner(
    "alter table payment_receivable_allocations disable trigger guard_cimac_adjustment_allocation",
  );
  await db.query(
    "insert into payment_receivable_allocations(payment_id,receivable_id,amount_xof,request_id,actor_id) values($1,$2,1,$3,$4)",
    [result.paymentId, c.f[0].receivable, randomUUID(), admin],
  );
  await db.query(
    "alter table payment_receivable_allocations enable trigger guard_cimac_adjustment_allocation",
  );
  for (const sql of [
    "update payment_receivable_allocations set amount_xof=2 where payment_id=$1",
    "delete from payment_receivable_allocations where payment_id=$1",
  ])
    await expect(db.query(sql, [result.paymentId])).rejects.toMatchObject({
      code: "42501",
      message: "cimacBillingProtectedPayment",
    });
  await db.query(
    "alter table payment_receivable_allocations disable trigger guard_cimac_adjustment_allocation",
  );
  await db.query("delete from payment_receivable_allocations where payment_id=$1", [
    result.paymentId,
  ]);
  await db.query(
    "alter table payment_receivable_allocations enable trigger guard_cimac_adjustment_allocation",
  );
});
