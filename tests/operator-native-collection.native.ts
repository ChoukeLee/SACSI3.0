import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";

type Fields = Record<string, unknown>;
type NativeResult = Fields & {
  status: string;
  requestId: string;
  paymentIds: string[];
  allocations: { receivableId: string; amount: string; paymentId: string }[];
};
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>;
let db: pg.Client;
let advisorWarnings: number | undefined;

beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await installApplicationRebuild(db);
  if (process.env.SACSI_OPERATOR_NATIVE_ADVISORS === "1")
    advisorWarnings = await checkNativeCollectionAdvisors();
}, 45000);
afterAll(async () => {
  await cluster?.close();
});

async function owner(sql: string, parameters: unknown[] = []) {
  await db.query("reset role");
  return db.query(sql, parameters);
}
async function login(actor: string, client = db) {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: "authenticated", email: "native-operator@test.invalid" }),
  ]);
  await client.query("set role authenticated");
}
async function seed(currency = "USD", role = "admin") {
  const f = {
    actor: randomUUID(),
    project: randomUUID(),
    building: randomUUID(),
    unit: randomUUID(),
    customer: randomUUID(),
    contract: randomUUID(),
    rent: randomUUID(),
    secondRent: randomUUID(),
    property: randomUUID(),
    currency,
  };
  await owner("insert into auth.users(id,email) values($1,$2)", [
    f.actor,
    `${f.actor}@test.invalid`,
  ]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,$2,'Synthetic operator')",
    [f.actor, role],
  );
  await db.query(
    "insert into projects(id,code,display_name,allows_long_lease) values($1::uuid,$1::text,'Synthetic native',true)",
    [f.project],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name) values($1::uuid,$2,$1::text,'Synthetic native')",
    [f.building, f.project],
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status) values($1::uuid,$2,$1::text,'408','4','leased')",
    [f.unit, f.building],
  );
  await db.query("insert into customers(id,name) values($1,'Synthetic native customer')", [
    f.customer,
  ]);
  await db.query(
    "insert into lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,paid_through_date,payment_cycle,payment_day,monthly_rent_xof,rent_currency,monthly_rent_amount,status,commencement_state,expected_end_confirmed) values($1::uuid,$2,$3,$1::text,'2026-01-01','2027-12-31','2026-08-31','monthly',1,0,$4,10,'active','started',true)",
    [f.contract, f.unit, f.customer, currency],
  );
  for (const [id, category, due, amount] of [
    [f.rent, "lease_rent", "2026-09-01", "10.00"],
    [f.secondRent, "lease_rent", "2026-10-01", "20.00"],
    [f.property, "property_fee", "2026-09-01", "40000.00"],
  ]) {
    const native = category === "lease_rent";
    await db.query(
      "insert into receivables(id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,currency,amount_native,paid_amount_native,status) values($1,$2,$3,$4,'lease_contract',$5,$6,'Synthetic native bill',$7,$8,0,$9,$10,$11,'pending')",
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
  return f;
}
type Fixture = Awaited<ReturnType<typeof seed>>;
function request(f: Fixture, extra: Fields = {}) {
  return {
    protocolVersion: "1.0",
    connectorVersion: "0.7.0",
    requestId: randomUUID(),
    originalInstruction: "Explicit synthetic native receipt instruction",
    inputSource: "natural_language",
    contractId: f.contract,
    currency: f.currency,
    amount: "4.25",
    paymentDate: "2026-09-22",
    paymentMethod: "bank_transfer",
    allocations: [{ receivableId: f.rent, amount: "4.25" }],
    ...extra,
  };
}
async function preview(f: Fixture, input: Fields, client = db): Promise<Fields> {
  await login(f.actor, client);
  return (await client.query("select public.preview_operator_native_collection($1) value", [input]))
    .rows[0].value;
}
async function execute(
  f: Fixture,
  input: Fields,
  snapshot: Fields,
  client = db,
  expiresAt?: string,
): Promise<NativeResult> {
  await login(f.actor, client);
  return (
    await client.query(
      "select public.execute_operator_native_collection($1,$2,coalesce($3::timestamptz,clock_timestamp()+interval '5 minutes'),$4) value",
      [input, snapshot, expiresAt ?? null, "synthetic-native-deployment"],
    )
  ).rows[0].value;
}
async function find(f: Fixture, requestId: string) {
  await login(f.actor);
  return (await db.query("select public.find_operator_native_collection($1) value", [requestId]))
    .rows[0].value;
}
async function counts(f: Fixture) {
  return (
    await owner(
      `select
    (select count(*)::int from payments where unit_id=$1) payments,
    (select count(*)::int from ledger_entries where unit_id=$1) ledger,
    (select count(*)::int from lease_native_payment_allocations where receivable_id in ($2,$3)) allocations,
    (select count(*)::int from private.lease_collection_requests where contract_id=$4) collections,
    (select count(*)::int from private.operator_native_collection_requests where contract_id=$4) operator_requests,
    (select count(*)::int from audit_logs where entity_type='lease_collection' and entity_id=$4) audit`,
      [f.unit, f.rent, f.secondRent, f.contract],
    )
  ).rows[0];
}
const emptyCounts = {
  payments: 0,
  ledger: 0,
  allocations: 0,
  collections: 0,
  operator_requests: 0,
  audit: 0,
};

async function checkNativeCollectionAdvisors() {
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
  expect(connection.database).toBe("postgres");
  const npm = process.env.npm_execpath;
  if (!npm?.endsWith("npm-cli.js")) throw new Error("Native advisors require the npm runtime");
  const url = `postgresql://${connection.user}:${encodeURIComponent(connection.password)}@127.0.0.1:${cluster.port}/postgres?sslmode=disable`;
  try {
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [
        npm,
        "exec",
        "--yes",
        "--package=supabase@2.121.0",
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
    const report = !stdout.trim() && /^No issues found\r?$/m.test(stderr) ? [] : JSON.parse(stdout);
    const issues = Array.isArray(report) ? report : (report.lints ?? report.result);
    expect(Array.isArray(issues)).toBe(true);
    const current = issues.filter((row: unknown) =>
      /operator_native_collection|record_lease_collection_with_context/.test(JSON.stringify(row)),
    );
    console.log(
      JSON.stringify({
        nativeCollectionSecurityAdvisors: {
          totalWarnings: issues.length,
          newObjectWarnings: current.length,
          names: current.map((row: { name?: string }) => row.name),
        },
      }),
    );
    expect(current).toEqual([]);
    return current.length;
  } catch (error) {
    const failure = error as { stderr?: string; message?: string };
    const safe = String(failure.stderr ?? failure.message ?? "Unknown advisor error")
      .replaceAll(url, "[local connection]")
      .replaceAll(connection.password, "[redacted]")
      .replace(/postgres(?:ql)?:\/\/\S+/g, "[connection]")
      .slice(-1600);
    throw new Error(`Local native collection security advisors failed: ${safe}`);
  }
}

it.runIf(process.env.SACSI_OPERATOR_NATIVE_ADVISORS === "1")(
  "local security advisors find no warnings on the new native collection objects",
  () => {
    expect(advisorWarnings).toBe(0);
  },
);

it.each(["USD", "CNY"])(
  "adds 0.1 + 0.2 as exactly 0.30 %s in a single original-currency receipt",
  async (currency) => {
    const f = await seed(currency);
    await owner(
      "update receivables set amount_native=case when id=$1 then 0.1 else 0.2 end where id in ($1,$2)",
      [f.rent, f.secondRent],
    );
    const input = request(f, {
      amount: "0.30",
      allocations: [
        { receivableId: f.rent, amount: "0.1" },
        { receivableId: f.secondRent, amount: "0.2" },
      ],
    });
    const result = await execute(f, input, await preview(f, input));
    expect(result).toMatchObject({ amount: "0.30", currency, status: "completed", verified: true });
    expect(result.paymentIds).toHaveLength(1);
    expect(
      (
        await owner(
          "select amount::text,currency::text,exchange_rate_to_xof from payments where unit_id=$1",
          [f.unit],
        )
      ).rows,
    ).toEqual([{ amount: "0.30", currency, exchange_rate_to_xof: null }]);
    expect((await counts(f)).allocations).toBe(2);
  },
);

it.each(["USD", "CNY"])(
  "collects partial and full %s cents exactly, without exchange rates or implicit coverage",
  async (currency) => {
    const f = await seed(currency);
    await owner(
      "update receivables set amount_native=case when id=$1 then 0.1 else 0.2 end where id in ($1,$2)",
      [f.rent, f.secondRent],
    );
    const partial = request(f, {
      amount: "0.05",
      allocations: [{ receivableId: f.rent, amount: "0.05" }],
    });
    const first = await execute(f, partial, await preview(f, partial));
    expect(first).toMatchObject({
      status: "completed",
      verified: true,
      requestId: partial.requestId,
      currency,
      amount: "0.05",
      contractId: f.contract,
      paidThroughBefore: "2026-08-31",
      paidThroughAfter: "2026-08-31",
    });
    expect(
      (await owner("select paid_amount_native::text,status from receivables where id=$1", [f.rent]))
        .rows[0],
    ).toEqual({ paid_amount_native: "0.05", status: "partial" });
    const remaining = request(f, {
      amount: "0.25",
      allocations: [
        { receivableId: f.rent, amount: "0.05" },
        { receivableId: f.secondRent, amount: "0.2" },
      ],
    });
    const result = await execute(f, remaining, await preview(f, remaining));
    expect(result).toMatchObject({
      status: "completed",
      verified: true,
      amount: "0.25",
      currency,
      paidThroughAfter: "2026-08-31",
    });
    expect(result.allocations).toEqual(
      expect.arrayContaining([
        { receivableId: f.rent, amount: "0.05", paymentId: expect.any(String) },
        { receivableId: f.secondRent, amount: "0.20", paymentId: expect.any(String) },
      ]),
    );
    expect(
      (
        await owner(
          "select sum(amount)::text amount,bool_and(currency=$2::currency_code and native_settlement and exchange_rate_to_xof is null) isolated,bool_and(recorded_by=$3) own_actor from payments where unit_id=$1",
          [f.unit, currency, f.actor],
        )
      ).rows[0],
    ).toEqual({ amount: "0.30", isolated: true, own_actor: true });
    expect(
      (
        await db.query(
          "select sum(amount_xof)::text xof,sum(amount_native)::text native from ledger_entries where unit_id=$1",
          [f.unit],
        )
      ).rows[0],
    ).toEqual({ xof: "0.00", native: "0.30" });
    expect(
      (
        await db.query(
          "select sum(amount_native)::text amount from lease_native_payment_allocations where receivable_id in ($1,$2)",
          [f.rent, f.secondRent],
        )
      ).rows[0].amount,
    ).toBe("0.30");
    expect(
      (
        await db.query(
          "select count(*)::int n from payment_receivable_allocations where receivable_id in ($1,$2)",
          [f.rent, f.secondRent],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.query("select paid_through_date::text value from lease_contracts where id=$1", [
          f.contract,
        ])
      ).rows[0].value,
    ).toBe("2026-08-31");
    expect(
      (await db.query("select status from receivables where id in ($1,$2)", [f.rent, f.secondRent]))
        .rows,
    ).toEqual([{ status: "paid" }, { status: "paid" }]);
    const finance = (
      await db.query("select public.finance_read_rpc('ledger',$1,1,false) value", [
        { projectId: f.project },
      ])
    ).rows[0].value;
    expect(finance.summary.income).toBe(0);
    expect(finance.nativeSummary).toEqual(
      expect.arrayContaining([expect.objectContaining({ currency, income: 0.3 })]),
    );
  },
);

it("returns native decimal query facts but never silently selects an ambiguous contract", async () => {
  const f = await seed();
  await login(f.actor);
  const found = (
    await db.query("select public.query_operator_native_collection($1) value", [
      { contractId: f.contract },
    ])
  ).rows[0].value;
  expect(found).toMatchObject({
    status: "found",
    contract: { id: f.contract, rent_currency: "USD" },
  });
  expect(found.receivables).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: f.rent, outstandingNative: "10.00" })]),
  );
  expect(
    (
      await db.query("select public.query_operator_native_collection($1) value", [
        { contractId: randomUUID() },
      ])
    ).rows[0].value,
  ).toMatchObject({ status: "not_found" });
  const otherContract = randomUUID();
  await owner(
    "insert into lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,paid_through_date,payment_cycle,payment_day,monthly_rent_xof,rent_currency,monthly_rent_amount,status) values($1::uuid,$2,$3,$1::text,'2026-01-01','2027-12-31','2026-08-31','monthly',1,0,'USD',10,'terminated')",
    [otherContract, f.unit, f.customer],
  );
  await login(f.actor);
  const ambiguous = (
    await db.query("select public.query_operator_native_collection($1) value", [
      { buildingCode: f.building, unitNo: "408" },
    ])
  ).rows[0].value;
  expect(ambiguous.status).toBe("selection_required");
  expect(ambiguous.candidates).toHaveLength(2);
  expect(ambiguous.contract).toBeUndefined();
  await expect(
    db.query("select public.query_operator_native_collection($1)", [
      { contractId: f.contract, buildingCode: f.building, unitNo: "408" },
    ]),
  ).rejects.toThrow();
  expect(await counts(f)).toEqual(emptyCounts);
});

it.each(["natural_language", "excel_screenshot"])(
  "retains %s authorization evidence, own actor and explicit collector separately",
  async (inputSource) => {
    const f = await seed();
    const input = request(f, {
      inputSource,
      actualCollector: "振咏",
      collectorBasis: "Synthetic signed receipt",
      externalReceiptNo: "Synthetic receipt 001",
      notes: "Synthetic native note",
    });
    await execute(f, input, await preview(f, input));
    const payment = (
      await owner(
        "select recorded_by,actual_collector,collector_basis,context_confirmed_by from payments where unit_id=$1",
        [f.unit],
      )
    ).rows[0];
    expect(payment).toEqual({
      recorded_by: f.actor,
      actual_collector: "振咏",
      collector_basis: "Synthetic signed receipt",
      context_confirmed_by: f.actor,
    });
    const audits = (
      await db.query(
        "select actor_id,metadata from audit_logs where entity_type='lease_collection' and entity_id=$1",
        [f.contract],
      )
    ).rows;
    expect(audits).toHaveLength(1);
    expect(audits[0].actor_id).toBe(f.actor);
    expect(audits[0].metadata).toMatchObject({
      channel: "external_codex",
      input_source: inputSource,
    });
    expect(JSON.stringify(audits[0].metadata)).toContain(input.originalInstruction);
    expect(JSON.stringify(audits[0].metadata)).not.toContain('"channel":"sacsi_web"');
  },
);

it("recovers or replays only the original actor and request, with no fresh verification claim or duplicate money", async () => {
  const f = await seed();
  const input = request(f),
    snapshot = await preview(f, input);
  expect(await find(f, input.requestId)).toMatchObject({ status: "not_found" });
  const first = await execute(f, input, snapshot);
  const replay = await execute(f, input, snapshot);
  expect(replay).toMatchObject({
    status: "completed_previously",
    verified: false,
    requestId: input.requestId,
    currency: "USD",
    amount: "4.25",
    request: input,
    result: first,
  });
  expect(await find(f, input.requestId)).toMatchObject({
    status: "completed_previously",
    verified: false,
    request: input,
  });
  await expect(
    execute(f, { ...input, notes: "Changed original request" }, snapshot),
  ).rejects.toThrow("nativeCollectionRequestConflict");
  const other = await seed();
  await expect(execute({ ...f, actor: other.actor }, input, snapshot)).rejects.toThrow();
  await expect(find({ ...f, actor: other.actor }, input.requestId)).rejects.toThrow();
  expect(await counts(f)).toEqual({
    payments: 1,
    ledger: 1,
    allocations: 1,
    collections: 1,
    operator_requests: 1,
    audit: 1,
  });
});

it.each([
  { amount: 4.25 },
  { amount: "0" },
  { amount: "-1" },
  { amount: "0.001" },
  { amount: "1e2" },
  { amount: "NaN" },
  { amount: "Infinity" },
  { amount: "9999999999999.00" },
  { currency: "XOF" },
  { currency: "EUR" },
  { exchangeRateToXof: "655.957" },
  { exchange_rate_to_xof: 655.957 },
  { amountXof: 1000 },
  { recordedBy: randomUUID() },
  { executionChannel: "sacsi_web" },
  { humanConfirmed: true },
  { inputSource: "system" },
  { actualCollector: "Unproven collector" },
  { paymentMethod: "offset" },
  { paymentDate: "2026-02-30" },
  { allocations: [] },
])("rejects malformed, FX or actor-injected request %# before any write", async (extra) => {
  const f = await seed();
  await expect(preview(f, request(f, extra))).rejects.toThrow();
  expect(await counts(f)).toEqual(emptyCounts);
});

it("refuses number/extra-precision, duplicate, mismatched or overallocated native lines", async () => {
  const f = await seed();
  for (const allocations of [
    [{ receivableId: f.rent, amount: 4.25 }],
    [{ receivableId: f.rent, amount: "4.250" }],
    [{ receivableId: f.rent, amount: "4.25", amountXof: 1000 }],
    [{ receivableId: f.rent, amount: "4.00" }],
    [
      { receivableId: f.rent, amount: "2.00" },
      { receivableId: f.rent, amount: "2.25" },
    ],
  ])
    await expect(preview(f, request(f, { allocations }))).rejects.toThrow();
  await expect(
    preview(
      f,
      request(f, { amount: "10.01", allocations: [{ receivableId: f.rent, amount: "10.01" }] }),
    ),
  ).rejects.toThrow();
  expect(await counts(f)).toEqual(emptyCounts);
});

it.each([
  "other-contract",
  "other-currency",
  "property-xof",
  "wrong-customer",
  "wrong-unit",
  "wrong-building",
])("refuses %s allocation identities instead of inferring a conversion", async (kind) => {
  const f = await seed(),
    other = await seed("CNY");
  let input: Fields = request(f);
  if (kind === "other-contract")
    input = request(f, { allocations: [{ receivableId: other.rent, amount: "4.25" }] });
  if (kind === "other-currency") input = request(f, { currency: "CNY" });
  if (kind === "property-xof")
    input = request(f, { allocations: [{ receivableId: f.property, amount: "4.25" }] });
  if (kind === "wrong-customer")
    await owner("update receivables set customer_id=$2 where id=$1", [f.rent, other.customer]);
  if (kind === "wrong-unit")
    await owner("update receivables set unit_id=$2 where id=$1", [f.rent, other.unit]);
  if (kind === "wrong-building")
    await owner("update receivables set building_id=$2 where id=$1", [f.rent, other.building]);
  await expect(preview(f, input)).rejects.toThrow();
  expect(await counts(f)).toEqual(emptyCounts);
});

it.each(["historical_pending", "excluded", "cancelled", "paid"])(
  "refuses %s obligations without reactivating historical records",
  async (state) => {
    const f = await seed();
    await owner(
      state === "historical_pending" || state === "excluded"
        ? "update receivables set management_status=$2 where id=$1"
        : "update receivables set status=$2,paid_amount_native=case when $2='paid' then amount_native else paid_amount_native end where id=$1",
      [f.rent, state],
    );
    await expect(preview(f, request(f))).rejects.toThrow();
    expect(await counts(f)).toEqual(emptyCounts);
  },
);

it.each(["customer", "unit", "building"])(
  "does not disclose a corrupt %s-scoped bill through the definer query",
  async (kind) => {
    const f = await seed(),
      other = await seed();
    if (kind === "customer")
      await owner("update receivables set customer_id=$2 where id=$1", [f.rent, other.customer]);
    if (kind === "unit")
      await owner("update receivables set unit_id=$2 where id=$1", [f.rent, other.unit]);
    if (kind === "building")
      await owner("update receivables set building_id=$2 where id=$1", [f.rent, other.building]);
    await login(f.actor);
    const facts = (
      await db.query("select public.query_operator_native_collection($1) value", [
        { contractId: f.contract },
      ])
    ).rows[0].value;
    expect(facts.status).toBe("found");
    expect(facts.receivables.some((row: { id: string }) => row.id === f.rent)).toBe(false);
    expect(facts.receivables.some((row: { id: string }) => row.id === f.secondRent)).toBe(true);
    expect(await counts(f)).toMatchObject({ payments: 0, operator_requests: 0 });
  },
);

it.each(["contract", "receivable", "balance"])(
  "rejects a stale %s snapshot under lock before persisting",
  async (kind) => {
    const f = await seed(),
      input = request(f),
      snapshot = await preview(f, input);
    if (kind === "contract")
      await owner("update lease_contracts set monthly_rent_amount=11 where id=$1", [f.contract]);
    if (kind === "receivable")
      await owner("update receivables set title='Synthetic fact changed' where id=$1", [f.rent]);
    if (kind === "balance")
      await owner("update receivables set paid_amount_native=1,status='partial' where id=$1", [
        f.rent,
      ]);
    await expect(execute(f, input, snapshot)).rejects.toThrow();
    expect(await counts(f)).toEqual(emptyCounts);
  },
);

it("refuses expired previews, malformed deployment and manually altered snapshots", async () => {
  const f = await seed(),
    input = request(f),
    snapshot = await preview(f, input);
  await expect(execute(f, input, snapshot, db, "2000-01-01T00:00:00Z")).rejects.toThrow();
  await expect(execute(f, input, { ...snapshot, contract: {} })).rejects.toThrow();
  await login(f.actor);
  await expect(
    db.query(
      "select public.execute_operator_native_collection($1,$2,clock_timestamp()+interval '5 minutes','')",
      [input, snapshot],
    ),
  ).rejects.toThrow();
  expect(await counts(f)).toEqual(emptyCounts);
});

it("preserves finance's explicit action-grant boundary and rechecks revocation after preview", async () => {
  const f = await seed("CNY", "finance");
  const prior = (
    await owner(
      "select default_roles from private.operator_action_catalog where action_name='record_lease_rent'",
    )
  ).rows[0].default_roles;
  await db.query(
    "update private.operator_action_catalog set default_roles=array['admin'] where action_name='record_lease_rent'",
  );
  try {
    const input = request(f);
    await expect(preview(f, input)).rejects.toThrow();
    await owner(
      "insert into private.operator_action_grants(user_id,action_name,granted_by,grant_reason) values($1,'record_lease_rent',$1,'Synthetic explicit native receipt grant')",
      [f.actor],
    );
    const snapshot = await preview(f, input);
    await owner(
      "update private.operator_action_grants set revoked_at=clock_timestamp() where user_id=$1 and action_name='record_lease_rent'",
      [f.actor],
    );
    await expect(execute(f, input, snapshot)).rejects.toThrow();
    expect(await counts(f)).toEqual(emptyCounts);
    await owner(
      "update private.operator_action_grants set revoked_at=null where user_id=$1 and action_name='record_lease_rent'",
      [f.actor],
    );
    expect(await execute(f, input, snapshot)).toMatchObject({
      status: "completed",
      currency: "CNY",
      verified: true,
    });
  } finally {
    await owner(
      "update private.operator_action_catalog set default_roles=$1 where action_name='record_lease_rent'",
      [prior],
    );
  }
});

it("refuses a reused external receipt even after requerying a fresh balance under another request ID", async () => {
  const f = await seed();
  const input = request(f, { externalReceiptNo: "Synthetic receipt 001" });
  await execute(f, input, await preview(f, input));
  const duplicate = request(f, {
    amount: "1",
    allocations: [{ receivableId: f.rent, amount: "1" }],
    externalReceiptNo: " synthetic RECEIPT 001 ",
  });
  await expect(execute(f, duplicate, await preview(f, duplicate))).rejects.toThrow(
    "nativeCollectionDuplicateReceipt",
  );
  expect(await counts(f)).toEqual({
    payments: 1,
    ledger: 1,
    allocations: 1,
    collections: 1,
    operator_requests: 1,
    audit: 1,
  });
});

it("rechecks the actor's current write capability and unit scope on execution and recovery", async () => {
  const f = await seed(),
    input = request(f),
    snapshot = await preview(f, input);
  await owner("update user_profiles set role='front_desk' where id=$1", [f.actor]);
  await expect(execute(f, input, snapshot)).rejects.toThrow();
  await owner("update user_profiles set role='admin' where id=$1", [f.actor]);
  await execute(f, input, snapshot);
  await owner("update projects set access_mode='restricted' where id=$1", [f.project]);
  await expect(find(f, input.requestId)).rejects.toThrow();
  await expect(execute(f, input, snapshot)).rejects.toThrow();
  await login(f.actor);
  const hidden = (
    await db.query("select public.query_operator_native_collection($1) value", [
      { contractId: f.contract },
    ])
  ).rows[0].value;
  expect(hidden).toMatchObject({ status: "not_found" });
  expect(await counts(f)).toMatchObject({ payments: 1, operator_requests: 1 });
});

it.each(["ledger", "allocation", "audit", "operator-master"])(
  "rolls back every native write when %s persistence fails",
  async (kind) => {
    const f = await seed(),
      input = request(f),
      snapshot = await preview(f, input);
    const target = {
      ledger: "public.ledger_entries",
      allocation: "public.lease_native_payment_allocations",
      audit: "public.audit_logs",
      "operator-master": "private.operator_native_collection_requests",
    }[kind]!;
    await owner(
      "create function private.reject_operator_native_test() returns trigger language plpgsql as $$ begin raise exception 'Synthetic native persistence failure'; end $$",
    );
    await db.query(
      `create trigger reject_operator_native_test before insert on ${target} for each row execute function private.reject_operator_native_test()`,
    );
    try {
      await expect(execute(f, input, snapshot)).rejects.toThrow(
        "Synthetic native persistence failure",
      );
      expect(await counts(f)).toEqual(emptyCounts);
      expect(
        (
          await db.query("select paid_amount_native::text,status from receivables where id=$1", [
            f.rent,
          ])
        ).rows[0],
      ).toEqual({ paid_amount_native: "0.00", status: "pending" });
      expect(await find(f, input.requestId)).toMatchObject({ status: "not_found" });
    } finally {
      await owner(
        `drop trigger reject_operator_native_test on ${target}; drop function private.reject_operator_native_test()`,
      );
    }
  },
);

it("rolls back money if a trigger silently suppresses the durable recovery archive", async () => {
  const f = await seed(),
    input = request(f),
    snapshot = await preview(f, input);
  await owner(
    "create function private.suppress_operator_native_test() returns trigger language plpgsql as $$ begin return null; end $$; create trigger suppress_operator_native_test before insert on private.operator_native_collection_requests for each row execute function private.suppress_operator_native_test()",
  );
  try {
    await expect(execute(f, input, snapshot)).rejects.toThrow("nativeCollectionVerificationFailed");
    expect(await counts(f)).toEqual(emptyCounts);
    expect(await find(f, input.requestId)).toMatchObject({ status: "not_found" });
  } finally {
    await owner(
      "drop trigger suppress_operator_native_test on private.operator_native_collection_requests; drop function private.suppress_operator_native_test()",
    );
  }
});

it("serializes the same original request across two connections and records at most one receipt", async () => {
  const f = await seed(),
    input = request(f),
    snapshot = await preview(f, input),
    other = await cluster.connect();
  try {
    const results = await Promise.all([
      execute(f, input, snapshot, db),
      execute(f, input, snapshot, other),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["completed", "completed_previously"]);
    const completed = results.find((r) => r.status === "completed")!;
    const replay = results.find((r) => r.status === "completed_previously")!;
    expect(replay).toMatchObject({ verified: false, result: { paymentIds: completed.paymentIds } });
    expect(await counts(f)).toEqual({
      payments: 1,
      ledger: 1,
      allocations: 1,
      collections: 1,
      operator_requests: 1,
      audit: 1,
    });
  } finally {
    await other.end();
  }
});

it("serializes competing request IDs without ever overcollecting the remaining balance", async () => {
  const f = await seed(),
    input = request(f, { amount: "10", allocations: [{ receivableId: f.rent, amount: "10" }] });
  const snapshot = await preview(f, input),
    other = await cluster.connect();
  try {
    const results = await Promise.allSettled([
      execute(f, input, snapshot, db),
      execute(f, { ...input, requestId: randomUUID() }, snapshot, other),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await counts(f)).toEqual({
      payments: 1,
      ledger: 1,
      allocations: 1,
      collections: 1,
      operator_requests: 1,
      audit: 1,
    });
    expect(
      (
        await db.query("select paid_amount_native::text,status from receivables where id=$1", [
          f.rent,
        ])
      ).rows[0],
    ).toEqual({ paid_amount_native: "10.00", status: "paid" });
  } finally {
    await other.end();
  }
});

it.each(["USD", "CNY"])(
  "advances %s coverage only with the complete explicitly authorized period proof",
  async (currency) => {
    const f = await seed(currency);
    await owner("update receivables set status='cancelled' where id=$1", [f.secondRent]);
    await db.query(
      "update receivables set service_period_start='2026-09-01',service_period_end='2026-09-30',service_period_source='Synthetic confirmed period' where id=$1",
      [f.rent],
    );
    const stamp = (
      await db.query("select to_jsonb(c)->>'updated_at' stamp from lease_contracts c where id=$1", [
        f.contract,
      ])
    ).rows[0].stamp;
    const input = request(f, {
      amount: "10.00",
      allocations: [{ receivableId: f.rent, amount: "10.00" }],
      coverage: {
        expectedPaidThroughDate: "2026-08-31",
        expectedContractUpdatedAt: stamp,
        throughDate: "2026-09-30",
        receivableIds: [f.rent],
      },
    });
    const result = await execute(f, input, await preview(f, input));
    expect(result).toMatchObject({
      status: "completed",
      currency,
      amount: "10.00",
      paidThroughBefore: "2026-08-31",
      paidThroughAfter: "2026-09-30",
    });
    expect(
      (
        await owner("select paid_through_date::text value from lease_contracts where id=$1", [
          f.contract,
        ])
      ).rows[0].value,
    ).toBe("2026-09-30");
    expect(
      (await db.query("select count(*)::int n from receivables where source_id=$1", [f.contract]))
        .rows[0].n,
    ).toBe(3);
  },
);

it("keeps public wrappers invoker-only, forbids anonymous/service-role calls and hides the owner-only context writer", async () => {
  const signatures = [
    "public.query_operator_native_collection(jsonb)",
    "public.preview_operator_native_collection(jsonb)",
    "public.execute_operator_native_collection(jsonb,jsonb,timestamp with time zone,text)",
    "public.find_operator_native_collection(uuid)",
  ];
  for (const signature of signatures) {
    const grant = (
      await owner(
        "select prosecdef,has_function_privilege('authenticated',oid,'execute') own,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('service_role',oid,'execute') service from pg_proc where oid=$1::regprocedure",
        [signature],
      )
    ).rows[0];
    expect(grant).toEqual({ prosecdef: false, own: true, anon: false, service: false });
  }
  const helpers = (
    await owner(
      "select has_function_privilege('authenticated',oid,'execute') own,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('service_role',oid,'execute') service from pg_proc where pronamespace='private'::regnamespace and proname='record_lease_collection_with_context'",
    )
  ).rows;
  expect(helpers).toHaveLength(1);
  expect(helpers[0]).toEqual({ own: false, anon: false, service: false });
  const f = await seed(),
    input = request(f),
    snapshot = await preview(f, input);
  for (const role of ["anon", "service_role"]) {
    await owner("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: f.actor, role }),
    ]);
    await db.query(`set role ${role}`);
    await expect(
      db.query(
        "select public.execute_operator_native_collection($1,$2,clock_timestamp()+interval '5 minutes','synthetic')",
        [input, snapshot],
      ),
    ).rejects.toThrow("permission denied");
  }
  expect(await counts(f)).toEqual(emptyCounts);
});

it("leaves legacy XOF collection audit provenance on the web channel", async () => {
  const f = await seed();
  await login(f.actor);
  await db.query("select public.lease_collection_rpc($1,$2)", [
    {
      contractId: f.contract,
      paymentDate: "2026-09-22",
      currency: "XOF",
      amount: 40000,
      paymentMethod: "cash",
      allocations: [{ receivableId: f.property, amount: 40000, expectedOutstanding: 40000 }],
    },
    randomUUID(),
  ]);
  const audit = (
    await owner(
      "select metadata from audit_logs where entity_type='lease_collection' and entity_id=$1",
      [f.contract],
    )
  ).rows[0].metadata;
  expect(audit.channel).toBe("sacsi_web");
  expect((await counts(f)).operator_requests).toBe(0);
});

it("reserves a direct collection's request ID against a different legacy XOF write", async () => {
  const f = await seed(),
    input = request(f);
  await execute(f, input, await preview(f, input));
  expect((await owner("select request_id from payments where unit_id=$1", [f.unit])).rows).toEqual([
    { request_id: input.requestId },
  ]);
  await login(f.actor);
  await expect(
    db.query("select public.lease_collection_rpc($1,$2)", [
      {
        contractId: f.contract,
        paymentDate: "2026-09-22",
        currency: "XOF",
        amount: 40000,
        paymentMethod: "cash",
        allocations: [{ receivableId: f.property, amount: 40000, expectedOutstanding: 40000 }],
      },
      input.requestId,
    ]),
  ).rejects.toThrow("requestIdConflict");
  expect(await counts(f)).toEqual({
    payments: 1,
    ledger: 1,
    allocations: 1,
    collections: 1,
    operator_requests: 1,
    audit: 1,
  });
});
