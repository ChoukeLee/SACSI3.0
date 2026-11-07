import { randomUUID } from "node:crypto";
import type pg from "pg";
import { beforeAll, afterAll, expect, it } from "vitest";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";

let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>;
let db: pg.Client;

beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await installApplicationRebuild(db);
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
async function seed(role = "admin") {
  const actor = randomUUID(),
    project = randomUUID(),
    building = randomUUID(),
    unit = randomUUID();
  await owner("insert into auth.users(id,email) values($1,$2)", [actor, `${actor}@test.invalid`]);
  await db.query(
    "insert into public.user_profiles(id,role,display_name) values($1,$2,'Synthetic')",
    [actor, role],
  );
  await db.query("insert into public.projects(id,code,display_name) values($1,$2,'Synthetic')", [
    project,
    project,
  ]);
  await db.query(
    "insert into public.buildings(id,project_id,code,display_name) values($1,$2,$3,'Synthetic')",
    [building, project, building],
  );
  await db.query(
    "insert into public.units(id,building_id,code,unit_no,floor_label) values($1,$2,$3,'1','1')",
    [unit, building, unit],
  );
  await login(actor);
  return { actor, project, building, unit };
}
const row = (extra = {}) => ({
  sourceKey: "old_warehouse:1",
  code: "OW-1",
  name: "Old warehouse 1",
  group: "old_warehouse",
  sourceRefs: ["sha256:synthetic/old!A2:J2"],
  monthlyRentNative: 375000,
  rentCurrency: "XOF",
  ...extra,
});
const source = (projectId: string, assets = [row()]) => ({
  projectId,
  sourceFingerprint: "a".repeat(64),
  assets,
});
async function write(operation: string, input: unknown, request = randomUUID(), client = db) {
  return (
    await client.query("select public.asset_operations_write_rpc($1,$2,$3) value", [
      operation,
      input,
      request,
    ])
  ).rows[0].value;
}
async function read(project: string) {
  return (await db.query("select public.asset_operations_read_rpc($1) value", [project])).rows[0]
    .value;
}
async function catalog(f: Awaited<ReturnType<typeof seed>>, extra = {}) {
  await write("import_catalog", source(f.project, [row(extra)]));
  return (await read(f.project)).assets[0];
}
async function verified(f: Awaited<ReturnType<typeof seed>>, extra = {}) {
  const asset = await catalog(f, extra);
  await write("confirm_asset", {
    assetId: asset.id,
    expectedUpdatedAt: asset.updatedAt,
    reason: "Physical identity checked",
  });
  return (await read(f.project)).assets[0];
}
function entry(asset: { id: string; updatedAt: string }, extra = {}) {
  return {
    assetId: asset.id,
    expectedUpdatedAt: asset.updatedAt,
    kind: "income",
    amountNative: 100,
    currency: "USD",
    cashDate: "2026-09-01",
    periodStart: "2026-10-01",
    periodEnd: "2027-03-31",
    verification: "verified",
    sourceRef: `synthetic:${randomUUID()}`,
    description: "Synthetic actual receipt",
    ...extra,
  };
}

it("imports source assets as pending, deduplicates source copies and atomically rejects changed content", async () => {
  const f = await seed(),
    input = source(f.project),
    request = randomUUID();
  expect((await write("import_catalog", input, request)).idempotent).toBe(false);
  expect((await write("import_catalog", input, request)).idempotent).toBe(true);
  await write("import_catalog", input);
  await write("import_catalog", { ...input, sourceFingerprint: "b".repeat(64) });
  const data = await read(f.project);
  expect(data.assets).toHaveLength(1);
  expect(data.assets[0]).toMatchObject({
    verification: "pending",
    monthlyRentNative: 375000,
    rentCurrency: "XOF",
    costCoverageThrough: null,
  });
  expect(data.entries).toEqual([]);
  await expect(
    write("import_catalog", source(f.project, [row({ name: "Changed" })])),
  ).rejects.toThrow("assetSourceChanged");
  await expect(
    write(
      "import_catalog",
      source(f.project, [
        row({ sourceKey: "new:2", code: "2" }),
        row({ sourceKey: "new:3", name: "" }),
      ]),
    ),
  ).rejects.toThrow("invalidAssetSource");
  expect((await read(f.project)).assets).toHaveLength(1);
});

it("requires explicit source identity confirmation and rejects stale catalog versions", async () => {
  const f = await seed(),
    asset = await catalog(f);
  await expect(write("create_entry", entry(asset))).rejects.toThrow("assetConfirmationRequired");
  const payload = {
    assetId: asset.id,
    expectedUpdatedAt: asset.updatedAt,
    reason: "Identity checked",
  };
  await write("confirm_asset", payload);
  await expect(write("confirm_asset", payload)).rejects.toThrow("assetOperationRecordChanged");
  await expect(write("create_entry", entry(asset))).rejects.toThrow("assetOperationRecordChanged");
  expect((await read(f.project)).assets[0].verification).toBe("verified");
});

it("preserves native amount and separates cash/service dates without authorizing daily recognition by default", async () => {
  const f = await seed(),
    asset = await verified(f),
    input = entry(asset),
    request = randomUUID();
  await write("create_entry", input, request);
  expect((await write("create_entry", input, request)).idempotent).toBe(true);
  const data = await read(f.project);
  expect(data.entries).toHaveLength(1);
  expect(data.entries[0]).toMatchObject({
    amountNative: 100,
    currency: "USD",
    cashDate: "2026-09-01",
    periodStart: "2026-10-01",
    periodEnd: "2027-03-31",
    recognitionMethod: "unallocated",
  });
  const counts = (
    await owner(
      "select (select count(*)::int from payments) payments,(select count(*)::int from ledger_entries) ledger",
    )
  ).rows[0];
  expect(counts).toEqual({ payments: 0, ledger: 0 });
  const audits = await db.query(
    "select actor_id,metadata->>'request_id' request from audit_logs where metadata->>'request_id'=$1",
    [request],
  );
  expect(audits.rows).toEqual([{ actor_id: f.actor, request }]);
});

it("rejects invalid dates, unsupported currency, unbacked sources and deposit recognition", async () => {
  const f = await seed(),
    asset = await verified(f);
  for (const extra of [
    { amountNative: -1 },
    { amountNative: "NaN" },
    { amountNative: 1.001 },
    { currency: "EUR" },
    { sourceRef: "" },
    { cashDate: "infinity" },
    { cashDate: "2099-01-01" },
    { periodStart: "2026-12-01", periodEnd: "2026-10-01" },
    { periodStart: null },
    { kind: "deposit_in" },
    { recognitionMethod: "automatic" },
    { recognitionMethod: "daily", periodStart: null, periodEnd: null },
  ])
    await expect(write("create_entry", entry(asset, extra))).rejects.toThrow("invalidAssetEntry");
  expect((await read(f.project)).entries).toEqual([]);
});

it("supports pending-entry confirmation with a reason and CAS without creating a second money event", async () => {
  const f = await seed(),
    asset = await verified(f);
  await write(
    "create_entry",
    entry(asset, { verification: "pending", recognitionMethod: "daily" }),
  );
  const original = (await read(f.project)).entries[0];
  await write("confirm_entry", {
    entryId: original.id,
    expectedUpdatedAt: original.updatedAt,
    reason: "Original receipt inspected",
  });
  const entries = (await read(f.project)).entries;
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    id: original.id,
    amountNative: 100,
    verification: "verified",
    recognitionMethod: "daily",
  });
  await expect(
    write("confirm_entry", {
      entryId: original.id,
      expectedUpdatedAt: original.updatedAt,
      reason: "Again",
    }),
  ).rejects.toThrow("assetOperationRecordChanged");
});

it("checks current role and project permission before returning a completed request", async () => {
  const f = await seed(),
    input = source(f.project),
    request = randomUUID();
  await write("import_catalog", input, request);
  await owner("update user_profiles set role='boss' where id=$1", [f.actor]);
  await login(f.actor);
  await expect(write("import_catalog", input, request)).rejects.toThrow(
    "assetOperationPermissionDenied",
  );
  expect((await read(f.project)).canWrite).toBe(false);
  await owner("update user_profiles set role='admin' where id=$1", [f.actor]);
  await db.query("update projects set access_mode='restricted' where id=$1", [f.project]);
  await login(f.actor);
  await expect(write("import_catalog", input, request)).rejects.toThrow(
    "assetOperationAccessDenied",
  );
  await expect(read(f.project)).rejects.toThrow("assetOperationAccessDenied");
  expect(
    (
      await db.query("select count(*)::int n from asset_operation_assets where project_id=$1", [
        f.project,
      ])
    ).rows[0].n,
  ).toBe(0);
});

it("does not grant direct mutation or anonymous access and blocks cross-project canonical links", async () => {
  const f = await seed(),
    other = await seed();
  await login(f.actor);
  await expect(
    write("import_catalog", source(f.project, [row({ unitId: other.unit })])),
  ).rejects.toThrow("assetUnitProjectMismatch");
  const asset = await catalog(f);
  await expect(
    db.query("update asset_operation_assets set verification='verified' where id=$1", [asset.id]),
  ).rejects.toThrow("permission denied");
  await db.query("reset role");
  await db.query("set role anon");
  await expect(read(f.project)).rejects.toThrow("permission denied");
  await expect(write("create_entry", entry(asset))).rejects.toThrow("permission denied");
});

it("links a canonical payment once, validates its ledger and does not repost the original receipt", async () => {
  const f = await seed(),
    asset = await verified(f, { unitId: f.unit });
  const payment = randomUUID(),
    ledger = randomUUID();
  await owner(
    "insert into payments(id,unit_id,source_type,payment_date,amount,currency,exchange_rate_to_xof) values($1,$2,'manual','2026-09-01',100,'USD',600)",
    [payment, f.unit],
  );
  await db.query(
    "insert into ledger_entries(id,building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,currency,amount_native) values($1,$2,$3,$4,'2026-09-01','income','other_income',0,'USD',100)",
    [ledger, f.building, f.unit, payment],
  );
  await login(f.actor);
  await expect(
    write("create_entry", entry(asset, { paymentId: payment, amountNative: 200 })),
  ).rejects.toThrow("assetPaymentLinkMismatch");
  await write("create_entry", entry(asset, { paymentId: payment }));
  await expect(write("create_entry", entry(asset, { ledgerEntryId: ledger }))).rejects.toThrow(
    "assetSourceAlreadyRecorded",
  );
  const counts = (
    await owner(
      "select (select count(*)::int from payments where id=$1) payments,(select count(*)::int from ledger_entries where id=$2) ledger",
      [payment, ledger],
    )
  ).rows[0];
  expect(counts).toEqual({ payments: 1, ledger: 1 });
});

it("serializes duplicate source submissions and rejects request payload reuse", async () => {
  const f = await seed(),
    asset = await verified(f),
    input = entry(asset),
    clients = await Promise.all([cluster.connect(), cluster.connect()]);
  try {
    for (const client of clients) await login(f.actor, client);
    const results = await Promise.allSettled(
      clients.map((client) => write("create_entry", input, randomUUID(), client)),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejection = results.find(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult;
    expect(rejection.reason.message).toContain("assetSourceAlreadyRecorded");
    expect((await read(f.project)).entries).toHaveLength(1);
    const request = randomUUID(),
      fresh = entry(asset);
    await write("create_entry", fresh, request);
    await expect(write("create_entry", { ...fresh, amountNative: 200 }, request)).rejects.toThrow(
      "requestIdConflict",
    );
  } finally {
    for (const client of clients) await client.end();
  }
});

it("keeps expense classification and excludes deposits from service recognition", async () => {
  const f = await seed(),
    asset = await verified(f);
  await write(
    "create_entry",
    entry(asset, {
      kind: "expense",
      category: "maintenance",
      amountNative: 123.45,
      currency: "XOF",
      recognitionMethod: "daily",
    }),
  );
  await write(
    "create_entry",
    entry(asset, { kind: "deposit_in", amountNative: 50, periodStart: null, periodEnd: null }),
  );
  const entries = (await read(f.project)).entries;
  expect(entries[0]).toMatchObject({
    kind: "expense",
    category: "maintenance",
    amountNative: 123.45,
    currency: "XOF",
    recognitionMethod: "daily",
  });
  expect(entries[1]).toMatchObject({
    kind: "deposit_in",
    category: "deposit",
    recognitionMethod: "unallocated",
    periodStart: null,
  });
});

it("voids a trial attribution with audit and CAS, retaining the original values and allowing a corrected source", async () => {
  const f = await seed(),
    asset = await verified(f),
    input = entry(asset);
  await write("create_entry", input);
  const original = (await read(f.project)).entries[0],
    request = randomUUID();
  const payload = {
    entryId: original.id,
    expectedUpdatedAt: original.updatedAt,
    reason: "Amount entered incorrectly",
  };
  await expect(write("void_entry", { ...payload, reason: "" })).rejects.toThrow(
    "assetConfirmationRequired",
  );
  await write("void_entry", payload, request);
  expect((await write("void_entry", payload, request)).idempotent).toBe(true);
  const voided = (await read(f.project)).entries[0];
  expect(voided).toMatchObject({ id: original.id, amountNative: 100, voidReason: payload.reason });
  expect(voided.voidedAt).toBeTruthy();
  await expect(
    write("void_entry", { ...payload, expectedUpdatedAt: voided.updatedAt }),
  ).rejects.toThrow("assetEntryAlreadyVoided");
  await expect(
    write("confirm_entry", { ...payload, expectedUpdatedAt: voided.updatedAt }),
  ).rejects.toThrow("assetEntryAlreadyVoided");
  await write("create_entry", { ...input, amountNative: 200 });
  const entries = (await read(f.project)).entries;
  expect(entries).toHaveLength(2);
  expect(entries.filter((record: { voidedAt: string | null }) => !record.voidedAt)).toHaveLength(1);
  expect(entries.find((record: { voidedAt: string | null }) => !record.voidedAt).amountNative).toBe(
    200,
  );
  const audit = (
    await owner(
      "select actor_id,before_data->>'amount_native' amount,metadata->>'request_id' request from audit_logs where metadata->>'request_id'=$1",
      [request],
    )
  ).rows[0];
  expect(audit).toEqual({ actor_id: f.actor, amount: "100.00", request });
  await owner("update user_profiles set role='boss' where id=$1", [f.actor]);
  await login(f.actor);
  await expect(write("void_entry", payload, request)).rejects.toThrow(
    "assetOperationPermissionDenied",
  );
});

it("does not treat offset, reversal, unknown or bare-ledger references as fresh cash", async () => {
  const f = await seed(),
    asset = await verified(f, { unitId: f.unit });
  for (const variant of ["offset", "reversal", "correction", "unknown"]) {
    const payment = randomUUID(),
      ledger = randomUUID();
    await owner(
      "insert into payments(id,unit_id,source_type,payment_date,amount,currency,exchange_rate_to_xof,payment_method,request_kind) values($1,$2,$3,'2026-09-01',100,'USD',600,$4,$5)",
      [
        payment,
        f.unit,
        variant === "unknown" ? "unknown_receipt" : "lease_rent",
        variant === "offset" ? "offset" : "cash",
        variant === "reversal"
          ? "payment_reversal"
          : variant === "correction"
            ? "payment_correction"
            : null,
      ],
    );
    await db.query(
      "insert into ledger_entries(id,building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,currency,amount_native) values($1,$2,$3,$4,'2026-09-01','income','other_income',0,'USD',100)",
      [ledger, f.building, f.unit, payment],
    );
    await login(f.actor);
    await expect(write("create_entry", entry(asset, { paymentId: payment }))).rejects.toThrow(
      "assetPaymentLinkMismatch",
    );
  }
  const bare = randomUUID();
  await owner(
    "insert into ledger_entries(id,building_id,unit_id,entry_date,direction,category,amount_xof,currency,amount_native) values($1,$2,$3,'2026-09-01','income','other_income',0,'USD',100)",
    [bare, f.building, f.unit],
  );
  await login(f.actor);
  await expect(write("create_entry", entry(asset, { ledgerEntryId: bare }))).rejects.toThrow(
    "assetPaymentLinkMismatch",
  );
  expect((await read(f.project)).entries).toHaveLength(0);
});

it("releases a voided canonical attribution for correction without reposting its payment", async () => {
  const f = await seed(),
    asset = await verified(f, { unitId: f.unit }),
    payment = randomUUID(),
    ledger = randomUUID();
  await owner(
    "insert into payments(id,unit_id,source_type,payment_date,amount,currency,exchange_rate_to_xof,payment_method) values($1,$2,'lease_rent','2026-09-01',100,'USD',600,'cash')",
    [payment, f.unit],
  );
  await db.query(
    "insert into ledger_entries(id,building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,currency,amount_native) values($1,$2,$3,$4,'2026-09-01','income','lease_rent',0,'USD',100)",
    [ledger, f.building, f.unit, payment],
  );
  await login(f.actor);
  const input = entry(asset, { paymentId: payment });
  await write("create_entry", input);
  const original = (await read(f.project)).entries[0];
  await write("void_entry", {
    entryId: original.id,
    expectedUpdatedAt: original.updatedAt,
    reason: "Correct coverage only",
  });
  await write("create_entry", { ...input, periodEnd: "2027-04-30" });
  const entries = (await read(f.project)).entries;
  expect(entries.filter((record: { voidedAt: string | null }) => !record.voidedAt)).toHaveLength(1);
  expect(
    (await owner("select count(*)::int n from payments where id=$1", [payment])).rows[0].n,
  ).toBe(1);
});
