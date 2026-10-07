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
  // A second same-date/same-amount receivable must not change the explicit association.
  const duplicate = (
    await db.query(
      `insert into public.receivables(building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof)
    select building_id,unit_id,customer_id,source_type,source_id,category,'Unlinked duplicate',due_date,amount_xof from receivables where id=$1 returning id`,
      [linked.receivable_id],
    )
  ).rows[0].id;
  await db.query("set role authenticated");
  await db.query("select finance_operation_rpc('sale_payment',$1,$2)", [
    { contractId: contract, scheduleId: schedule.id, amount: 10, paymentDate: "2026-10-06" },
    randomUUID(),
  ]);
  const batch = {
    requestId: randomUUID(),
    protocolVersion: "1.0",
    connectorVersion: "0.5.0",
    originalInstruction: "Synthetic linked sale receipt",
    totalXof: 20,
    rows: [
      {
        lineId: "1",
        sourceText: "Synthetic",
        domain: "sale",
        targetId: contract,
        totalXof: 20,
        paymentDate: "2026-10-06",
        paymentMethod: "cash",
        allocations: [{ receivableId: linked.receivable_id, amountXof: 20 }],
      },
    ],
  };
  const preview = (await db.query("select public.preview_operator_collection($1) result", [batch]))
    .rows[0].result;
  const draft = (
    await db.query(
      "select public.create_operator_collection($1,$2,now()+interval '5 minutes','test') result",
      [JSON.stringify(batch), JSON.stringify(preview)],
    )
  ).rows[0].result;
  expect(
    (await db.query("select public.confirm_operator_collection($1) result", [draft.id])).rows[0]
      .result.verified,
  ).toBe(true);
  expect(
    (await db.query("select paid_amount_xof from receivables where id=$1", [linked.receivable_id]))
      .rows[0].paid_amount_xof,
  ).toBe("80.00");
  expect(
    (await db.query("select paid_amount_xof from receivables where id=$1", [duplicate])).rows[0]
      .paid_amount_xof,
  ).toBe("0.00");
  await db.query("reset role");
});
it("lease creation rejects separately locked sold units", async () => {
  const f = await asset("sold");
  await db.query("update units set operational_condition='locked' where id=$1", [f.unit]);
  await db.query("set role authenticated");
  try {
    await expect(
      db.query("select private.lease_lifecycle('create',$1,$2)", [
        { unitId: f.unit },
        randomUUID(),
      ]),
    ).rejects.toThrow("leaseUnitNotOperational");
  } finally {
    await db.query("reset role");
  }
});
it("aggregate sale components settle only when every approved component is paid", async () => {
  await db.query("reset role");
  const f = await asset("sold"),
    contract = randomUUID(),
    schedule = randomUUID();
  await db.query(
    "insert into sale_contracts(id,unit_id,customer_id,contract_no,signed_date,total_amount_xof,payment_plan_type,status) values($1,$2,$3,$4,'2020-01-01',110,'Legacy split settlement','active')",
    [contract, f.unit, f.customer, contract],
  );
  await db.query(
    "insert into sale_payment_schedule(id,sale_contract_id,installment_no,due_date,amount_xof,status) values($1,$2,1,'2020-01-01',110,'overdue')",
    [schedule, contract],
  );
  const ids: string[] = [];
  for (const [amount, paid, category] of [
    [60, 60, "sale_lump_sum"],
    [40, 0, "sale_lump_sum"],
    [10, 10, "other"],
  ] as const) {
    const id = (
      await db.query(
        "insert into receivables(building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,status) values($1,$2,$3,'sale_contract',$4,$5,'Synthetic','2021-01-01',$6,$7,$8) returning id",
        [
          f.building,
          f.unit,
          f.customer,
          contract,
          category,
          amount,
          paid,
          paid === amount ? "paid" : "overdue",
        ],
      )
    ).rows[0].id;
    ids.push(id);
    await db.query(
      "insert into sale_schedule_components(schedule_id,receivable_id,basis,request_id) values($1,$2,$3,$4)",
      [
        schedule,
        id,
        category === "other" ? "approved_contract_settlement_credit" : "principal",
        randomUUID(),
      ],
    );
  }
  expect(
    (await db.query("select private.sale_components_valid($1) valid", [schedule])).rows[0].valid,
  ).toBe(true);
  await db.query("set role authenticated");
  try {
    await expect(
      db.query("select finance_operation_rpc('sale_payment',$1,$2)", [
        { contractId: contract, scheduleId: schedule, amount: 20, paymentDate: "2026-10-07" },
        randomUUID(),
      ]),
    ).rejects.toThrow("ambiguousSaleReceivable");
    for (const expected of ["overdue", "paid"]) {
      const batch = {
        requestId: randomUUID(),
        protocolVersion: "1.0",
        connectorVersion: "0.5.0",
        originalInstruction: "Synthetic split receipt",
        totalXof: 20,
        rows: [
          {
            lineId: "1",
            sourceText: "Synthetic",
            domain: "sale",
            targetId: contract,
            totalXof: 20,
            paymentDate: "2026-10-07",
            paymentMethod: "cash",
            allocations: [{ receivableId: ids[1], amountXof: 20 }],
          },
        ],
      };
      const preview = (await db.query("select preview_operator_collection($1) result", [batch]))
        .rows[0].result;
      const draft = (
        await db.query(
          "select create_operator_collection($1,$2,now()+interval '5 minutes','test') result",
          [JSON.stringify(batch), JSON.stringify(preview)],
        )
      ).rows[0].result;
      expect(
        (await db.query("select confirm_operator_collection($1) result", [draft.id])).rows[0].result
          .verified,
      ).toBe(true);
      expect(
        (await db.query("select status from sale_payment_schedule where id=$1", [schedule])).rows[0]
          .status,
      ).toBe(expected);
    }
    expect(
      (await db.query("select paid_amount_xof from receivables where id=$1", [ids[2]])).rows[0]
        .paid_amount_xof,
    ).toBe("10.00");
    await expect(
      db.query(
        "insert into sale_schedule_components(schedule_id,receivable_id,basis,request_id) values($1,$2,'principal',$3)",
        [schedule, randomUUID(), randomUUID()],
      ),
    ).rejects.toThrow("permission denied");
  } finally {
    await db.query("reset role");
  }
});
it("legacy sale notes use the existing unique principal receivable, not an invented plan", async () => {
  await db.query("reset role");
  const f = await asset("sold"),
    contract = randomUUID(),
    schedule = randomUUID();
  await db.query(
    "insert into sale_contracts(id,unit_id,customer_id,contract_no,signed_date,total_amount_xof,payment_plan_type,status) values($1,$2,$3,$4,'2020-01-01',100,'Legacy payment note','active')",
    [contract, f.unit, f.customer, contract],
  );
  await db.query(
    "insert into sale_payment_schedule(id,sale_contract_id,installment_no,due_date,amount_xof,status) values($1,$2,1,'2020-01-01',100,'overdue')",
    [schedule, contract],
  );
  const insert = `insert into receivables(unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof) values($1,$2,'sale_contract',$3,$4,'Synthetic','2020-01-01',100) returning id`;
  // A tax/other line is never a principal candidate even when date and amount match.
  await db.query(insert, [f.unit, f.customer, contract, "other"]);
  const receipt = (await db.query(insert, [f.unit, f.customer, contract, "sale_lump_sum"])).rows[0]
    .id;
  expect(
    (await db.query("select receivable_id from sale_payment_schedule where id=$1", [schedule]))
      .rows[0].receivable_id,
  ).toBe(receipt);
  await db.query("set role authenticated");
  try {
    await db.query("select finance_operation_rpc('sale_payment',$1,$2)", [
      { contractId: contract, scheduleId: schedule, amount: 10, paymentDate: "2026-10-07" },
      randomUUID(),
    ]);
    expect(
      (await db.query("select paid_amount_xof from receivables where id=$1", [receipt])).rows[0]
        .paid_amount_xof,
    ).toBe("10.00");
  } finally {
    await db.query("reset role");
  }
  expect(
    (await db.query("select payment_plan_type from sale_contracts where id=$1", [contract])).rows[0]
      .payment_plan_type,
  ).toBe("Legacy payment note");
  expect(
    (
      await db.query(
        "select private.sale_principal_category_matches('lump_sum','sale_installment') allowed",
      )
    ).rows[0].allowed,
  ).toBe(false);
  // Unrecognized plans with TWO principal candidates remain ambiguous, never auto-linked.
  await db.query("update sale_payment_schedule set receivable_id=null where id=$1", [schedule]);
  await db.query(insert, [f.unit, f.customer, contract, "sale_installment"]);
  expect(
    (await db.query("select receivable_id from sale_payment_schedule where id=$1", [schedule]))
      .rows[0].receivable_id,
  ).toBeNull();
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
    (await db.query("select public.operator_task_inbox() result")).rows[0].result.items.filter(
      (item: { id: string }) => item.id === id,
    ),
  ).toHaveLength(0);
  await db.query("reset role");
});
