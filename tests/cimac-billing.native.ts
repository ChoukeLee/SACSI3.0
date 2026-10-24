import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { checkNativeAdvisors } from "./helpers/native-advisors";
import type {
  CimacCollectionInput,
  CimacCustomerAccount,
  CimacFeeTermInput,
  CimacMeterReadingInput,
} from "../src/features/finance/cimac-billing-types";

const migrationName = "20261024222516_cimac_customer_billing_workbench.sql";
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
let project: string, building: string;
let migrationPreservedHistory = false;
const admin = randomUUID(),
  finance = randomUUID(),
  boss = randomUUID(),
  denied = randomUUID();
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  const manifest = JSON.parse(
    await readFile("supabase/baselines/rebuild-manifest.json", "utf8"),
  ) as { overlays: Array<{ file: string }> };
  await installApplicationRebuild(
    db,
    manifest.overlays.some((step) => step.file === migrationName)
      ? { beforeMigration: migrationName }
      : {},
  );
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
      "insert into buildings(project_id,code,display_name) values($1,'B1','Synthetic') returning id",
      [project],
    )
  ).rows[0].id;
  const sentinel = await seed();
  await bill(sentinel);
  await owner(
    "insert into payments(customer_id,unit_id,source_type,source_id,payment_date,amount,currency) values($1,$2,'lease_deposit',$3,current_date-1,50000,'XOF')",
    [sentinel.customer, sentinel.unit, sentinel.contract],
  );
  const snapshotSql =
    "select jsonb_build_object('customers',(select jsonb_agg(to_jsonb(x) order by id) from customers x),'contracts',(select jsonb_agg(to_jsonb(x) order by id) from lease_contracts x),'units',(select jsonb_agg(to_jsonb(x) order by id) from units x),'payments',(select jsonb_agg(to_jsonb(x) order by id) from payments x),'ledger',(select jsonb_agg(to_jsonb(x) order by id) from ledger_entries x),'receivables',(select jsonb_agg(to_jsonb(x) order by id) from receivables x),'rules',(select jsonb_agg(to_jsonb(x) order by id) from property_fee_rules x)) value";
  const before = (await owner(snapshotSql)).rows[0].value;
  await db.query(await readFile(`supabase/migrations/${migrationName}`, "utf8"));
  await db.query(
    await readFile(
      "supabase/migrations/20261024223452_cimac_customer_billing_set_based_read.sql",
      "utf8",
    ),
  );
  await db.query(
    await readFile(
      "supabase/migrations/20261024232058_cimac_customer_collection_adjustments.sql",
      "utf8",
    ),
  );
  migrationPreservedHistory =
    JSON.stringify((await owner(snapshotSql)).rows[0].value) === JSON.stringify(before);
}, 45000);
afterAll(async () => {
  await cluster?.close();
});
async function owner(sql: string, params: unknown[] = []) {
  await db.query("reset role");
  return db.query(sql, params);
}
async function login(actor = admin, client = db) {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: "authenticated", email: `${actor}@test.invalid` }),
  ]);
  await client.query("set role authenticated");
}
async function seed(
  options: { customer?: string; foreign?: boolean; currency?: "USD" | "CNY"; status?: string } = {},
) {
  let bid = building;
  if (options.foreign) {
    const pid = (
      await owner("insert into projects(code,display_name) values($1,'Foreign') returning id", [
        randomUUID(),
      ])
    ).rows[0].id;
    bid = (
      await db.query(
        "insert into buildings(project_id,code,display_name) values($1,$2,'Foreign') returning id",
        [pid, randomUUID()],
      )
    ).rows[0].id;
  }
  const customer = options.customer ?? randomUUID(),
    unit = randomUUID(),
    contract = randomUUID();
  await owner("insert into customers(id,name) values($1,$2) on conflict do nothing", [
    customer,
    `Synthetic ${customer}`,
  ]);
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,kind,status,area_sqm) values($1::uuid,$2,$1::text,$1::text,'G','storefront','leased',173)",
    [unit, bid],
  );
  await db.query(
    "insert into lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,rent_currency,monthly_rent_amount,status) values($1::uuid,$2,$3,$1::text,current_date-30,current_date+365,'monthly',1,$4,$5,$6,$7)",
    [
      contract,
      unit,
      customer,
      options.currency ? 0 : 100000,
      options.currency ?? "XOF",
      options.currency ? 100 : null,
      options.status ?? "active",
    ],
  );
  return { customer, unit, contract, building: bid };
}
type Fixture = Awaited<ReturnType<typeof seed>>;
async function bill(
  f: Fixture,
  category = "lease_rent",
  amount = 100000,
  extra: { currency?: "USD" | "CNY"; management?: string; status?: string } = {},
) {
  const id = randomUUID();
  await owner(
    "insert into receivables(id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,currency,amount_native,paid_amount_native,status,management_status) values($1,$2,$3,$4,'lease_contract',$5,$6,'Synthetic bill',current_date-1,$7,0,$8,$9,$10,$11,$12)",
    [
      id,
      f.building,
      f.unit,
      f.customer,
      f.contract,
      category,
      extra.currency ? 0 : amount,
      extra.currency ?? "XOF",
      extra.currency ? amount : null,
      extra.currency ? 0 : null,
      extra.status ?? "pending",
      extra.management ?? "managed",
    ],
  );
  return (await db.query("select id,updated_at::text from receivables where id=$1", [id]))
    .rows[0] as { id: string; updated_at: string };
}
function collection(
  f: Fixture,
  bills: Array<{ id: string; updated_at: string }>,
  amounts = [100000],
): CimacCollectionInput {
  return {
    customerId: f.customer,
    paymentDate: new Date().toISOString().slice(0, 10),
    currency: "XOF",
    amount: String(amounts.reduce((a, b) => a + b, 0)),
    paymentMethod: "bank_transfer",
    allocations: bills.map((b, i) => ({
      receivableId: b.id,
      amount: String(amounts[i]),
      expectedOutstanding: String(amounts[i]),
      expectedUpdatedAt: b.updated_at,
    })),
  };
}
async function write(
  name: string,
  input: unknown,
  requestId = randomUUID(),
  actor = admin,
  client = db,
) {
  await login(actor, client);
  return (await client.query(`select ${name}($1,$2) value`, [input, requestId])).rows[0].value;
}
async function account(customer?: string, actor = admin) {
  await login(actor);
  return (await db.query("select cimac_customer_account_rpc($1) value", [customer ?? null])).rows[0]
    .value as CimacCustomerAccount;
}
function term(f: Fixture): CimacFeeTermInput {
  return {
    customerId: f.customer,
    contractId: f.contract,
    unitId: f.unit,
    category: "property_fee",
    currency: "XOF",
    monthlyRate: "900",
    pricingBasis: "per_sqm",
    chargeableArea: "173",
    annualStartsOn: "2027-04-01",
    annualEndsOn: "2028-03-31",
    proration: "daily_pending_convention",
    source: "Synthetic confirmed policy; start pending",
  };
}
function reading(f: Fixture): CimacMeterReadingInput {
  return {
    customerId: f.customer,
    contractId: f.contract,
    unitId: f.unit,
    meterKind: "water",
    meterNo: "W-1",
    serviceMonth: new Date().toISOString().slice(0, 7) + "-01",
    readOn: new Date().toISOString().slice(0, 10),
    previousReading: "100.123",
    currentReading: "125.456",
  };
}

it("locks down new private relations and anonymous/service-role function execution", async () => {
  expect(migrationPreservedHistory).toBe(true);
  const acl = (
    await owner(
      "select has_function_privilege('anon','public.cimac_collect_customer_rpc(jsonb,uuid)','execute') anon,has_function_privilege('service_role','public.cimac_save_fee_terms_rpc(jsonb,uuid)','execute') service",
    )
  ).rows[0];
  expect(acl).toEqual({ anon: false, service: false });
  await login();
  await expect(db.query("select * from private.cimac_fee_terms")).rejects.toThrow();
  const rls = (
    await owner(
      "select bool_and(relrowsecurity) safe from pg_class where oid in ('private.cimac_fee_terms'::regclass,'private.cimac_meter_readings'::regclass,'private.cimac_billing_requests'::regclass)",
    )
  ).rows[0];
  expect(rls.safe).toBe(true);
  if (process.env.SACSI_RUN_NATIVE_ADVISORS === "1") {
    await owner("select 1");
    await checkNativeAdvisors(db, cluster.port);
  }
});
it("reads one customer's multiple asset types, historical contracts and separate native balances", async () => {
  const a = await seed(),
    b = await seed({ customer: a.customer, status: "terminated" }),
    c = await seed({ customer: a.customer, currency: "USD" });
  await owner("update units set kind='apartment' where id=$1", [b.unit]);
  await db.query("update units set kind='warehouse' where id=$1", [c.unit]);
  await bill(a);
  await bill(b, "property_fee", 57600);
  await bill(c, "lease_rent", 200, { currency: "USD" });
  await bill(a, "property_fee", 10000, { management: "historical_pending" });
  const result = await account(a.customer);
  expect(result.complete).toBe(true);
  expect(result.units).toHaveLength(3);
  expect(result.contracts).toHaveLength(3);
  expect(result.contracts.some((c) => c.status === "terminated")).toBe(true);
  expect(result.customer?.balances).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ currency: "XOF", outstanding: "157600.00" }),
      expect.objectContaining({ currency: "USD", outstanding: "200.00" }),
    ]),
  );
  expect(result.receivables.every((r) => r.service_period_start === null)).toBe(true);
  expect(result.receivables.filter((r) => r.collectible)).toHaveLength(2);
});
it("does not merge identical names or expose foreign customers and rejects explicit unknown IDs", async () => {
  const a = await seed(),
    b = await seed({ foreign: true });
  await owner("update customers set name='Same' where id=any($1::uuid[])", [
    [a.customer, b.customer],
  ]);
  const result = await account(a.customer);
  expect(result.units).toHaveLength(1);
  await expect(account(b.customer)).rejects.toThrow("cimacBillingTargetMismatch");
  await expect(account(randomUUID())).rejects.toThrow("cimacBillingTargetMismatch");
});

it("searches authorized lease and sale contract numbers without matching foreign-project contracts", async () => {
  const local = await seed(),
    foreign = await seed({ foreign: true });
  const leaseNo = `CIMAC-LEASE-${randomUUID()}`,
    saleNo = `CIMAC-SALE-${randomUUID()}`;
  // Contract numbers are globally unique; the foreign matching token appears
  // in a different complete number, not a duplicate contract identity.
  await owner("update lease_contracts set contract_no=$1 where id=$2", [leaseNo, local.contract]);
  await db.query("update lease_contracts set contract_no=$1 where id=$2", [
    `${leaseNo}-FOREIGN`,
    foreign.contract,
  ]);
  const saleId = randomUUID();
  await owner("update projects set allows_sale=true where id=$1", [project]);
  await owner(
    "insert into sale_contracts(id,unit_id,customer_id,contract_no,signed_date,payment_plan_type,status) values($1,$2,$3,$4,current_date,'lump_sum','draft')",
    [saleId, local.unit, local.customer, saleNo],
  );
  for (const query of [leaseNo, saleNo]) {
    await login();
    const result = (await db.query("select cimac_customer_account_rpc(null,$1,1) value", [query]))
      .rows[0].value;
    expect(result.customerPage.rows.map((c: { id: string }) => c.id)).toEqual([local.customer]);
    expect(result.selectedCustomerId).toBe(local.customer);
  }
  await login();
  const foreignOnly = (
    await db.query("select cimac_customer_account_rpc(null,$1,1) value", [`${leaseNo}-FOREIGN`])
  ).rows[0].value;
  expect(foreignOnly.customerPage.rows).toHaveLength(0);
  expect(foreignOnly.selectedCustomerId).toBe(null);
});

it("retains authorized building-only legacy balances without inventing a room or contract link", async () => {
  const customer = randomUUID();
  await owner("insert into customers(id,name) values($1,'Synthetic building account')", [customer]);
  await db.query(
    "insert into receivables(customer_id,building_id,source_type,category,title,due_date,amount_xof,currency) values($1,$2,'manual','other','Building-only historical balance',current_date,500,'XOF')",
    [customer, building],
  );
  const result = await account(customer);
  expect(result.units).toHaveLength(0);
  expect(result.contracts).toHaveLength(0);
  expect(result.receivables).toHaveLength(1);
  expect(result.receivables[0].collectible).toBe(false);
  expect(result.customer?.balances[0].outstanding).toBe("500.00");
});
it("boss reads while front desk and boss writes are denied; revoked project access applies immediately", async () => {
  const f = await seed();
  expect((await account(f.customer, boss)).canWrite).toBe(false);
  await expect(account(f.customer, denied)).rejects.toThrow("cimacBillingPermissionDenied");
  await expect(write("cimac_save_fee_terms_rpc", term(f), randomUUID(), boss)).rejects.toThrow(
    "cimacBillingPermissionDenied",
  );
  await owner("update projects set access_mode='restricted' where id=$1", [project]);
  await expect(account(f.customer, finance)).rejects.toThrow("cimacBillingPermissionDenied");
  await owner("update projects set access_mode='open' where id=$1", [project]);
});
it("stores pending terms without changing legacy contract, bills, receipts or property rules", async () => {
  const f = await seed();
  const before = (
    await owner("select to_jsonb(c) value from lease_contracts c where id=$1", [f.contract])
  ).rows[0].value;
  const input = term(f),
    rid = randomUUID();
  const result = await write("cimac_save_fee_terms_rpc", input, rid, finance);
  expect(result).toMatchObject({
    success: true,
    kind: "fee_terms",
    record: { status: "pending_review", startsOn: null, monthlyRate: "900", recordedBy: finance },
  });
  expect((await write("cimac_save_fee_terms_rpc", input, rid, finance)).idempotent).toBe(true);
  await expect(
    write("cimac_save_fee_terms_rpc", { ...input, monthlyRate: "901" }, rid, finance),
  ).rejects.toThrow("cimacBillingRequestIdConflict");
  expect(
    (await owner("select to_jsonb(c) value from lease_contracts c where id=$1", [f.contract]))
      .rows[0].value,
  ).toEqual(before);
  expect(
    (
      await db.query(
        "select (select count(*) from receivables where unit_id=$1)+(select count(*) from payments where unit_id=$1)+(select count(*) from property_fee_rules where unit_id=$1) n",
        [f.unit],
      )
    ).rows[0].n,
  ).toBe("0");
});
it("edits terms with an audited fresh timestamp and refuses stale or reassigned updates", async () => {
  const f = await seed(),
    g = await seed();
  const input = term(f);
  const first = await write("cimac_save_fee_terms_rpc", input);
  const update = {
    ...input,
    id: first.entityId,
    expectedUpdatedAt: first.record.updatedAt,
    notes: "Reviewed description only",
  };
  const second = await write("cimac_save_fee_terms_rpc", update, randomUUID(), finance);
  expect(second.record.recordedBy).toBe(finance);
  await expect(write("cimac_save_fee_terms_rpc", update)).rejects.toThrow(
    "cimacBillingSnapshotChanged",
  );
  await expect(
    write("cimac_save_fee_terms_rpc", {
      ...term(g),
      id: first.entityId,
      expectedUpdatedAt: second.record.updatedAt,
    }),
  ).rejects.toThrow("cimacBillingTargetMismatch");
});
it("saves exact meter usage, leaves rates pending and does not invent missing previous readings", async () => {
  const f = await seed();
  const input = reading(f);
  const rid = randomUUID();
  const result = await write("cimac_save_meter_reading_rpc", input, rid);
  expect(result.record).toMatchObject({ usage: "25.333", status: "recorded_pending_rate" });
  expect((await write("cimac_save_meter_reading_rpc", input, rid)).idempotent).toBe(true);
  const blank = { ...input, meterKind: "electricity", previousReading: null };
  expect((await write("cimac_save_meter_reading_rpc", blank)).record.usage).toBe(null);
  expect(
    (await owner("select count(*)::int n from receivables where unit_id=$1", [f.unit])).rows[0].n,
  ).toBe(0);
});
it("rejects invalid readings, duplicate month observations and unconfirmed price inputs", async () => {
  const f = await seed();
  for (const input of [
    { ...reading(f), currentReading: "1" },
    { ...reading(f), currentReading: "125.1234" },
    { ...reading(f), unitPrice: "100" },
    { ...reading(f), currentReading: 125 },
  ])
    await expect(write("cimac_save_meter_reading_rpc", input)).rejects.toThrow();
  await write("cimac_save_meter_reading_rpc", reading(f));
  await expect(write("cimac_save_meter_reading_rpc", reading(f))).rejects.toThrow();
  await expect(
    write("cimac_save_fee_terms_rpc", { ...term(f), status: "confirmed" }),
  ).rejects.toThrow("cimacBillingInvalidInput");
});
it("collects cross-contract rent and property bills as ONE receipt with exact allocation and per-unit ledger", async () => {
  const a = await seed(),
    b = await seed({ customer: a.customer });
  const x = await bill(a),
    y = await bill(b, "property_fee", 57600);
  const input = collection(a, [x, y], [100000, 57600]),
    rid = randomUUID();
  const before = (
    await owner(
      "select jsonb_agg(to_jsonb(c) order by c.id) value from lease_contracts c where id=any($1::uuid[])",
      [[a.contract, b.contract]],
    )
  ).rows[0].value;
  const result = await write("cimac_collect_customer_rpc", input, rid);
  expect(result).toMatchObject({
    success: true,
    kind: "collection",
    amount: "157600",
    currency: "XOF",
  });
  expect(result.allocations).toHaveLength(2);
  expect(new Set(result.allocations.map((a: { paymentId: string }) => a.paymentId)).size).toBe(1);
  const facts = (
    await owner(
      "select (select count(*) from payments where request_id=$1)::int receipts,(select count(*) from ledger_entries where payment_id=$2)::int ledger,(select sum(amount_xof)::text from payment_receivable_allocations where payment_id=$2) allocated",
      [rid, result.paymentId],
    )
  ).rows[0];
  expect(facts).toEqual({ receipts: 1, ledger: 2, allocated: "157600.00" });
  expect(
    (
      await db.query(
        "select jsonb_agg(to_jsonb(c) order by c.id) value from lease_contracts c where id=any($1::uuid[])",
        [[a.contract, b.contract]],
      )
    ).rows[0].value,
  ).toEqual(before);
  expect((await write("cimac_collect_customer_rpc", input, rid)).idempotent).toBe(true);
  expect((await account(a.customer)).payments).toHaveLength(1);
});
it("rejects cross-customer, mixed currency, deposits, cancelled and historical pending bill allocations atomically", async () => {
  const a = await seed(),
    b = await seed(),
    native = await seed({ customer: a.customer, currency: "USD" });
  const own = await bill(a),
    foreign = await bill(b),
    usd = await bill(native, "lease_rent", 200, { currency: "USD" });
  const deposit = await bill(a, "lease_deposit"),
    pending = await bill(a, "property_fee", 100000, { management: "historical_pending" }),
    cancelled = await bill(a, "property_fee", 100000, { status: "cancelled" });
  for (const target of [foreign, usd, deposit, pending, cancelled])
    await expect(
      write(
        "cimac_collect_customer_rpc",
        collection(a, [own, target], [100000, target === usd ? 200 : 100000]),
      ),
    ).rejects.toThrow();
  expect(
    (await owner("select paid_amount_xof::text paid from receivables where id=$1", [own.id]))
      .rows[0].paid,
  ).toBe("0.00");
  await expect(
    write("cimac_collect_customer_rpc", { ...collection(a, [own]), currency: "USD" }),
  ).rejects.toThrow("cimacBillingUnsupportedCurrency");
});
it("refuses over-allocation, stale expected timestamps, duplicate bill IDs, mismatched totals and numeric money", async () => {
  const f = await seed(),
    b = await bill(f),
    input = collection(f, [b]);
  for (const invalid of [
    { ...input, amount: 100000 },
    { ...input, amount: "100001" },
    {
      ...input,
      allocations: [{ ...input.allocations[0], amount: "100001", expectedOutstanding: "100001" }],
      amount: "100001",
    },
    {
      ...input,
      allocations: [{ ...input.allocations[0], expectedUpdatedAt: "2020-01-01T00:00:00Z" }],
    },
    { ...input, amount: "200000", allocations: [input.allocations[0], input.allocations[0]] },
    { ...input, amount: "0.01", allocations: [{ ...input.allocations[0], amount: "0.01" }] },
  ])
    await expect(write("cimac_collect_customer_rpc", invalid)).rejects.toThrow();
  expect(
    (await owner("select count(*)::int n from payments where customer_id=$1", [f.customer])).rows[0]
      .n,
  ).toBe(0);
});
it("serializes identical concurrent retries and rejects competing fresh requests against one balance", async () => {
  const f = await seed(),
    b = await bill(f),
    input = collection(f, [b]),
    rid = randomUUID(),
    other = await cluster.connect();
  const outputs = await Promise.all([
    write("cimac_collect_customer_rpc", input, rid, admin, db),
    write("cimac_collect_customer_rpc", input, rid, admin, other),
  ]);
  expect(outputs.map((r) => r.idempotent).sort()).toEqual([false, true]);
  expect(outputs[0].paymentId).toBe(outputs[1].paymentId);
  const g = await seed(),
    due = await bill(g),
    next = collection(g, [due]);
  const competing = await Promise.allSettled([
    write("cimac_collect_customer_rpc", next, randomUUID(), admin, db),
    write("cimac_collect_customer_rpc", next, randomUUID(), admin, other),
  ]);
  expect(competing.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  await other.end();
});
it("restores exact own receipts after unknown outcome, denies request ID reuse and hides another actor's result", async () => {
  const f = await seed(),
    b = await bill(f),
    input = collection(f, [b]),
    rid = randomUUID();
  const first = await write("cimac_collect_customer_rpc", input, rid);
  await login();
  const restored = (await db.query("select cimac_billing_request_rpc($1) value", [rid])).rows[0]
    .value;
  expect(restored.paymentId).toBe(first.paymentId);
  expect(restored.idempotent).toBe(true);
  await expect(
    write("cimac_collect_customer_rpc", { ...input, notes: "Changed" }, rid),
  ).rejects.toThrow("cimacBillingRequestIdConflict");
  await login(finance);
  expect(
    (await db.query("select cimac_billing_request_rpc($1) value", [rid])).rows[0].value.status,
  ).toBe("not_found");
});
it("protects new headers, ledgers, allocations and reversal references from old direct mutation paths", async () => {
  const f = await seed(),
    b = await bill(f),
    result = await write("cimac_collect_customer_rpc", collection(f, [b]));
  await owner("select 1");
  for (const [sql, args] of [
    ["update payments set notes='wrong' where id=$1", [result.paymentId]],
    ["delete from payments where id=$1", [result.paymentId]],
    ["update ledger_entries set amount_xof=1 where payment_id=$1", [result.paymentId]],
    ["delete from payment_receivable_allocations where payment_id=$1", [result.paymentId]],
    [
      "insert into payments(customer_id,source_type,source_id,payment_date,amount,currency,reversal_of_payment_id) values($1,'manual',$1,current_date,-1,'XOF',$2)",
      [f.customer, result.paymentId],
    ],
  ] as Array<[string, unknown[]]>)
    await expect(db.query(sql, args)).rejects.toThrow("cimacBillingProtectedPayment");
});
it("includes grouped receipts exactly once in finance and operating cash projection", async () => {
  const f = await seed(),
    g = await seed({ customer: f.customer });
  const x = await bill(f),
    y = await bill(g, "property_fee", 57600);
  await login();
  const before = (await db.query("select management_operating_snapshot_rpc($1) value", [project]))
    .rows[0].value;
  await write("cimac_collect_customer_rpc", collection(f, [x, y], [100000, 57600]));
  await login();
  const after = (await db.query("select management_operating_snapshot_rpc($1) value", [project]))
    .rows[0].value;
  expect(Number(after.netCollected) - Number(before.netCollected)).toBe(157600);
  expect(Number(after.businessNet.lease) - Number(before.businessNet.lease)).toBe(100000);
  expect(Number(after.businessNet.asset) - Number(before.businessNet.asset)).toBe(57600);
  expect(Number(after.trend.at(-1).count) - Number(before.trend.at(-1).count)).toBe(1);
  const ledger = (
    await db.query(
      "select finance_read_rpc('ledger',jsonb_build_object('projectId',$1::text),1,false) value",
      [project],
    )
  ).rows[0].value;
  expect(ledger.rows.some((r: { category: string }) => r.category === "property_fee")).toBe(true);
});

it("does not report fully proven customer split receipts as duplicate ledger anomalies", async () => {
  const a = await seed(),
    b = await seed({ customer: a.customer });
  const x = await bill(a),
    y = await bill(b, "property_fee", 57600);
  const result = await write("cimac_collect_customer_rpc", collection(a, [x, y], [100000, 57600]));
  await login();
  expect(
    (await db.query("select private.cimac_customer_collection_proof($1) valid", [result.paymentId]))
      .rows[0].valid,
  ).toBe(true);
  const issues = (await db.query("select finance_reconciliation_rpc() value")).rows[0].value.issues;
  expect(issues.some((i: { entity_id: string }) => i.entity_id === result.paymentId)).toBe(false);
  const context = (await db.query("select payment_context_read_rpc($1) value", [result.paymentId]))
    .rows[0].value;
  expect(context).toMatchObject({
    paymentId: result.paymentId,
    amount: 157600,
    unitId: null,
    buildingId: null,
    allocatedXof: 157600,
    readOnly: true,
  });
  expect(context.allocations).toHaveLength(2);
  expect(
    (await db.query("select cimac_customer_collection_proof_rpc($1) valid", [result.paymentId]))
      .rows[0].valid,
  ).toBe(true);
  const unknown = randomUUID();
  expect(
    (
      await db.query("select cimac_customer_collection_proofs_rpc($1::uuid[]) value", [
        [result.paymentId, unknown],
      ])
    ).rows[0].value,
  ).toEqual([
    { paymentId: result.paymentId, verified: true },
    { paymentId: unknown, verified: false },
  ]);
  await expect(
    db.query("select cimac_customer_collection_proofs_rpc($1::uuid[])", [
      [result.paymentId, result.paymentId],
    ]),
  ).rejects.toThrow("cimacBillingInvalidInput");
});

it("retains old duplicate-ledger alerts and detects balanced but damaged new split receipts", async () => {
  const a = await seed(),
    b = await seed({ customer: a.customer });
  const x = await bill(a),
    y = await bill(b, "property_fee", 57600);
  const result = await write("cimac_collect_customer_rpc", collection(a, [x, y], [100000, 57600]));
  const legacy = randomUUID();
  await owner(
    "insert into payments(id,customer_id,unit_id,source_type,source_id,payment_date,amount,currency) values($1,$2,$3,'lease_rent',$4,current_date,10,'XOF')",
    [legacy, a.customer, a.unit, a.contract],
  );
  await db.query(
    "insert into ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof) values($1,$2,$3,current_date,'income','lease_rent',5),($1,$2,$3,current_date,'income','lease_rent',5)",
    [a.building, a.unit, legacy],
  );
  // Deliberate corruption only in this fresh ephemeral test cluster. The
  // public writer cannot bypass the guard; the separate guard test proves it.
  await db.query(
    "alter table ledger_entries disable trigger guard_cimac_customer_collection_ledger",
  );
  await db.query(
    "update ledger_entries set category='lease_rent' where payment_id=$1 and category='property_fee'",
    [result.paymentId],
  );
  await db.query(
    "alter table ledger_entries enable trigger guard_cimac_customer_collection_ledger",
  );
  await login();
  const issues = (await db.query("select finance_reconciliation_rpc() value")).rows[0].value.issues;
  expect(issues).toEqual(
    expect.arrayContaining([
      { code: "duplicate_payment_ledger", entity_id: legacy },
      { code: "duplicate_payment_ledger", entity_id: result.paymentId },
      { code: "cimac_customer_collection_mismatch", entity_id: result.paymentId },
    ]),
  );
  await expect(
    db.query("select cimac_lease_collection_projection_rpc($1)", [a.contract]),
  ).rejects.toThrow("cimacBillingVerificationFailed");
});

it("projects exact per-contract allocations while preserving the original receipt header and legacy authorization", async () => {
  const a = await seed(),
    b = await seed({ customer: a.customer }),
    other = await seed({ foreign: true });
  const x = await bill(a),
    y = await bill(b, "property_fee", 57600);
  const result = await write("cimac_collect_customer_rpc", collection(a, [x, y], [100000, 57600]));
  await login(denied);
  const first = (
    await db.query("select cimac_lease_collection_projection_rpc($1) value", [a.contract])
  ).rows[0].value;
  expect(first.paymentCount).toBe(1);
  expect(first.payments[0].id).toBe(result.paymentId);
  expect(first.payments[0].amount).toBe(157600);
  expect(first.payments[0].source_id).toBe(a.customer);
  expect(first.payments[0].cimac_contract_allocation).toEqual({
    contractId: a.contract,
    amount: "100000.00",
    currency: "XOF",
    receivableIds: [x.id],
  });
  const second = (
    await db.query("select cimac_lease_collection_projection_rpc($1) value", [b.contract])
  ).rows[0].value;
  expect(second.payments[0].amount).toBe(157600);
  expect(second.payments[0].cimac_contract_allocation.amount).toBe("57600.00");
  expect(
    (await db.query("select cimac_lease_collection_projection_rpc($1) value", [other.contract]))
      .rows[0].value,
  ).toEqual({ contractId: other.contract, paymentCount: 0, payments: [] });
  await owner("update projects set access_mode='restricted' where id=$1", [project]);
  await login(denied);
  await expect(
    db.query("select cimac_lease_collection_projection_rpc($1)", [a.contract]),
  ).rejects.toThrow("cimacBillingPermissionDenied");
  await owner("update projects set access_mode='open' where id=$1", [project]);
});
it("new collection visibility follows CIMAC project permission, not null-unit legacy permissiveness", async () => {
  const f = await seed(),
    b = await bill(f),
    result = await write("cimac_collect_customer_rpc", collection(f, [b]));
  await owner("update projects set access_mode='restricted' where id=$1", [project]);
  await login(finance);
  expect(
    (await db.query("select id from payments where id=$1", [result.paymentId])).rows,
  ).toHaveLength(0);
  await owner("update projects set access_mode='open' where id=$1", [project]);
});

it("lets finance read new audited mutations only while current CIMAC access remains authorized", async () => {
  const f = await seed();
  const fee = await write("cimac_save_fee_terms_rpc", term(f), randomUUID(), finance);
  await login(finance);
  const visible = (await db.query("select metadata from audit_logs where id=$1", [fee.auditId]))
    .rows;
  expect(visible).toHaveLength(1);
  expect(visible[0].metadata.project_id).toBe(project);
  expect(visible[0].metadata.unit_id).toBe(f.unit);
  await owner("update projects set access_mode='restricted' where id=$1", [project]);
  await login(finance);
  expect(
    (await db.query("select id from audit_logs where id=$1", [fee.auditId])).rows,
  ).toHaveLength(0);
  await owner("update projects set access_mode='open' where id=$1", [project]);
});

it("paginates customer directory without truncating selected account records", async () => {
  const target = await seed();
  await owner("insert into customers(name) select 'Paging '||i::text from generate_series(1,55) i");
  // Unrelated customers without a scoped asset must not be listed.
  await login();
  const first = (
    await db.query("select cimac_customer_account_rpc($1,null,1) value", [target.customer])
  ).rows[0].value;
  expect(first.customerPage.pageSize).toBe(50);
  expect(first.selectedCustomerId).toBe(target.customer);
  expect(first.units).toHaveLength(1);
  await expect(db.query("select cimac_customer_account_rpc(null,null,0)")).rejects.toThrow(
    "cimacBillingInvalidInput",
  );
});

it("fails closed rather than returning a silently incomplete large account", async () => {
  const f = await seed();
  await owner(
    "insert into receivables(building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,currency) select $1,$2,$3,'lease_contract',$4,'property_fee','Large synthetic bill',current_date+i,1,'XOF' from generate_series(1,10001) i",
    [f.building, f.unit, f.customer, f.contract],
  );
  await expect(account(f.customer)).rejects.toThrow("cimacBillingAccountTooLarge");
});
