import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import type { CollectionRequest } from "@/features/business-actions/operator-batch";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";

let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  // Include the actual reference trigger, allocations and audit/context guards.
  // The older collection-only fixture predates these schema overlays.
  await installApplicationRebuild(db);
}, 45000);
afterAll(async () => {
  await cluster?.close();
});

async function owner(sql: string, args: unknown[] = []) {
  await db.query("reset role");
  return db.query(sql, args);
}
async function login(actor: string) {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: "authenticated", email: `${actor}@test.invalid` }),
  ]);
  await db.query("set role authenticated");
}
async function seed() {
  const f = {
    actor: randomUUID(),
    project: randomUUID(),
    building: randomUUID(),
    unit: randomUUID(),
    customer: randomUUID(),
    lease: randomUUID(),
    rent: randomUUID(),
    deposit: randomUUID(),
    fee: randomUUID(),
  };
  await owner("insert into auth.users(id,email) values($1,$2)", [
    f.actor,
    `${f.actor}@test.invalid`,
  ]);
  await db.query("insert into user_profiles(id,role,display_name) values($1,'admin','Synthetic')", [
    f.actor,
  ]);
  await db.query(
    "insert into projects(id,code,display_name,allows_long_lease,allows_daily_rental,allows_sale) values($1::uuid,$1::text,'Synthetic',true,true,true)",
    [f.project],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name) values($1::uuid,$2,$1::text,'Synthetic')",
    [f.building, f.project],
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status) values($1::uuid,$2,$1::text,'1101','11','leased')",
    [f.unit, f.building],
  );
  await db.query("insert into customers(id,name) values($1,'Synthetic customer')", [f.customer]);
  await db.query(
    `insert into lease_contracts(id,unit_id,customer_id,contract_no,payment_cycle,payment_day,
      monthly_rent_xof,deposit_amount_xof,status,start_date,expected_end_date)
     values($1::uuid,$2,$3,$1::text,'monthly',1,600000,1200000,'active','2026-10-01','2027-09-30')`,
    [f.lease, f.unit, f.customer],
  );
  for (const [id, category, amount] of [
    [f.rent, "lease_rent", 600000],
    [f.deposit, "lease_deposit", 1200000],
    [f.fee, "property_fee", 40000],
  ]) {
    await db.query(
      `insert into receivables(id,building_id,unit_id,customer_id,source_type,source_id,
        category,title,due_date,amount_xof,status)
       values($1,$2,$3,$4,'lease_contract',$5,$6,'Synthetic due','2026-10-01',$7,'pending')`,
      [id, f.building, f.unit, f.customer, f.lease, category, amount],
    );
  }
  await login(f.actor);
  return f;
}
function request(f: Awaited<ReturnType<typeof seed>>, receiptNo?: string): CollectionRequest {
  return {
    requestId: randomUUID(),
    protocolVersion: "1.0",
    connectorVersion: "0.8.0",
    originalInstruction: "Synthetic combined rent, deposit and property fee",
    totalXof: 1840000,
    rows: [
      {
        lineId: "1",
        sourceText: "Synthetic receipt",
        domain: "lease",
        targetId: f.lease,
        totalXof: 1840000,
        paymentDate: "2026-10-26",
        paymentMethod: "cash",
        paidThroughDate: "2026-10-31",
        ...(receiptNo === undefined ? {} : { receiptNo }),
        allocations: [
          { receivableId: f.rent, amountXof: 600000 },
          { receivableId: f.deposit, amountXof: 1200000 },
          { receivableId: f.fee, amountXof: 40000 },
        ],
      },
    ],
  };
}
async function draft(input: CollectionRequest) {
  const snapshot = (await db.query("select public.preview_operator_collection($1) v", [input]))
    .rows[0].v;
  return (
    await db.query(
      "select public.create_operator_collection($1,$2,clock_timestamp()+interval '9 minutes','native') v",
      [JSON.stringify(input), JSON.stringify(snapshot)],
    )
  ).rows[0].v;
}
async function confirm(id: string) {
  return (await db.query("select public.confirm_operator_collection($1) v", [id])).rows[0].v;
}
async function paymentEvidence(f: Awaited<ReturnType<typeof seed>>) {
  return (
    await owner(
      `select p.id,p.source_type,p.receipt_no,p.external_receipt_no,p.recorded_by,
      private.payment_reference_prefix(p.unit_id,p.source_type,p.payment_date,p.source_id) prefix,
      (select count(*)::int from ledger_entries l where l.payment_id=p.id) ledger,
      (select count(*)::int from payment_receivable_allocations a where a.payment_id=p.id) allocations,
      (select count(*)::int from audit_logs a where a.action='operator_collection_item'
        and a.actor_id=$2 and a.metadata->>'payment_id'=p.id::text) audit
     from payments p where p.unit_id=$1 order by p.source_type`,
      [f.unit, f.actor],
    )
  ).rows;
}

it("reproduces the old verifier rollback and recovers the same pending request after the repair", async () => {
  const f = await seed(),
    input = request(f),
    d = await draft(input);
  const repaired = (
    await owner(
      "select pg_get_functiondef('private.verify_operator_collection(private.operator_collection_batches)'::regprocedure) definition",
    )
  ).rows[0].definition;
  const migration = readFileSync(
    "supabase/migrations/20260922171433_operator_batch_collections.sql",
    "utf8",
  );
  const start = migration.indexOf("create function private.verify_operator_collection(");
  const end = migration.indexOf("create function private.confirm_operator_collection(", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  try {
    await owner(
      migration.slice(start, end).replace("create function", "create or replace function"),
    );
    await login(f.actor);
    await expect(confirm(d.id)).rejects.toThrow("collectionResultInvalid");
    expect(await paymentEvidence(f)).toHaveLength(0);
    expect(
      (
        await db.query(
          "select sum(paid_amount_xof)::text amount from receivables where source_id=$1",
          [f.lease],
        )
      ).rows[0].amount,
    ).toBe("0.00");
    expect(
      (
        await db.query(
          "select status,request_id from private.operator_collection_batches where id=$1",
          [d.id],
        )
      ).rows[0],
    ).toEqual({ status: "pending", request_id: input.requestId });
    expect(
      (
        await db.query(
          "select count(*)::int n from audit_logs where actor_id=$1 and action='operator_collection_item'",
          [f.actor],
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await owner(repaired);
  }
  await login(f.actor);
  expect(await confirm(d.id)).toMatchObject({
    status: "completed",
    verified: true,
    requestId: input.requestId,
  });
  expect(await paymentEvidence(f)).toHaveLength(3);
});

it.each([undefined, "  0017574  ", "system-shaped"])(
  "posts combined lease entries with generated references and external receipt %s, then replays once",
  async (receipt) => {
    const f = await seed();
    let expectedReceipt = receipt?.trim() ?? null;
    if (receipt === "system-shaped") {
      expectedReceipt = (
        await owner(
          "select private.payment_reference_prefix($1,'lease_rent','2026-10-26',$2)||'-99' value",
          [f.unit, f.lease],
        )
      ).rows[0].value;
      await login(f.actor);
    }
    const input = request(f, receipt === "system-shaped" ? expectedReceipt! : receipt);
    const d = await draft(input),
      result = await confirm(d.id);
    expect(result).toMatchObject({ status: "completed", verified: true, totalXof: 1840000 });
    expect(result.items).toHaveLength(3);
    expect(await confirm(d.id)).toEqual(result);
    expect(
      (await db.query("select public.find_operator_collection($1) v", [input.requestId])).rows[0].v,
    ).toMatchObject({ id: d.id, status: "completed", verified: true });
    const payments = await paymentEvidence(f);
    expect(payments).toHaveLength(3);
    for (const p of payments) {
      expect(p.receipt_no).toBe(`${p.prefix}-01`);
      expect(p.external_receipt_no).toBe(expectedReceipt);
      expect(p.recorded_by).toBe(f.actor);
      expect(p).toMatchObject({ ledger: 1, allocations: 1, audit: 1 });
    }
    expect(
      (
        await db.query(
          "select paid_through_date::text,deposit_received from lease_contracts where id=$1",
          [f.lease],
        )
      ).rows[0],
    ).toEqual({ paid_through_date: "2026-10-31", deposit_received: true });
    expect(
      (
        await db.query(
          "select count(*)::int n from receivables where source_id=$1 and status='paid'",
          [f.lease],
        )
      ).rows[0].n,
    ).toBe(3);
    expect(
      (
        await db.query(
          "select direction,amount_xof::text from ledger_entries l join payments p on p.id=l.payment_id where p.source_id=$1 and p.source_type='lease_deposit'",
          [f.lease],
        )
      ).rows[0],
    ).toEqual({ direction: "liability_in", amount_xof: "1200000.00" });
  },
);

it.each([undefined, "SOURCE-DAILY-SALE"])(
  "keeps daily and sale receipt semantics in a mixed batch with receipt %s",
  async (receiptNo) => {
    const f = await seed(),
      booking = randomUUID(),
      sale = randomUUID(),
      dailyDue = randomUUID(),
      saleDue = randomUUID();
    await owner(
      `insert into daily_bookings(id,unit_id,customer_id,booking_agent_id,check_in,check_out,
        nightly_price_xof,total_amount_xof,final_amount_xof,status)
       values($1,$2,$3,$3,'2026-10-20','2026-10-23',10000,30000,30000,'checked_out')`,
      [booking, f.unit, f.customer],
    );
    await db.query(
      `insert into sale_contracts(id,unit_id,customer_id,contract_no,signed_date,total_amount_xof,
        payment_plan_type,status) values($1::uuid,$2,$3,$1::text,'2026-01-01',1000000,'installment','active')`,
      [sale, f.unit, f.customer],
    );
    for (const [id, source, target, category, amount] of [
      [dailyDue, "daily_booking", booking, "daily_rental", 30000],
      [saleDue, "sale_contract", sale, "sale_installment", 1000000],
    ]) {
      await db.query(
        `insert into receivables(id,building_id,unit_id,customer_id,source_type,source_id,category,title,
          due_date,amount_xof,status) values($1,$2,$3,$4,$5,$6,$7,'Synthetic due','2026-10-20',$8,'pending')`,
        [id, f.building, f.unit, f.customer, source, target, category, amount],
      );
    }
    await db.query(
      "insert into sale_payment_schedule(sale_contract_id,installment_no,due_date,amount_xof,receivable_id) values($1,1,'2026-10-20',1000000,$2)",
      [sale, saleDue],
    );
    const input = request(f, receiptNo),
      receipt = receiptNo === undefined ? {} : { receiptNo };
    input.rows.push(
      {
        lineId: "2",
        sourceText: "Synthetic daily",
        domain: "daily",
        targetId: booking,
        totalXof: 10000,
        paymentDate: "2026-10-26",
        paymentMethod: "cash",
        ...receipt,
        allocations: [{ receivableId: dailyDue, amountXof: 10000 }],
      },
      {
        lineId: "3",
        sourceText: "Synthetic sale",
        domain: "sale",
        targetId: sale,
        totalXof: 500000,
        paymentDate: "2026-10-26",
        paymentMethod: "check",
        ...receipt,
        allocations: [{ receivableId: saleDue, amountXof: 500000 }],
      },
    );
    input.totalXof += 510000;
    await login(f.actor);
    const d = await draft(input),
      result = await confirm(d.id);
    expect(result).toMatchObject({ status: "completed", verified: true });
    expect(result.items).toHaveLength(5);
    expect(await confirm(d.id)).toEqual(result);
    const payments = await paymentEvidence(f);
    expect(payments).toHaveLength(5);
    for (const source of ["daily_booking", "sale"]) {
      expect(payments.find((p) => p.source_type === source)).toMatchObject({
        receipt_no: receiptNo ?? null,
        external_receipt_no: null,
        prefix: null,
        ledger: 1,
        allocations: 1,
        audit: 1,
      });
    }
    expect(
      (
        await db.query("select prepaid_amount_xof::text amount from daily_bookings where id=$1", [
          booking,
        ])
      ).rows[0].amount,
    ).toBe("10000.00");
    expect(
      (
        await db.query("select paid_amount_xof::text amount from receivables where id=$1", [
          saleDue,
        ])
      ).rows[0].amount,
    ).toBe("500000.00");
    expect(
      (await db.query("select status from sale_payment_schedule where sale_contract_id=$1", [sale]))
        .rows[0].status,
    ).not.toBe("paid");
  },
);

it("rejects completed replay when preserved external receipt evidence changes", async () => {
  const f = await seed(),
    d = await draft(request(f, "EXTERNAL-ORIGINAL"));
  await confirm(d.id);
  await owner(
    "update payments set external_receipt_no='ALTERED' where source_id=$1 and source_type='lease_rent'",
    [f.lease],
  );
  await login(f.actor);
  await expect(confirm(d.id)).rejects.toThrow("collectionResultInvalid");
  expect(await paymentEvidence(f)).toHaveLength(3);
});
