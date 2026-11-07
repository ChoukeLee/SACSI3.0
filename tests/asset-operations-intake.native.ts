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
async function login(actor: string) {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: "authenticated" }),
  ]);
  await db.query("set role authenticated");
}
async function rpc(name: string, input: unknown, requestId = randomUUID()) {
  return (await db.query(`select public.${name}($1,$2) value`, [input, requestId])).rows[0].value;
}
async function read(project: string) {
  return (await db.query("select public.asset_operations_read_rpc($1) value", [project])).rows[0]
    .value;
}
async function seed() {
  const actor = randomUUID(),
    project = randomUUID();
  await owner("insert into auth.users(id,email) values($1,$2)", [actor, `${actor}@test.invalid`]);
  await db.query("insert into user_profiles(id,role,display_name) values($1,'admin','Synthetic')", [
    actor,
  ]);
  await db.query("insert into projects(id,code,display_name) values($1,$2,'Synthetic')", [
    project,
    project,
  ]);
  await login(actor);
  await db.query("select public.asset_operations_write_rpc('import_catalog',$1,$2)", [
    {
      projectId: project,
      sourceFingerprint: "a".repeat(64),
      assets: [
        {
          sourceKey: "old_warehouse:1",
          code: "OW-1",
          name: "Old 1",
          group: "old_warehouse",
          sourceRefs: ["sha256:original|sheet:old|cell:A2"],
          monthlyRentNative: null,
          rentCurrency: null,
        },
        {
          sourceKey: "new_warehouse:1",
          code: "NW-1",
          name: "New 1",
          group: "new_warehouse",
          sourceRefs: ["sha256:original|sheet:new|cell:A2"],
          monthlyRentNative: null,
          rentCurrency: null,
        },
      ],
    },
    randomUUID(),
  ]);
  return { actor, project, assets: (await read(project)).assets };
}
function term(asset: { id: string; updatedAt: string }, extra = {}) {
  return {
    assetId: asset.id,
    expectedUpdatedAt: asset.updatedAt,
    monthlyRentNative: 375000,
    rentCurrency: "XOF",
    reason: "Confirmed warehouse units: amounts in ten thousand XOF",
    ...extra,
  };
}
function fact(extra = {}) {
  return {
    assetSourceKey: "old_warehouse:1",
    kind: "income",
    category: "rent",
    amountNative: 6750000,
    currency: "XOF",
    cashDate: "2026-01-10",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    sourceRef: `synthetic:${randomUUID()}`,
    description: "Original source receipt remains pending",
    ...extra,
  };
}
function batch(projectId: string, entries: unknown[] = [fact()], terms: unknown[] = []) {
  return { projectId, sourceFingerprint: "b".repeat(64), entries, terms };
}

it("updates reference rent with CAS, reason and audit while preserving original source evidence", async () => {
  const f = await seed(),
    asset = f.assets[0],
    input = term(asset),
    request = randomUUID();
  await expect(rpc("asset_operations_update_terms_rpc", { ...input, reason: "" })).rejects.toThrow(
    "invalidAssetTerms",
  );
  await rpc("asset_operations_update_terms_rpc", input, request);
  expect((await rpc("asset_operations_update_terms_rpc", input, request)).idempotent).toBe(true);
  await expect(rpc("asset_operations_update_terms_rpc", input)).rejects.toThrow(
    "assetOperationRecordChanged",
  );
  const updated = (await read(f.project)).assets.find((row: { id: string }) => row.id === asset.id);
  expect(updated).toMatchObject({
    monthlyRentNative: 375000,
    rentCurrency: "XOF",
    verification: "pending",
    sourceRefs: asset.sourceRefs,
  });
  const evidence = (
    await owner("select source_fingerprint from asset_operation_assets where id=$1", [asset.id])
  ).rows[0];
  expect(evidence.source_fingerprint).toBe("a".repeat(64));
  const audit = (
    await db.query(
      "select actor_id,before_data->'monthly_rent_native' old_rent,after_data->>'monthly_rent_native' new_rent from audit_logs where metadata->>'request_id'=$1",
      [request],
    )
  ).rows[0];
  expect(audit).toEqual({ actor_id: f.actor, old_rent: null, new_rent: "375000.00" });
});

it("atomically imports source facts and reference terms, forcing pending and unallocated status", async () => {
  const f = await seed(),
    asset = f.assets.find((a: { code: string }) => a.code === "OW-1");
  const input = batch(
    f.project,
    [
      fact({ verification: "verified", recognitionMethod: "daily" }),
      fact({ assetSourceKey: "new_warehouse:1", amountNative: 30000, currency: "CNY" }),
    ],
    [term(asset)],
  );
  const request = randomUUID(),
    result = await rpc("asset_operations_import_entries_rpc", input, request);
  expect(result.data).toMatchObject({ importedCount: 2, matchedCount: 0, updatedTermsCount: 1 });
  expect(result.data.entryIds).toHaveLength(2);
  expect(new Set(result.data.requestIds).size).toBe(3);
  const data = await read(f.project);
  expect(data.entries).toHaveLength(2);
  for (const entry of data.entries)
    expect(entry).toMatchObject({ verification: "pending", recognitionMethod: "unallocated" });
  expect((await rpc("asset_operations_import_entries_rpc", input, request)).idempotent).toBe(true);
  expect((await read(f.project)).entries).toHaveLength(2);
  await expect(
    rpc(
      "asset_operations_import_entries_rpc",
      { ...input, sourceFingerprint: "c".repeat(64) },
      request,
    ),
  ).rejects.toThrow("requestIdConflict");
  const counts = (
    await owner(
      "select (select count(*)::int from payments) payments,(select count(*)::int from ledger_entries) ledger",
    )
  ).rows[0];
  expect(counts).toEqual({ payments: 0, ledger: 0 });
});

it("rolls back terms, children, audit and batch replay state when any imported fact fails", async () => {
  const f = await seed(),
    asset = f.assets[0],
    request = randomUUID();
  const input = batch(f.project, [fact(), fact({ amountNative: -1 })], [term(asset)]);
  await expect(rpc("asset_operations_import_entries_rpc", input, request)).rejects.toThrow(
    "invalidAssetEntry",
  );
  const data = await read(f.project);
  expect(data.entries).toHaveLength(0);
  expect(data.assets.find((a: { id: string }) => a.id === asset.id)).toMatchObject({
    monthlyRentNative: null,
    updatedAt: asset.updatedAt,
  });
  const requests = (
    await owner(
      "select count(*)::int n from private.asset_operation_requests where actor_id=$1 and operation<>'import_catalog'",
      [f.actor],
    )
  ).rows[0].n;
  expect(requests).toBe(0);
  await login(f.actor);
  const corrected = batch(f.project, [input.entries[0]], input.terms);
  expect(
    (await rpc("asset_operations_import_entries_rpc", corrected, request)).data.importedCount,
  ).toBe(1);
});

it("supports terms-only batches and rejects empty, oversized, duplicate-child or cross-project inputs", async () => {
  const f = await seed(),
    asset = f.assets[0],
    other = await seed();
  await login(f.actor);
  await expect(rpc("asset_operations_import_entries_rpc", batch(f.project, []))).rejects.toThrow(
    "invalidAssetEntryBatch",
  );
  await expect(
    rpc(
      "asset_operations_import_entries_rpc",
      batch(
        f.project,
        Array.from({ length: 101 }, () => fact()),
      ),
    ),
  ).rejects.toThrow("invalidAssetEntryBatch");
  const child = randomUUID();
  await expect(
    rpc(
      "asset_operations_import_entries_rpc",
      batch(f.project, [fact({ requestId: child }), fact({ requestId: child })]),
    ),
  ).rejects.toThrow("invalidAssetEntryBatch");
  await expect(
    rpc(
      "asset_operations_import_entries_rpc",
      batch(f.project, [fact({ paymentId: randomUUID() })]),
    ),
  ).rejects.toThrow("invalidAssetEntryBatch");
  await expect(
    rpc(
      "asset_operations_import_entries_rpc",
      batch(f.project, [fact({ assetId: other.assets[0].id })]),
    ),
  ).rejects.toThrow("assetOperationNotFound");
  const result = await rpc(
    "asset_operations_import_entries_rpc",
    batch(f.project, [], [term(asset)]),
  );
  expect(result.data).toMatchObject({ importedCount: 0, updatedTermsCount: 1, entryIds: [] });
});

it("rechecks administrator and project access before replay, without granting direct or anonymous writes", async () => {
  const f = await seed(),
    input = batch(f.project),
    request = randomUUID();
  await rpc("asset_operations_import_entries_rpc", input, request);
  await owner("update user_profiles set role='finance' where id=$1", [f.actor]);
  await login(f.actor);
  await expect(rpc("asset_operations_import_entries_rpc", input, request)).rejects.toThrow(
    "assetOperationPermissionDenied",
  );
  await owner("update user_profiles set role='admin' where id=$1", [f.actor]);
  await db.query("update projects set access_mode='restricted' where id=$1", [f.project]);
  await login(f.actor);
  await expect(rpc("asset_operations_import_entries_rpc", input, request)).rejects.toThrow(
    "assetOperationAccessDenied",
  );
  await owner("select 1");
  const grants = (
    await db.query(
      "select has_function_privilege('anon','public.asset_operations_import_entries_rpc(jsonb,uuid)','execute') anonymous,has_function_privilege('service_role','public.asset_operations_import_entries_rpc(jsonb,uuid)','execute') service,has_table_privilege('authenticated','public.asset_operation_entries','insert') direct",
    )
  ).rows[0];
  expect(grants).toEqual({ anonymous: false, service: false, direct: false });
});

it("replays an unchanged stable child after term revisions and rejects changed facts atomically", async () => {
  const f = await seed(),
    child = randomUUID();
  const asset = f.assets.find((row: { code: string }) => row.code === "OW-1");
  const original = fact({ requestId: child });
  await rpc("asset_operations_import_entries_rpc", batch(f.project, [original]));
  await rpc("asset_operations_update_terms_rpc", term(asset));
  const replay = await rpc("asset_operations_import_entries_rpc", batch(f.project, [original]));
  expect(replay.data).toMatchObject({ importedCount: 0, matchedCount: 1 });
  expect((await read(f.project)).entries).toHaveLength(1);
  const revised = (await read(f.project)).assets.find((row: { id: string }) => row.id === asset.id);
  const combined = await rpc(
    "asset_operations_import_entries_rpc",
    batch(f.project, [original], [term(revised, { monthlyRentNative: 400000 })]),
  );
  expect(combined.data).toMatchObject({ importedCount: 0, matchedCount: 1, updatedTermsCount: 1 });
  expect((await read(f.project)).entries).toHaveLength(1);
  const beforeRejected = (await read(f.project)).assets.find(
    (row: { id: string }) => row.id === asset.id,
  );
  await expect(
    rpc(
      "asset_operations_import_entries_rpc",
      batch(
        f.project,
        [{ ...original, amountNative: 1 }],
        [term(beforeRejected, { monthlyRentNative: 500000 })],
      ),
    ),
  ).rejects.toThrow("requestIdConflict");
  expect(
    (await read(f.project)).assets.find((row: { id: string }) => row.id === asset.id),
  ).toMatchObject({ monthlyRentNative: 400000, updatedAt: beforeRejected.updatedAt });
});
