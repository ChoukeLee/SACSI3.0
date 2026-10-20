import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, afterAll, it, expect } from "vitest";
import type pg from "pg";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";

let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await installApplicationRebuild(db);
  if (process.env.SACSI_LEASE_COLLECTION_ADVISORS === "1") {
    const connection = (
      db as unknown as {
        connectionParameters: {
          host: string;
          port: number;
          user: string;
          password: string;
          database: string;
        };
      }
    ).connectionParameters;
    expect(connection.host).toBe("127.0.0.1");
    expect(connection.port).toBe(cluster.port);
    expect(connection.user).toBe("sacsi_test_owner");
    const url = `postgresql://${connection.user}:${encodeURIComponent(connection.password)}@127.0.0.1:${cluster.port}/postgres?sslmode=disable`;
    try {
      const npm = process.env.npm_execpath;
      if (!npm?.endsWith("npm-cli.js")) throw new Error("Native advisor requires npm runtime");
      const { stdout, stderr } = await promisify(execFile)(
        process.execPath,
        [
          npm,
          "exec",
          "--no",
          "--",
          "supabase",
          "db",
          "advisors",
          "--db-url",
          url,
          "--type",
          "security",
          "--level",
          "warn",
          "--fail-on",
          "none",
          "--output",
          "json",
        ],
        { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
      );
      const report =
        !stdout.trim() && /^No issues found\r?$/m.test(stderr) ? [] : JSON.parse(stdout);
      const issues = Array.isArray(report) ? report : (report.lints ?? report.result);
      expect(Array.isArray(issues)).toBe(true);
      const current = issues.filter((row: unknown) =>
        /lease_collection|lease_native_payment_allocations/.test(JSON.stringify(row)),
      );
      console.log(
        JSON.stringify({
          leaseCollectionNativeSecurityAdvisors: {
            warnings: current.length,
            names: current.map((row: { name?: string }) => row.name),
          },
        }),
      );
      expect(current).toEqual([]);
    } catch (error) {
      const failure = error as { stderr?: string; message?: string };
      throw new Error(
        "Local collection security advisors failed: " +
          String(failure.stderr ?? failure.message ?? "unknown")
            .replaceAll(url, "[local connection]")
            .replaceAll(connection.password, "[redacted]")
            .replace(/postgres(?:ql)?:\/\/\S+/g, "[connection]")
            .slice(-1400),
      );
    }
  }
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
async function seed(currency = "XOF", role = "admin") {
  const f = {
    actor: randomUUID(),
    project: randomUUID(),
    building: randomUUID(),
    unit: randomUUID(),
    customer: randomUUID(),
    contract: randomUUID(),
    rent: randomUUID(),
    property: randomUUID(),
    older: randomUUID(),
  };
  await owner("insert into auth.users(id,email) values($1,$2)", [
    f.actor,
    f.actor + "@test.invalid",
  ]);
  await db.query("insert into user_profiles(id,role,display_name) values($1,$2,'Synthetic')", [
    f.actor,
    role,
  ]);
  await db.query(
    "insert into projects(id,code,display_name,allows_long_lease) values($1::uuid,$1::text,'Synthetic',true)",
    [f.project],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name) values($1::uuid,$2,$1::text,'Synthetic')",
    [f.building, f.project],
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status) values($1::uuid,$2,$1::text,'408','4','leased')",
    [f.unit, f.building],
  );
  await db.query("insert into customers(id,name) values($1,'Synthetic customer')", [f.customer]);
  await db.query(
    "insert into lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,paid_through_date,payment_cycle,payment_day,monthly_rent_xof,rent_currency,monthly_rent_amount,status) values($1::uuid,$2,$3,$1::text,'2026-01-01','2027-12-31','2026-08-31','monthly',1,$4,$5,$6,'active')",
    [
      f.contract,
      f.unit,
      f.customer,
      currency === "XOF" ? 600000 : 0,
      currency,
      currency === "XOF" ? null : 3200,
    ],
  );
  for (const [id, category, due, amount] of [
    [f.older, "lease_rent", "2026-07-01", currency === "XOF" ? 600000 : 3200],
    [f.rent, "lease_rent", "2026-09-01", currency === "XOF" ? 600000 : 3200],
    [f.property, "property_fee", "2026-09-01", 40000],
  ] as const) {
    const native = category === "lease_rent" && currency !== "XOF";
    await db.query(
      "insert into receivables(id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,currency,amount_native,paid_amount_native,status) values($1,$2,$3,$4,'lease_contract',$5,$6,'Synthetic bill',$7,$8,0,$9,$10,$11,'pending')",
      [
        id,
        f.building,
        f.unit,
        f.customer,
        f.contract,
        category,
        due,
        native ? 0 : amount,
        native ? currency : "XOF",
        native ? amount : null,
        native ? 0 : null,
      ],
    );
  }
  await login(f.actor);
  return f;
}
type Fixture = Awaited<ReturnType<typeof seed>>;
function payload(f: Fixture, extra: Record<string, unknown> = {}) {
  return {
    contractId: f.contract,
    paymentDate: "2026-09-22",
    currency: "XOF",
    amount: 640000,
    paymentMethod: "bank_transfer",
    externalReceiptNo: "Synthetic receipt",
    allocations: [
      { receivableId: f.rent, amount: 600000, expectedOutstanding: 600000 },
      { receivableId: f.property, amount: 40000, expectedOutstanding: 40000 },
    ],
    ...extra,
  };
}
async function rpc(input: unknown, id = randomUUID(), client = db) {
  return (await client.query("select public.lease_collection_rpc($1,$2) value", [input, id]))
    .rows[0].value;
}
async function counts(f: Fixture) {
  return (
    await owner(
      "select (select count(*)::int from payments where unit_id=$1) payments,(select count(*)::int from ledger_entries where unit_id=$1) ledger,(select count(*)::int from receivables where unit_id=$1) receivables,(select count(*)::int from private.lease_collection_requests where contract_id=$2) requests,(select count(*)::int from audit_logs where entity_type='lease_collection' and entity_id=$2) audit",
      [f.unit, f.contract],
    )
  ).rows[0];
}

it("posts one atomic payment per expense type and only the explicit receivables, without changing coverage", async () => {
  const f = await seed(),
    id = randomUUID();
  const before = (
    await owner("select to_jsonb(c) value from lease_contracts c where id=$1", [f.contract])
  ).rows[0].value;
  await login(f.actor);
  const result = await rpc(payload(f), id);
  expect(result).toMatchObject({
    success: true,
    requestId: id,
    currency: "XOF",
    totalAmount: 640000,
    idempotent: false,
  });
  expect(result.paymentIds).toHaveLength(2);
  expect(result.referenceNos.every((v: unknown) => typeof v === "string")).toBe(true);
  expect(await counts(f)).toEqual({
    payments: 2,
    ledger: 2,
    receivables: 3,
    requests: 1,
    audit: 1,
  });
  expect(
    (
      await db.query(
        "select id,paid_amount_xof::text,status from receivables where source_id=$1 order by id",
        [f.contract],
      )
    ).rows,
  ).toEqual(
    expect.arrayContaining([
      { id: f.older, paid_amount_xof: "0.00", status: "pending" },
      { id: f.rent, paid_amount_xof: "600000.00", status: "paid" },
      { id: f.property, paid_amount_xof: "40000.00", status: "paid" },
    ]),
  );
  expect(
    (await db.query("select to_jsonb(c) value from lease_contracts c where id=$1", [f.contract]))
      .rows[0].value,
  ).toEqual(before);
  expect(
    (
      await db.query(
        "select sum(amount_xof)::text amount,count(*)::int n from payment_receivable_allocations where request_id=$1",
        [id],
      )
    ).rows[0],
  ).toEqual({ amount: "640000.00", n: 2 });
  expect(
    (
      await db.query(
        "select recorded_by,actual_collector,collector_basis from payments where unit_id=$1",
        [f.unit],
      )
    ).rows,
  ).toEqual([
    { recorded_by: f.actor, actual_collector: null, collector_basis: null },
    { recorded_by: f.actor, actual_collector: null, collector_basis: null },
  ]);
});
it("replays exactly one master request, rejects changed payload or actor and rechecks current access", async () => {
  const f = await seed(),
    request = randomUUID(),
    input = payload(f);
  const first = await rpc(input, request);
  expect(await rpc(input, request)).toEqual({ ...first, idempotent: true });
  await expect(rpc({ ...input, notes: "changed" }, request)).rejects.toThrow("requestIdConflict");
  const other = await seed();
  await login(other.actor);
  await expect(rpc(input, request)).rejects.toThrow("requestIdConflict");
  await owner("update user_profiles set role='front_desk' where id=$1", [f.actor]);
  await login(f.actor);
  await expect(rpc(input, request)).rejects.toThrow("leaseCollectionPermissionDenied");
  expect(await counts(f)).toMatchObject({ payments: 2, requests: 1, audit: 1 });
});
it("supports partial explicit collection and rejects stale exact balances even when enough remains", async () => {
  const f = await seed();
  const input = payload(f, {
    amount: 100000,
    allocations: [{ receivableId: f.rent, amount: 100000, expectedOutstanding: 600000 }],
  });
  await rpc(input);
  await expect(rpc(input)).rejects.toThrow("leaseCollectionBalanceChanged");
  const result = await rpc({
    ...input,
    allocations: [{ receivableId: f.rent, amount: 100000, expectedOutstanding: 500000 }],
  });
  expect(result.totalAmount).toBe(100000);
  expect(
    (await owner("select paid_amount_xof::text,status from receivables where id=$1", [f.rent]))
      .rows[0],
  ).toEqual({ paid_amount_xof: "200000.00", status: "partial" });
});
it("rejects updated-at changes with an unchanged balance", async () => {
  const f = await seed();
  const version = (
    await owner("select updated_at from receivables where id=$1", [f.rent])
  ).rows[0].updated_at.toISOString();
  await db.query("update receivables set notes='Synthetic corrected title' where id=$1", [f.rent]);
  await login(f.actor);
  await expect(
    rpc(
      payload(f, {
        amount: 600000,
        allocations: [
          {
            receivableId: f.rent,
            amount: 600000,
            expectedOutstanding: 600000,
            expectedUpdatedAt: version,
          },
        ],
      }),
    ),
  ).rejects.toThrow("leaseCollectionBalanceChanged");
  expect(await counts(f)).toMatchObject({ payments: 0, ledger: 0, requests: 0 });
});
it.each(["cancelled", "paid", "excluded", "historical_pending"])(
  "refuses unusable %s receivables without writing money",
  async (state) => {
    const f = await seed();
    await owner(
      state === "cancelled" || state === "paid"
        ? "update receivables set status=$2 where id=$1"
        : "update receivables set management_status=$2 where id=$1",
      [f.property, state],
    );
    await login(f.actor);
    await expect(rpc(payload(f))).rejects.toThrow("leaseCollectionBalanceChanged");
    expect(await counts(f)).toMatchObject({ payments: 0, ledger: 0, requests: 0, audit: 0 });
  },
);
it("rejects foreign contract/unit/customer and currency identities rather than allocating by date or amount", async () => {
  const f = await seed(),
    other = await seed();
  await login(f.actor);
  await expect(
    rpc(
      payload(f, {
        amount: 600000,
        allocations: [{ receivableId: other.rent, amount: 600000, expectedOutstanding: 600000 }],
      }),
    ),
  ).rejects.toThrow("leaseCollectionTargetMismatch");
  await owner("update receivables set customer_id=$2 where id=$1", [f.property, other.customer]);
  await login(f.actor);
  await expect(rpc(payload(f))).rejects.toThrow("leaseCollectionTargetMismatch");
  await expect(rpc(payload(f, { currency: "USD" }))).rejects.toThrow(
    "leaseCollectionTargetMismatch",
  );
  expect(await counts(f)).toMatchObject({ payments: 0, requests: 0 });
});
it.each(["ledger", "allocation", "audit", "master"])(
  "rolls every change back when %s persistence fails",
  async (kind) => {
    const f = await seed(),
      target = {
        ledger: "public.ledger_entries",
        allocation: "public.payment_receivable_allocations",
        audit: "public.audit_logs",
        master: "private.lease_collection_requests",
      }[kind]!;
    await owner(
      "create function private.reject_collection_test() returns trigger language plpgsql as $$ begin raise exception 'Synthetic failure'; end $$",
    );
    await db.query(
      `create trigger reject_collection_test before insert on ${target} for each row execute function private.reject_collection_test()`,
    );
    try {
      await login(f.actor);
      await expect(rpc(payload(f))).rejects.toThrow("Synthetic failure");
      expect(await counts(f)).toMatchObject({ payments: 0, ledger: 0, requests: 0, audit: 0 });
      expect(
        (
          await db.query(
            "select sum(paid_amount_xof)::text amount from receivables where source_id=$1",
            [f.contract],
          )
        ).rows[0].amount,
      ).toBe("0.00");
    } finally {
      await owner(
        `drop trigger reject_collection_test on ${target}; drop function private.reject_collection_test()`,
      );
    }
  },
);
it("saves explicit actual collector evidence without replacing the authenticated recording actor", async () => {
  const f = await seed();
  await rpc(
    payload(f, {
      actualCollector: "振咏",
      collectorBasis: "Synthetic receipt signed by collector",
    }),
  );
  expect(
    (
      await owner(
        "select recorded_by,actual_collector,collector_basis,context_version::int,context_confirmed_by from payments where unit_id=$1",
        [f.unit],
      )
    ).rows,
  ).toEqual(
    [0, 1].map(() => ({
      recorded_by: f.actor,
      actual_collector: "振咏",
      collector_basis: "Synthetic receipt signed by collector",
      context_version: 1,
      context_confirmed_by: f.actor,
    })),
  );
});
it("separates native allocations from XOF and lets a native lease collect property charges only in XOF", async () => {
  const f = await seed("USD"),
    request = randomUUID();
  const input = payload(f, {
    currency: "USD",
    amount: 1600,
    allocations: [{ receivableId: f.rent, amount: 1600, expectedOutstanding: 3200 }],
  });
  const result = await rpc(input, request);
  expect(result).toMatchObject({ currency: "USD", totalAmount: 1600 });
  expect(
    (
      await owner(
        "select amount::text,currency::text,native_settlement,exchange_rate_to_xof from payments where unit_id=$1",
        [f.unit],
      )
    ).rows,
  ).toEqual([
    { amount: "1600.00", currency: "USD", native_settlement: true, exchange_rate_to_xof: null },
  ]);
  expect(
    (
      await db.query(
        "select amount_xof::text,amount_native::text,currency::text from ledger_entries where unit_id=$1",
        [f.unit],
      )
    ).rows,
  ).toEqual([{ amount_xof: "0.00", amount_native: "1600.00", currency: "USD" }]);
  expect(
    (
      await db.query(
        "select amount_native::text,currency::text from lease_native_payment_allocations where request_id=$1",
        [request],
      )
    ).rows,
  ).toEqual([{ amount_native: "1600.00", currency: "USD" }]);
  expect(
    (
      await db.query(
        "select count(*)::int n from payment_receivable_allocations where request_id=$1",
        [request],
      )
    ).rows[0].n,
  ).toBe(0);
  await login(f.actor);
  await expect(
    rpc(
      payload(f, {
        currency: "USD",
        amount: 40000,
        allocations: [{ receivableId: f.property, amount: 40000, expectedOutstanding: 40000 }],
      }),
    ),
  ).rejects.toThrow("leaseCollectionTargetMismatch");
  await expect(
    rpc(
      payload(f, {
        currency: "XOF",
        amount: 3200,
        allocations: [{ receivableId: f.rent, amount: 3200, expectedOutstanding: 3200 }],
      }),
    ),
  ).rejects.toThrow("leaseCollectionTargetMismatch");
  await rpc(
    payload(f, {
      amount: 40000,
      allocations: [{ receivableId: f.property, amount: 40000, expectedOutstanding: 40000 }],
    }),
  );
});
it("serializes independent concurrent requests and rejects the stale winner's competitor", async () => {
  const f = await seed(),
    other = await cluster.connect();
  await login(f.actor, other);
  try {
    const result = await Promise.allSettled([
      rpc(payload(f), randomUUID(), db),
      rpc(payload(f), randomUUID(), other),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      result
        .filter((r) => r.status === "rejected")
        .map((r) => (r as PromiseRejectedResult).reason.message),
    ).toEqual(["leaseCollectionBalanceChanged"]);
    expect(await counts(f)).toMatchObject({ payments: 2, ledger: 2, requests: 1, audit: 1 });
  } finally {
    await other.end();
  }
});
it("public entry remains invoker-only, protected tables and anonymous/service execution remain denied", async () => {
  const f = await seed();
  expect(
    (
      await owner(
        "select prosecdef,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('service_role',oid,'execute') service from pg_proc where oid='public.lease_collection_rpc(jsonb,uuid)'::regprocedure",
      )
    ).rows[0],
  ).toEqual({ prosecdef: false, anon: false, service: false });
  await login(f.actor);
  await expect(db.query("select * from private.lease_collection_requests")).rejects.toThrow(
    "permission denied",
  );
  await expect(
    db.query(
      "insert into lease_native_payment_allocations(payment_id,receivable_id,currency,amount_native,actor_id,request_id) values($1,$2,'USD',1,$3,$4)",
      [randomUUID(), f.rent, f.actor, randomUUID()],
    ),
  ).rejects.toThrow("permission denied");
});
it("returns a persisted exact receipt, denies revoked project/role access, and leaves the original request intact", async () => {
  const f = await seed(),
    request = randomUUID(),
    input = payload(f);
  const first = await rpc(input, request);
  expect(
    (await db.query("select public.lease_collection_receipt_read_rpc($1) value", [request])).rows[0]
      .value,
  ).toEqual({ ...first, contractId: f.contract });
  await owner("update projects set access_mode='restricted' where id=$1", [f.project]);
  await login(f.actor);
  await expect(rpc(input, request)).rejects.toThrow("leaseCollectionAccessDenied");
  await expect(
    db.query("select public.lease_collection_receipt_read_rpc($1)", [request]),
  ).rejects.toThrow("leaseCollectionAccessDenied");
  await owner("update projects set access_mode='open' where id=$1", [f.project]);
  await db.query("update user_profiles set role='front_desk' where id=$1", [f.actor]);
  await login(f.actor);
  await expect(rpc(input, request)).rejects.toThrow("leaseCollectionPermissionDenied");
  await expect(
    db.query("select public.lease_collection_receipt_read_rpc($1)", [request]),
  ).rejects.toThrow("leaseCollectionPermissionDenied");
  await owner("update user_profiles set role='finance' where id=$1", [f.actor]);
  await login(f.actor);
  expect(await rpc(input, request)).toEqual({ ...first, idempotent: true });
  expect(await counts(f)).toMatchObject({ payments: 2, requests: 1, audit: 1 });
});
it("native receipts expose true per-payment links and the old XOF-only context refuses a misleading empty allocation", async () => {
  const f = await seed("CNY"),
    request = randomUUID();
  const result = await rpc(
    payload(f, {
      currency: "CNY",
      amount: 1600,
      allocations: [{ receivableId: f.rent, amount: 1600, expectedOutstanding: 3200 }],
    }),
    request,
  );
  expect(result.allocations).toEqual([
    { receivableId: f.rent, amount: 1600, paymentId: result.paymentIds[0], currency: "CNY" },
  ]);
  expect(
    (await db.query("select public.lease_collection_receipt_read_rpc($1) value", [request])).rows[0]
      .value,
  ).toEqual({ ...result, contractId: f.contract });
  await expect(
    db.query("select public.payment_context_read_rpc($1)", [result.paymentIds[0]]),
  ).rejects.toThrow("nativeLeaseAllocationContextRequired");
});
it("rolls back the already-created rent group if the second property payment is rejected", async () => {
  const f = await seed();
  await owner(
    "create function private.reject_second_collection_group() returns trigger language plpgsql as $$ begin if new.source_type='property_fee' then raise exception 'Synthetic second group failure'; end if; return new; end $$; create trigger reject_second_collection_group before insert on public.payments for each row execute function private.reject_second_collection_group()",
  );
  try {
    await login(f.actor);
    await expect(rpc(payload(f))).rejects.toThrow("Synthetic second group failure");
    expect(await counts(f)).toMatchObject({ payments: 0, ledger: 0, requests: 0, audit: 0 });
    expect(
      (
        await db.query(
          "select sum(paid_amount_xof)::text amount from receivables where source_id=$1",
          [f.contract],
        )
      ).rows[0].amount,
    ).toBe("0.00");
  } finally {
    await owner(
      "drop trigger reject_second_collection_group on public.payments; drop function private.reject_second_collection_group()",
    );
  }
});
it("uses the rebuild's existing categories without rewriting legacy other/manual obligations", async () => {
  const f = await seed();
  const checks = await owner(
    "select pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.receivables'::regclass and contype='c' and conname like '%category%'",
  );
  expect(checks.rows.map((row) => row.definition).join(" ")).toContain("property_fee");
  await db.query("update receivables set category='other' where id=$1", [f.property]);
  await login(f.actor);
  await expect(rpc(payload(f))).rejects.toThrow("leaseCollectionTargetMismatch");
  expect(
    (await owner("select category from receivables where id=$1", [f.property])).rows[0].category,
  ).toBe("other");
});
it("does not expose another project's native allocation through the public read policy", async () => {
  const f = await seed("USD");
  await rpc(
    payload(f, {
      currency: "USD",
      amount: 1600,
      allocations: [{ receivableId: f.rent, amount: 1600, expectedOutstanding: 3200 }],
    }),
  );
  expect(
    (
      await db.query(
        "select count(*)::int n from lease_native_payment_allocations where receivable_id=$1",
        [f.rent],
      )
    ).rows[0].n,
  ).toBe(1);
  await owner("update projects set access_mode='restricted' where id=$1", [f.project]);
  await login(f.actor);
  expect(
    (
      await db.query(
        "select count(*)::int n from lease_native_payment_allocations where receivable_id=$1",
        [f.rent],
      )
    ).rows[0].n,
  ).toBe(0);
});
it("same request concurrent replay commits one result and never re-debits the receivables", async () => {
  const f = await seed(),
    request = randomUUID(),
    other = await cluster.connect();
  await login(f.actor, other);
  try {
    const results = await Promise.all([
      rpc(payload(f), request, db),
      rpc(payload(f), request, other),
    ]);
    expect(results.map((r) => r.idempotent).sort()).toEqual([false, true]);
    expect(results[0].paymentIds).toEqual(results[1].paymentIds);
    expect(await counts(f)).toMatchObject({ payments: 2, ledger: 2, requests: 1, audit: 1 });
  } finally {
    await other.end();
  }
});
it.each([
  { amount: 640001 },
  { amount: -1 },
  { currency: "EUR" },
  { paymentMethod: "offset" },
  { paymentDate: "2026-02-30" },
  { actualCollector: "Unknown" },
  { collectorBasis: "Not a collector" },
  { allocations: [] },
  {
    allocations: [
      { receivableId: randomUUID(), amount: 1, expectedOutstanding: 1 },
      { receivableId: randomUUID(), amount: 1, expectedOutstanding: 1 },
    ],
  },
  { recordedBy: randomUUID() },
])("rejects malformed or inconsistent payload %# before committing", async (extra) => {
  const f = await seed();
  await expect(rpc(payload(f, extra))).rejects.toThrow();
  expect(await counts(f)).toMatchObject({ payments: 0, requests: 0 });
});

async function coveredFixture(currency = "XOF") {
  const f = await seed(currency);
  await owner(
    "update lease_contracts set commencement_state='started',expected_end_confirmed=true where id=$1",
    [f.contract],
  );
  await db.query("update receivables set status='cancelled' where id=$1", [f.older]);
  await db.query(
    "update receivables set service_period_start='2026-09-01',service_period_end='2026-09-30',service_period_source='Synthetic explicit period' where id=$1",
    [f.rent],
  );
  const stamp = (
    await db.query("select to_jsonb(c)->>'updated_at' stamp from lease_contracts c where id=$1", [
      f.contract,
    ])
  ).rows[0].stamp;
  const coverage = {
    expectedPaidThroughDate: "2026-08-31",
    expectedContractUpdatedAt: stamp,
    throughDate: "2026-09-30",
    receivableIds: [f.rent],
  };
  await login(f.actor);
  const input = {
    ...payload(f, {
      ...(currency === "XOF"
        ? {}
        : {
            currency,
            amount: 3200,
            allocations: [{ receivableId: f.rent, amount: 3200, expectedOutstanding: 3200 }],
          }),
    }),
    coverage,
  };
  return { f, coverage, input };
}
it("optionally advances only an explicitly confirmed, fully paid continuous period and never creates another invoice", async () => {
  const { f, coverage, input } = await coveredFixture(),
    request = randomUUID();
  const result = await rpc(input, request);
  expect(result).toMatchObject({
    paidThroughBefore: "2026-08-31",
    paidThroughAfter: "2026-09-30",
    coverage: { throughDate: "2026-09-30", receivableIds: [f.rent] },
  });
  expect(
    (
      await owner(
        "select paid_through_date::text as covered_until from lease_contracts where id=$1",
        [f.contract],
      )
    ).rows[0].covered_until,
  ).toBe("2026-09-30");
  expect(await counts(f)).toMatchObject({
    payments: 2,
    ledger: 2,
    receivables: 3,
    requests: 1,
    audit: 1,
  });
  const audit = (
    await db.query(
      "select before_data,after_data,metadata from audit_logs where entity_type='lease_collection' and entity_id=$1",
      [f.contract],
    )
  ).rows[0];
  expect(audit.before_data.paidThroughDate).toBe("2026-08-31");
  expect(audit.after_data.paidThroughAfter).toBe("2026-09-30");
  expect(audit.metadata).toMatchObject({
    paid_through_unchanged: false,
    coverage_explicitly_confirmed: true,
    no_receivables_created: true,
    input: { coverage },
  });
  await login(f.actor);
  expect(await rpc(input, request)).toEqual({ ...result, idempotent: true });
  await expect(
    rpc({ ...input, coverage: { ...coverage, throughDate: "2026-10-31" } }, request),
  ).rejects.toThrow("requestIdConflict");
});
it("leaves documented periods and coverage unchanged when the optional confirmation is absent", async () => {
  const { f, input } = await coveredFixture();
  const { coverage, ...withoutCoverage } = input;
  expect(coverage).toBeDefined();
  expect(await rpc(withoutCoverage)).toMatchObject({
    paidThroughBefore: "2026-08-31",
    paidThroughAfter: "2026-08-31",
  });
  expect(
    (
      await owner(
        "select paid_through_date::text as covered_until from lease_contracts where id=$1",
        [f.contract],
      )
    ).rows[0].covered_until,
  ).toBe("2026-08-31");
});
it.each([
  "missing-start",
  "missing-source",
  "gap",
  "incomplete",
  "wrong-before",
  "wrong-version",
  "contract-not-started",
  "confirmed-end",
])("rejects %s coverage proof and rolls back every payment/allocation", async (kind) => {
  const { f, input } = await coveredFixture();
  if (kind === "missing-start")
    await owner("update receivables set service_period_start=null where id=$1", [f.rent]);
  if (kind === "missing-source")
    await owner(
      "update receivables set service_period_start=null,service_period_end=null,service_period_source=null where id=$1",
      [f.rent],
    );
  if (kind === "gap")
    await owner("update receivables set service_period_start='2026-09-02' where id=$1", [f.rent]);
  if (kind === "incomplete") {
    input.amount = 140000;
    input.allocations[0].amount = 100000;
  }
  if (kind === "wrong-before")
    Object.assign(input, {
      coverage: { ...(input.coverage as object), expectedPaidThroughDate: "2026-08-30" },
    });
  if (kind === "wrong-version")
    Object.assign(input, {
      coverage: {
        ...(input.coverage as object),
        expectedContractUpdatedAt: "2026-01-01T00:00:00Z",
      },
    });
  if (kind === "contract-not-started")
    await owner(
      "update lease_contracts set commencement_state='cancelled_before_start' where id=$1",
      [f.contract],
    );
  if (kind === "confirmed-end")
    await owner("update lease_contracts set expected_end_date='2026-09-15' where id=$1", [
      f.contract,
    ]);
  await login(f.actor);
  await expect(rpc(input)).rejects.toThrow("leaseCollectionCoverageChanged");
  expect(await counts(f)).toMatchObject({ payments: 0, ledger: 0, requests: 0, audit: 0 });
  expect(
    (
      await db.query(
        "select paid_through_date::text as covered_until from lease_contracts where id=$1",
        [f.contract],
      )
    ).rows[0].covered_until,
  ).toBe("2026-08-31");
});
it("does not treat an unconfirmed proposed contract end as a confirmed service-period boundary", async () => {
  const { f, input } = await coveredFixture();
  await owner(
    "update lease_contracts set expected_end_date='2026-09-15',expected_end_confirmed=false where id=$1",
    [f.contract],
  );
  Object.assign(input, {
    coverage: {
      ...(input.coverage as object),
      expectedContractUpdatedAt: (
        await db.query(
          "select to_jsonb(c)->>'updated_at' stamp from lease_contracts c where id=$1",
          [f.contract],
        )
      ).rows[0].stamp,
    },
  });
  await login(f.actor);
  expect(await rpc(input)).toMatchObject({ paidThroughAfter: "2026-09-30" });
});
it("rejects property-only coverage and unknown unpaid periods without using due dates as period evidence", async () => {
  const { f, input } = await coveredFixture();
  await expect(
    rpc({
      ...input,
      amount: 40000,
      allocations: [{ receivableId: f.property, amount: 40000, expectedOutstanding: 40000 }],
    }),
  ).rejects.toThrow("leaseCollectionCoverageChanged");
  await owner("update receivables set status='pending',due_date='2099-01-01' where id=$1", [
    f.older,
  ]);
  await login(f.actor);
  await expect(rpc(input)).rejects.toThrow("leaseCollectionCoverageChanged");
  expect(await counts(f)).toMatchObject({ payments: 0, ledger: 0, requests: 0 });
});
it("cannot select one convenient duplicate while another known bill overlaps the claimed coverage", async () => {
  const { f, input } = await coveredFixture();
  await owner(
    "update receivables set status='paid',paid_amount_xof=amount_xof,service_period_start='2026-09-01',service_period_end='2026-09-30',service_period_source='Synthetic duplicate' where id=$1",
    [f.older],
  );
  await login(f.actor);
  await expect(rpc(input)).rejects.toThrow("leaseCollectionCoverageChanged");
  expect(await counts(f)).toMatchObject({ payments: 0, requests: 0 });
});
it.each(["USD", "CNY"])(
  "proves %s coverage with native full amounts without XOF inference",
  async (currency) => {
    const { f, input } = await coveredFixture(currency),
      request = randomUUID();
    const result = await rpc(input, request);
    expect(result).toMatchObject({ currency, totalAmount: 3200, paidThroughAfter: "2026-09-30" });
    expect(
      (
        await owner(
          "select amount_xof::text,amount_native::text,currency::text from ledger_entries where unit_id=$1",
          [f.unit],
        )
      ).rows,
    ).toEqual([{ amount_xof: "0.00", amount_native: "3200.00", currency }]);
    expect(
      (await db.query("select count(*)::int n from receivables where source_id=$1", [f.contract]))
        .rows[0].n,
    ).toBe(3);
  },
);
it("rolls coverage and money back together when audit persistence fails after the contract update", async () => {
  const { f, input } = await coveredFixture();
  await owner(
    "create function private.reject_coverage_audit() returns trigger language plpgsql as $$ begin raise exception 'Synthetic coverage audit failure'; end $$; create trigger reject_coverage_audit before insert on public.audit_logs for each row execute function private.reject_coverage_audit()",
  );
  try {
    await login(f.actor);
    await expect(rpc(input)).rejects.toThrow("Synthetic coverage audit failure");
    expect(await counts(f)).toMatchObject({ payments: 0, ledger: 0, requests: 0, audit: 0 });
    expect(
      (
        await db.query(
          "select paid_through_date::text as covered_until from lease_contracts where id=$1",
          [f.contract],
        )
      ).rows[0].covered_until,
    ).toBe("2026-08-31");
  } finally {
    await owner(
      "drop trigger reject_coverage_audit on public.audit_logs;drop function private.reject_coverage_audit()",
    );
  }
});

it("proves multiple contiguous periods including an already paid documented period without repaying it", async () => {
  const { f, input, coverage } = await coveredFixture();
  await owner("update receivables set paid_amount_xof=amount_xof,status='paid' where id=$1", [
    f.rent,
  ]);
  await db.query(
    "update receivables set status='pending',due_date='2026-10-01',service_period_start='2026-10-01',service_period_end='2026-10-31',service_period_source='Synthetic next known period' where id=$1",
    [f.older],
  );
  await login(f.actor);
  const result = await rpc({
    ...input,
    coverage: { ...coverage, throughDate: "2026-10-31", receivableIds: [f.rent, f.older] },
    allocations: [
      { receivableId: f.older, amount: 600000, expectedOutstanding: 600000 },
      { receivableId: f.property, amount: 40000, expectedOutstanding: 40000 },
    ],
  });
  expect(result).toMatchObject({
    paidThroughAfter: "2026-10-31",
    coverage: { receivableIds: [f.rent, f.older] },
  });
  expect(
    result.allocations.map((row: { receivableId: string }) => row.receivableId).sort(),
  ).toEqual([f.older, f.property].sort());
  expect(await counts(f)).toMatchObject({ payments: 2, receivables: 3, requests: 1 });
});
it("serializes competing coverage requests and preserves successful same-ID replay after its contract version changes", async () => {
  const { f, input } = await coveredFixture(),
    firstId = randomUUID(),
    secondId = randomUUID(),
    other = await cluster.connect();
  await login(f.actor, other);
  try {
    const results = await Promise.allSettled([
      rpc(input, firstId, db),
      rpc(input, secondId, other),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      results
        .filter((r) => r.status === "rejected")
        .map((r) => (r as PromiseRejectedResult).reason.message),
    ).toEqual(["leaseCollectionCoverageChanged"]);
    const winner = results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<
      Record<string, unknown>
    >;
    const request = results[0].status === "fulfilled" ? firstId : secondId;
    expect(await rpc(input, request)).toEqual({ ...winner.value, idempotent: true });
    expect(await counts(f)).toMatchObject({ payments: 2, ledger: 2, requests: 1, audit: 1 });
  } finally {
    await other.end();
  }
});
it("keeps past unknown fully paid history out of the proof without inventing its dates", async () => {
  const { f, input } = await coveredFixture();
  await owner("update receivables set status='paid',paid_amount_xof=amount_xof where id=$1", [
    f.older,
  ]);
  await login(f.actor);
  expect(await rpc(input)).toMatchObject({ paidThroughAfter: "2026-09-30" });
  expect(
    (
      await owner("select service_period_start,service_period_end from receivables where id=$1", [
        f.older,
      ])
    ).rows[0],
  ).toEqual({ service_period_start: null, service_period_end: null });
});
it("rejects optional coverage on a future contract start even if its lifecycle flag says started", async () => {
  const { f, input } = await coveredFixture();
  await owner(
    "update lease_contracts set start_date=current_date+1,expected_end_date=current_date+400,paid_through_date=current_date where id=$1",
    [f.contract],
  );
  const stamp = (
    await db.query(
      "select to_jsonb(c)->>'updated_at' stamp,current_date::text covered from lease_contracts c where id=$1",
      [f.contract],
    )
  ).rows[0];
  await login(f.actor);
  await expect(
    rpc({
      ...input,
      coverage: {
        ...input.coverage,
        expectedPaidThroughDate: stamp.covered,
        expectedContractUpdatedAt: stamp.stamp,
        throughDate: "2027-01-31",
      },
    }),
  ).rejects.toThrow("leaseCollectionCoverageChanged");
  expect(await counts(f)).toMatchObject({ payments: 0, requests: 0 });
});
it("counts upcoming contracts from real bounded unpaid obligations, not an old coverage fallback after full collection", async () => {
  const { f, input } = await coveredFixture();
  await owner("update lease_contracts set paid_through_date=current_date-10 where id=$1", [
    f.contract,
  ]);
  await db.query("update receivables set due_date=current_date+1 where id in ($1,$2)", [
    f.rent,
    f.property,
  ]);
  await login(f.actor);
  const query = {
    projectId: f.project,
    buildingId: f.building,
    status: "current",
    search: "",
    sort: "unit",
    direction: "asc",
    page: 1,
    locale: "zh",
  };
  const before = (
    await db.query("select public.contract_workspace_read_rpc('lease',$1) value", [query])
  ).rows[0].value;
  expect(before.stats.dueSoon).toBe(1);
  const { coverage, ...withoutCoverage } = input;
  expect(coverage).toBeDefined();
  await rpc(withoutCoverage);
  const after = (
    await db.query("select public.contract_workspace_read_rpc('lease',$1) value", [query])
  ).rows[0].value;
  expect(after.stats.dueSoon).toBe(0);
  expect(after.stats.outstanding).toBe(0);
});
