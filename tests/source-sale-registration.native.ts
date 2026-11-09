import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { checkNativeAdvisors } from "./helpers/native-advisors";

const migration = "20261107232358_source_sale_registration_native_money.sql";
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  const applied = await installApplicationRebuild(db);
  // Also works once integration adds this migration to the checksum manifest.
  if (!applied.includes(migration))
    await db.query(readFileSync(`supabase/migrations/${migration}`, "utf8"));
}, 45000);
afterAll(async () => {
  try {
    if (process.env.SACSI_SOURCE_SALE_ADVISORS === "1") {
      await db.query("reset role");
      await checkNativeAdvisors(db, cluster.port);
    }
  } finally {
    await cluster?.close();
  }
});

async function owner(sql: string, args: unknown[] = []) {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims','{}',false)");
  return db.query(sql, args);
}
async function seed(currency = "CNY") {
  const project = randomUUID(),
    building = randomUUID(),
    unit = randomUUID(),
    customer = randomUUID(),
    contract = randomUUID(),
    actor = randomUUID();
  await owner("insert into auth.users(id,email) values($1,$2)", [actor, `${actor}@test.invalid`]);
  await db.query("insert into user_profiles(id,role,display_name) values($1,'admin','Synthetic')", [
    actor,
  ]);
  await db.query(
    "insert into projects(id,code,display_name,allows_sale) values($1::uuid,$1::text,'Synthetic',true)",
    [project],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name) values($1::uuid,$2,$1::text,'Synthetic')",
    [building, project],
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status) values($1::uuid,$2,$1::text,'906','9','leased')",
    [unit, building],
  );
  await db.query("insert into customers(id,name) values($1,'Synthetic buyer')", [customer]);
  await db.query(
    `insert into sale_contracts(id,unit_id,customer_id,contract_no,signed_date,total_amount_xof,
    total_amount_confirmed,payment_plan_type,transfer_status,status,registration_basis,source_reference,sale_currency,total_amount_native)
    values($1::uuid,$2,$3,$1::text,null,$4,true,'unconfirmed','unconfirmed','active','source_record',$5,$6,$7)`,
    [
      contract,
      unit,
      customer,
      currency === "XOF" ? 80000000 : 0,
      `sha256:${"a".repeat(64)}|sheet:synthetic|cell:F65`,
      currency,
      currency === "XOF" ? null : 720000,
    ],
  );
  return { project, building, unit, customer, contract, actor };
}
type Fixture = Awaited<ReturnType<typeof seed>>;
async function payment(f: Fixture, extra: Record<string, unknown> = {}) {
  const p = {
    id: randomUUID(),
    unit: f.unit,
    customer: f.customer,
    contract: f.contract,
    currency: "CNY",
    amount: 700000,
    native: true,
    rate: null,
    source: "sale_contract",
    ...extra,
  };
  await db.query(
    `insert into payments(id,unit_id,customer_id,source_id,source_type,payment_date,amount,currency,
    native_settlement,exchange_rate_to_xof,request_id,payment_method)
    values($1,$2,$3,$4,$5,'2026-10-17',$6,$7,$8,$9,$10,null)`,
    [
      p.id,
      p.unit,
      p.customer,
      p.contract,
      p.source,
      p.amount,
      p.currency,
      p.native,
      p.rate,
      randomUUID(),
    ],
  );
  return p.id;
}
async function ledger(f: Fixture, paymentId: string, extra: Record<string, unknown> = {}) {
  const l = {
    id: randomUUID(),
    unit: f.unit,
    building: f.building,
    currency: "CNY",
    native: 700000,
    xof: 0,
    direction: "income",
    category: "sale",
    ...extra,
  };
  await db.query(
    `insert into ledger_entries(id,building_id,unit_id,payment_id,entry_date,direction,category,currency,amount_native,amount_xof)
    values($1,$2,$3,$4,'2026-10-17',$5,$6,$7,$8,$9)`,
    [l.id, l.building, l.unit, paymentId, l.direction, l.category, l.currency, l.native, l.xof],
  );
  return l.id;
}
async function transaction(run: () => Promise<unknown>) {
  await db.query("begin");
  try {
    await run();
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

it("keeps an unknown signing date and native price without fabricating XOF bills or changing occupancy", async () => {
  const f = await seed();
  const row = (
    await db.query(
      `select signed_date,registration_basis,payment_plan_type,transfer_status,sale_currency,total_amount_native::text,total_amount_xof::text,
    (select status::text from units where id=$2) unit_status,
    (select count(*)::int from receivables where source_id=$1) bills,
    (select count(*)::int from sale_payment_schedule where sale_contract_id=$1) schedules
    from sale_contracts where id=$1`,
      [f.contract, f.unit],
    )
  ).rows[0];
  expect(row).toEqual({
    signed_date: null,
    registration_basis: "source_record",
    payment_plan_type: "unconfirmed",
    transfer_status: "unconfirmed",
    sale_currency: "CNY",
    total_amount_native: "720000.00",
    total_amount_xof: "0.00",
    unit_status: "leased",
    bills: 0,
    schedules: 0,
  });
  await expect(
    db.query("update sale_contracts set registration_basis='contract' where id=$1", [f.contract]),
  ).rejects.toThrow("sale_registration_signed_date_valid");
  await expect(
    db.query("update sale_contracts set source_reference='  ' where id=$1", [f.contract]),
  ).rejects.toThrow("sale_registration_signed_date_valid");
  await expect(
    db.query("update sale_contracts set total_amount_xof=720000 where id=$1", [f.contract]),
  ).rejects.toThrow("sale_native_price_valid");
  await expect(
    db.query("update sale_contracts set total_amount_xof=null where id=$1", [f.contract]),
  ).rejects.toThrow("sale_native_price_valid");
  await expect(
    db.query(
      "update sale_contracts set signed_date='2026-10-17',registration_basis='contract',source_reference=null where id=$1",
      [f.contract],
    ),
  ).rejects.toThrow("sale_unconfirmed_registration_facts_valid");
});

it("atomically records original-currency cash with null unknown actor, method and FX and exactly one native ledger", async () => {
  const f = await seed();
  let id = "";
  await transaction(async () => {
    id = await payment(f);
    await ledger(f, id);
  });
  const p = (
    await db.query(
      "select amount::text,currency,exchange_rate_to_xof,native_settlement,recorded_by,actual_collector,payment_method from payments where id=$1",
      [id],
    )
  ).rows[0];
  expect(p).toEqual({
    amount: "700000.00",
    currency: "CNY",
    exchange_rate_to_xof: null,
    native_settlement: true,
    recorded_by: null,
    actual_collector: null,
    payment_method: null,
  });
  expect(
    (
      await db.query(
        "select amount_xof::text,amount_native::text,currency from ledger_entries where payment_id=$1",
        [id],
      )
    ).rows,
  ).toEqual([{ amount_xof: "0.00", amount_native: "700000.00", currency: "CNY" }]);
  expect(
    (await db.query("select count(*)::int n from receivables where source_id=$1", [f.contract]))
      .rows[0].n,
  ).toBe(0);
  await expect(
    db.query("update sale_contracts set sale_currency='USD' where id=$1", [f.contract]),
  ).rejects.toThrow("nativeSaleExistingXofFacts");
});

it("rejects missing contracts, wrong unit/customer/currency and an XOF payment against a native sale", async () => {
  const f = await seed();
  for (const extra of [
    { contract: randomUUID() },
    { unit: null },
    { customer: null },
    { currency: "USD" },
    { source: "sale" },
  ])
    await expect(payment(f, extra)).rejects.toThrow("nativeSalePaymentMismatch");
  await expect(payment(f, { native: false, currency: "XOF", rate: 1 })).rejects.toThrow(
    "nativeSaleCurrencyRequired",
  );
  expect(
    (await db.query("select count(*)::int n from payments where source_id=$1", [f.contract]))
      .rows[0].n,
  ).toBe(0);
});

it("preserves the authenticated recording actor without asserting an actual historical collector", async () => {
  const f = await seed();
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: f.actor, role: "authenticated" }),
  ]);
  await db.query("set role authenticated");
  let id = "";
  await transaction(async () => {
    id = await payment(f);
    await ledger(f, id);
  });
  const row = (
    await owner("select recorded_by,actual_collector,collector_basis from payments where id=$1", [
      id,
    ])
  ).rows[0];
  expect(row).toEqual({ recorded_by: f.actor, actual_collector: null, collector_basis: null });
});

it("rejects a missing, duplicate, wrong-currency or inflated XOF ledger and rolls the whole pair back", async () => {
  const f = await seed();
  await expect(
    transaction(async () => {
      await payment(f);
    }),
  ).rejects.toThrow("nativeSaleLedgerMismatch");
  for (const extra of [
    { currency: "USD" },
    { native: 2 },
    { xof: 700000 },
    { category: "lease_rent" },
    { direction: "expense" },
    { unit: null },
  ])
    await expect(
      transaction(async () => {
        const id = await payment(f);
        await ledger(f, id, extra);
      }),
    ).rejects.toThrow();
  await expect(
    transaction(async () => {
      const id = await payment(f);
      await ledger(f, id);
      await ledger(f, id);
    }),
  ).rejects.toThrow("nativeSaleLedgerMismatch");
  expect(
    (await db.query("select count(*)::int n from payments where source_id=$1", [f.contract]))
      .rows[0].n,
  ).toBe(0);
});

it("prevents XOF principal schedules/receivables, including the existing installment RPC, on a native sale", async () => {
  const f = await seed();
  await expect(
    db.query(
      "insert into sale_payment_schedule(sale_contract_id,installment_no,due_date,amount_xof) values($1,1,'2026-10-17',700000)",
      [f.contract],
    ),
  ).rejects.toThrow("nativeSaleScheduleNotSupported");
  await expect(
    db.query(
      `insert into receivables(building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof)
    values($1,$2,$3,'sale_contract',$4,'sale_lump_sum','Synthetic','2026-10-17',700000)`,
      [f.building, f.unit, f.customer, f.contract],
    ),
  ).rejects.toThrow("nativeSaleReceivableNotSupported");
  await db.query("update sale_contracts set payment_plan_type='flexible_installment' where id=$1", [
    f.contract,
  ]);
  const updatedAt = (
    await db.query("select updated_at::text from sale_contracts where id=$1", [f.contract])
  ).rows[0].updated_at;
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: f.actor, role: "authenticated" }),
  ]);
  await db.query("set role authenticated");
  await expect(
    db.query("select finance_operation_rpc('sale_installment',$1,$2)", [
      {
        contractId: f.contract,
        expectedUpdatedAt: updatedAt,
        installmentNo: 1,
        dueDate: "2026-10-17",
        amountXof: 700000,
      },
      randomUUID(),
    ]),
  ).rejects.toThrow("nativeSaleScheduleNotSupported");
  await owner("select 1");
  expect(
    (
      await db.query(
        "select count(*)::int n from sale_payment_schedule where sale_contract_id=$1",
        [f.contract],
      )
    ).rows[0].n,
  ).toBe(0);
});

it("preserves existing XOF sale recording and the lease/CIMAC native check branches", async () => {
  const f = await seed("XOF");
  const id = await payment(f, { native: false, currency: "XOF", rate: 1, amount: 100 });
  await ledger(f, id, { currency: "XOF", native: null, xof: 100 });
  const definition = (
    await db.query(
      "select pg_get_constraintdef(oid) value from pg_constraint where conname='payment_native_settlement_check'",
    )
  ).rows[0].value;
  expect(definition).toContain("lease_rent");
  expect(definition).toContain("lease_deposit_refund");
  expect(definition).toContain("cimac_maintenance");
  await expect(payment(f, { native: true, currency: "CNY", rate: null })).rejects.toThrow(
    "nativeSalePaymentMismatch",
  );
  const acl = (
    await db.query(
      "select has_function_privilege('authenticated','private.guard_native_sale_money()','execute') allowed",
    )
  ).rows[0];
  expect(acl.allowed).toBe(false);
});

it("retains an explicit source zero balance in either original currency without creating settled bills", async () => {
  for (const currency of ["CNY", "XOF"]) {
    const f = await seed(currency);
    expect(
      (
        await db.query(
          "select source_balance_native,source_balance_reference from sale_contracts where id=$1",
          [f.contract],
        )
      ).rows[0],
    ).toEqual({ source_balance_native: null, source_balance_reference: null });
    await db.query(
      "update sale_contracts set source_balance_native=0,source_balance_reference='sha256:synthetic|sheet:source|cell:K65' where id=$1",
      [f.contract],
    );
    const row = (
      await db.query(
        "select source_balance_native::text,sale_currency,(select count(*)::int from receivables where source_id=$1) bills,(select count(*)::int from sale_payment_schedule where sale_contract_id=$1) schedules from sale_contracts where id=$1",
        [f.contract],
      )
    ).rows[0];
    expect(row).toEqual({
      source_balance_native: "0.00",
      sale_currency: currency,
      bills: 0,
      schedules: 0,
    });
  }
});

it("rejects unpaired, negative, non-finite or non-source balance facts", async () => {
  const f = await seed();
  for (const [amount, reference] of [
    [0, null],
    [null, "source:K65"],
    [-1, "source:K65"],
    ["NaN", "source:K65"],
    ["Infinity", "source:K65"],
    [0, "  "],
  ])
    await expect(
      db.query(
        "update sale_contracts set source_balance_native=$2,source_balance_reference=$3 where id=$1",
        [f.contract, amount, reference],
      ),
    ).rejects.toThrow();
  await db.query(
    "update sale_contracts set signed_date='2026-10-17',registration_basis='contract',payment_plan_type='flexible_installment',transfer_status='not_started' where id=$1",
    [f.contract],
  );
  await expect(
    db.query(
      "update sale_contracts set source_balance_native=0,source_balance_reference='source:K65' where id=$1",
      [f.contract],
    ),
  ).rejects.toThrow("sale_source_balance_valid");
});
