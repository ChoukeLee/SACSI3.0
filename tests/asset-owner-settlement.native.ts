import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import {
  parseOwnerSettlementInput,
  readOwnerSettlementContext,
  verifyOwnerSettlementResult,
} from "../src/features/asset-operations/owner-settlement-model";

type Json = Record<string, any>;
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await installApplicationRebuild(db);
}, 60000);
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
async function person(role = "admin") {
  const actor = randomUUID();
  await owner("insert into auth.users(id,email) values($1,$2)", [actor, actor + "@test.invalid"]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,$2,'Synthetic operator')",
    [actor, role],
  );
  return actor;
}
async function seed(role = "admin") {
  const actor = await person("admin"),
    project = randomUUID(),
    asset = randomUUID();
  await owner("insert into projects(id,code,display_name) values($1,$2,'Synthetic project')", [
    project,
    project,
  ]);
  await login(actor);
  await db.query("select asset_operations_write_rpc('import_catalog',$1,$2)", [
    {
      projectId: project,
      sourceFingerprint: "a".repeat(64),
      assets: [
        {
          sourceKey: "synthetic:" + asset,
          code: "SYNTH-" + asset,
          name: "Synthetic factory",
          group: "Synthetic industrial assets",
          sourceRefs: ["synthetic original source"],
          monthlyRentNative: 3500000,
          rentCurrency: "XOF",
        },
      ],
    },
    randomUUID(),
  ]);
  const assetId = (
    await db.query("select id from asset_operation_assets where project_id=$1", [project])
  ).rows[0].id;
  await owner(
    "insert into asset_operation_lease_evidence(asset_id,evidence,reviewed_on,batch_id) values($1,$2,'2026-11-10',$3)",
    [
      assetId,
      {
        assetSourceRef: "synthetic original source",
        referenceRent: {
          amountNative: 3500000,
          currency: "XOF",
          period: "month",
          sourceRef: "synthetic original source",
        },
        leaseListed: true,
        blockReceiptCutoff: true,
        notes: ["Original source note", "Earlier interpretation retained for audit"],
        customSentinel: { unchanged: true },
      },
      randomUUID(),
    ],
  );
  if (role !== "admin") await owner("update user_profiles set role=$1 where id=$2", [role, actor]);
  await login(actor);
  return { actor, project, asset: assetId };
}
type Fixture = Awaited<ReturnType<typeof seed>>;
async function context(f: Fixture, client = db) {
  await login(f.actor, client);
  const value = (
    await client.query("select asset_operations_owner_settlement_context_rpc($1) value", [f.asset])
  ).rows[0].value;
  expect(readOwnerSettlementContext(value, f.asset)).toEqual(value);
  return value;
}
async function input(f: Fixture, extra: Json = {}) {
  const c = await context(f);
  return {
    assetId: f.asset,
    expectedUpdatedAt: c.expectedUpdatedAt,
    expectedEvidenceHash: c.expectedEvidenceHash,
    ownerName: "Synthetic owner",
    shareBps: 5000,
    amountNative: 5000000,
    currency: "XOF",
    cashDate: "2026-11-12",
    paymentMethod: "cash",
    periodStart: "2024-06-01",
    periodEnd: "2024-08-31",
    openingWholeCredit: 500000,
    closingWholeCredit: 0,
    sourceRef: "synthetic owner receipt:" + randomUUID(),
    reason: "Explicit source identity and whole-property credit correction",
    ...extra,
  };
}
async function execute(f: Fixture, p: Json, id = randomUUID(), client = db) {
  await login(f.actor, client);
  const value = (
    await client.query("select asset_operations_record_owner_settlement_rpc($1,$2) value", [p, id])
  ).rows[0].value;
  try {
    const checked = verifyOwnerSettlementResult(
      value,
      parseOwnerSettlementInput(p, new Date().toISOString().slice(0, 10)),
      id,
      f.actor,
    );
    expect(checked.settlement).toEqual(value.data.ownerSettlement);
    expect(checked.idempotent).toBe(value.idempotent);
  } catch (error) {
    // A client proof rejection must not masquerade as an expected SQL error.
    throw new Error("PostgreSQL owner result rejected by independent verifier", { cause: error });
  }
  return value;
}
async function snapshot(f: Fixture) {
  return (
    await owner(
      "select jsonb_build_object('asset',(select to_jsonb(a) from asset_operation_assets a where id=$1),'evidence',(select to_jsonb(e) from asset_operation_lease_evidence e where asset_id=$1),'entries',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from asset_operation_entries e where asset_id=$1),'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by request_id),'[]') from private.asset_operation_requests r where payload->>'assetId'=$1::text),'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from audit_logs a where entity_id=$1 or metadata->'input'->>'assetId'=$1::text),'payments',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from payments p),'ledger',(select coalesce(jsonb_agg(to_jsonb(l) order by id),'[]') from ledger_entries l),'receivables',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from receivables r)) value",
      [f.asset],
    )
  ).rows[0].value;
}

it("context is read-only, scoped and contains an evidence CAS without confirming the asset", async () => {
  const f = await seed(),
    before = await snapshot(f),
    c = await context(f);
  expect(c).toMatchObject({
    assetId: f.asset,
    assetName: "Synthetic factory",
    monthlyRentNative: 3500000,
    currency: "XOF",
    previousSettlement: null,
  });
  expect(c.expectedEvidenceHash).toMatch(/^[a-f0-9]{32}$/);
  expect(await snapshot(f)).toEqual(before);
});

it("preserves existing tenant cutoff, later outstanding balance and unrelated evidence exactly", async () => {
  const f = await seed();
  await owner(
    "update asset_operation_lease_evidence set evidence=evidence||$1::jsonb where asset_id=$2",
    [
      {
        paidThrough: { date: "2025-09-30", sourceRef: "Synthetic tenant-specific source" },
        outstanding: {
          amountNative: 1234,
          currency: "XOF",
          sourceRef: "Synthetic later period balance",
        },
      },
      f.asset,
    ],
  );
  const before = await snapshot(f);
  await execute(f, await input(f));
  const after = await snapshot(f);
  expect(after.evidence.evidence.paidThrough).toEqual(before.evidence.evidence.paidThrough);
  expect(after.evidence.evidence.outstanding).toEqual(before.evidence.evidence.outstanding);
});

it("records exactly actual owner cash, confirms only that asset and leaves tenant accounting untouched", async () => {
  const f = await seed(),
    other = await seed(),
    beforeOther = await snapshot(other),
    p = await input(f),
    before = await snapshot(f),
    id = randomUUID();
  const result = await execute(f, p, id),
    after = await snapshot(f);
  expect(result).toMatchObject({
    success: true,
    idempotent: false,
    data: {
      assetId: f.asset,
      ownerSettlement: {
        requestId: id,
        ownerName: p.ownerName,
        shareBps: 5000,
        receiptAmountNative: 5000000,
        currency: "XOF",
        cashDate: "2026-11-12",
        paymentMethod: "cash",
        periodStart: "2024-06-01",
        periodEnd: "2024-08-31",
        throughDate: "2024-08-31",
        monthlyRentNative: 3500000,
        monthCount: 3,
        wholeEquivalent: 10000000,
        wholeOpeningCredit: 500000,
        wholeRent: 10500000,
        wholeClosingCredit: 0,
        recordedBy: f.actor,
      },
    },
  });
  expect(after.entries).toHaveLength(1);
  expect(after.entries[0]).toMatchObject({
    id: result.data.entryId,
    asset_id: f.asset,
    kind: "income",
    category: "rent",
    amount_native: 5000000,
    currency: "XOF",
    cash_date: "2026-11-12",
    period_start: null,
    period_end: null,
    recognition_method: "unallocated",
    verification: "verified",
    recorded_by: f.actor,
    verified_by: f.actor,
    payment_id: null,
    ledger_entry_id: null,
  });
  expect(after.entries[0].description).toContain("现金(cash)");
  expect(after.entries[0].description).toContain("期初整厂租金信用500000");
  expect(after.asset.verification).toBe("verified");
  expect(after.asset.verified_by).toBe(f.actor);
  expect(after.evidence.evidence.blockReceiptCutoff).toBe(true);
  expect(after.evidence.evidence).not.toHaveProperty("paidThrough");
  expect(after.evidence.evidence).not.toHaveProperty("outstanding");
  expect(after.evidence.evidence.notes.slice(0, 2)).toEqual(before.evidence.evidence.notes);
  expect(after.evidence.evidence.customSentinel).toEqual(before.evidence.evidence.customSentinel);
  const { evidence: a, ...oldMeta } = before.evidence,
    { evidence: b, ...newMeta } = after.evidence;
  expect(newMeta).toEqual(oldMeta);
  expect(a.assetSourceRef).toBe(b.assetSourceRef);
  for (const key of ["payments", "ledger", "receivables"]) expect(after[key]).toEqual(before[key]);
  expect(await snapshot(other)).toEqual(beforeOther);
  const audit = after.audit.find((a: Json) => a.action === "asset_operations_owner_settlement");
  expect(audit.actor_id).toBe(f.actor);
  expect(audit.before_data.asset).toEqual(before.asset);
  expect(audit.before_data.leaseEvidence).toEqual(before.evidence);
  expect((await context(f)).previousSettlement).toEqual(result.data.ownerSettlement);
});

it("supports finance with current project access and rejects ordinary desk/boss/anonymous/service-role calls", async () => {
  const f = await seed("finance");
  expect((await execute(f, await input(f))).success).toBe(true);
  for (const role of ["front_desk", "boss"]) {
    const actor = await person(role);
    await login(actor);
    await expect(
      db.query("select asset_operations_owner_settlement_context_rpc($1)", [f.asset]),
    ).rejects.toThrow(/PermissionDenied/);
    await expect(
      db.query("select asset_operations_record_owner_settlement_rpc($1,$2)", [{}, randomUUID()]),
    ).rejects.toThrow(/PermissionDenied/);
  }
  for (const role of ["anon", "service_role"]) {
    await owner("set role " + role);
    await expect(
      db.query("select asset_operations_owner_settlement_context_rpc($1)", [f.asset]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query("select asset_operations_record_owner_settlement_rpc($1,$2)", [{}, randomUUID()]),
    ).rejects.toThrow(/permission denied/);
  }
});

it("rejects a restricted foreign project even when the caller has finance role", async () => {
  const f = await seed(),
    actor = await person("finance");
  await owner("update projects set access_mode='restricted' where id=$1", [f.project]);
  await login(actor);
  await expect(
    db.query("select asset_operations_owner_settlement_context_rpc($1)", [f.asset]),
  ).rejects.toThrow(/AccessDenied/);
});

it.each(["table", "sql", "patch", "actorId", "paidThrough"])(
  "rejects unknown %s input instead of generic patches or actor overrides",
  async (key) => {
    const f = await seed(),
      p = await input(f, { [key]: "arbitrary" }),
      before = await snapshot(f);
    await expect(execute(f, p)).rejects.toThrow(/invalidOwnerSettlement/);
    expect(await snapshot(f)).toEqual(before);
  },
);

it("rejects incorrect equation, fractional whole equivalents and non-month coverage", async () => {
  const f = await seed();
  for (const edit of [
    { openingWholeCredit: 0 },
    { shareBps: 3333 },
    { periodStart: "2024-06-02" },
    { periodEnd: "2024-08-30" },
    { shareBps: 10001 },
    { amountNative: 0 },
    { amountNative: 1.5 },
    { currency: "USD" },
    { cashDate: "2099-01-01" },
  ]) {
    const p = await input(f, edit);
    await expect(execute(f, p)).rejects.toThrow(
      /invalidOwnerSettlement|ownerSettlementEquationMismatch/,
    );
  }
  expect((await snapshot(f)).entries).toEqual([]);
});

it("rejects missing evidence and absent/non-XOF rental reference", async () => {
  const f = await seed();
  await owner("delete from asset_operation_lease_evidence where asset_id=$1", [f.asset]);
  await expect(context(f)).rejects.toThrow(/EvidenceRequired/);
  const g = await seed(),
    p = await input(g);
  await owner(
    "update asset_operation_assets set monthly_rent_native=null,rent_currency=null where id=$1",
    [g.asset],
  );
  await expect(execute(g, p)).rejects.toThrow(/RentRequired/);
});

it("idempotently returns original result before stale-CAS checks and rejects changed payload reuse", async () => {
  const f = await seed(),
    p = await input(f),
    id = randomUUID(),
    first = await execute(f, p, id),
    after = await snapshot(f);
  expect(await execute(f, p, id)).toEqual({ ...first, idempotent: true });
  expect(await snapshot(f)).toEqual(after);
  await expect(execute(f, { ...p, reason: p.reason + " changed" }, id)).rejects.toThrow(
    /requestIdConflict/,
  );
  const secondActor = await person("admin");
  await expect(execute({ ...f, actor: secondActor }, p, id)).rejects.toThrow(/requestIdConflict/);
});

it("rejects reuse of a historical opening credit and overlapping settlement period", async () => {
  const f = await seed();
  await execute(f, await input(f));
  const fresh = await input(f, { periodStart: "2024-09-01", periodEnd: "2024-11-30" });
  await expect(execute(f, fresh)).rejects.toThrow(/CreditConflict/);
  const overlap = await input(f, { openingWholeCredit: 0, amountNative: 5250000 });
  await expect(execute(f, overlap)).rejects.toThrow(/PeriodConflict/);
  const changedOwner = await input(f, {
    openingWholeCredit: 0,
    amountNative: 5250000,
    periodStart: "2024-09-01",
    periodEnd: "2024-11-30",
    ownerName: "Different owner",
  });
  await expect(execute(f, changedOwner)).rejects.toThrow(/HistoryConflict/);
});

it("carries explicit closing credit into the next nonoverlapping period exactly once", async () => {
  const f = await seed();
  const first = await execute(
    f,
    await input(f, { amountNative: 5500000, closingWholeCredit: 1000000 }),
  );
  expect(first.data.ownerSettlement.wholeClosingCredit).toBe(1000000);
  const second = await execute(
    f,
    await input(f, {
      periodStart: "2024-09-01",
      periodEnd: "2024-11-30",
      amountNative: 4750000,
      openingWholeCredit: 1000000,
    }),
  );
  expect(second.data.ownerSettlement).toMatchObject({
    wholeOpeningCredit: 1000000,
    wholeClosingCredit: 0,
    wholeEquivalent: 9500000,
    wholeRent: 10500000,
  });
  expect((await snapshot(f)).entries).toHaveLength(2);
});

it("blocks ordinary void of current and rolled-forward owner receipts without altering journals or evidence", async () => {
  const f = await seed(),
    first = await execute(
      f,
      await input(f, { amountNative: 5500000, closingWholeCredit: 1000000 }),
    );
  const second = await execute(
    f,
    await input(f, {
      periodStart: "2024-09-01",
      periodEnd: "2024-11-30",
      amountNative: 4750000,
      openingWholeCredit: 1000000,
    }),
  );
  const before = await snapshot(f);
  for (const id of [first.data.entryId, second.data.entryId]) {
    const entry = before.entries.find((e: Json) => e.id === id);
    await login(f.actor);
    await expect(
      db.query("select asset_operations_write_rpc('void_entry',$1,$2)", [
        {
          entryId: id,
          expectedUpdatedAt: entry.updated_at,
          reason: "Synthetic attempted ordinary void",
        },
        randomUUID(),
      ]),
    ).rejects.toThrow(/ownerSettlementReceiptLinked/);
    expect(await snapshot(f)).toEqual(before);
  }
  await expect(
    owner("delete from asset_operation_entries where id=$1", [first.data.entryId]),
  ).rejects.toThrow(/ownerSettlementReceiptLinked/);
  expect(await snapshot(f)).toEqual(before);
});

it("detects asset and evidence concurrent drift independently", async () => {
  const f = await seed(),
    p = await input(f);
  await owner(
    "update asset_operation_lease_evidence set evidence=evidence||'{\"sourceConcurrent\":true}'::jsonb where asset_id=$1",
    [f.asset],
  );
  await expect(execute(f, p)).rejects.toThrow(/RecordChanged/);
  const q = await input(f);
  await owner("update asset_operation_assets set updated_at=clock_timestamp() where id=$1", [
    f.asset,
  ]);
  await expect(execute(f, q)).rejects.toThrow(/RecordChanged/);
});

it("deduplicates source references without another cash receipt", async () => {
  const f = await seed(),
    p = await input(f);
  await execute(f, p);
  const next = await input(f, {
    sourceRef: p.sourceRef,
    periodStart: "2024-09-01",
    periodEnd: "2024-11-30",
    openingWholeCredit: 0,
    amountNative: 5250000,
  });
  await expect(execute(f, next)).rejects.toThrow(/assetSourceAlreadyRecorded/);
  expect((await snapshot(f)).entries).toHaveLength(1);
});

it("rolls confirmation, cash entry, evidence, child requests and audit back on a late failure", async () => {
  const f = await seed(),
    p = await input(f),
    before = await snapshot(f);
  await owner(
    "create function private.synthetic_owner_fail() returns trigger language plpgsql as $$ begin raise exception 'SyntheticOwnerLateFailure'; end $$; create trigger synthetic_owner_fail before update on asset_operation_lease_evidence for each row execute function private.synthetic_owner_fail()",
  );
  try {
    await expect(execute(f, p)).rejects.toThrow(/SyntheticOwnerLateFailure/);
  } finally {
    await owner(
      "drop trigger synthetic_owner_fail on asset_operation_lease_evidence; drop function private.synthetic_owner_fail()",
    );
  }
  expect(await snapshot(f)).toEqual(before);
});

it("serializes same-request concurrency and creates only one receipt", async () => {
  const f = await seed(),
    p = await input(f),
    id = randomUUID(),
    other = await cluster.connect();
  await login(f.actor);
  await db.query("begin");
  try {
    await execute(f, p, id);
    const waiting = execute(f, p, id, other);
    await db.query("commit");
    expect((await waiting).idempotent).toBe(true);
  } finally {
    await db.query("rollback");
    await other.end();
  }
  expect((await snapshot(f)).entries).toHaveLength(1);
});

it("cleanly denies direct table writes and does not expand legacy entry kinds", async () => {
  const f = await seed();
  await login(f.actor);
  await expect(
    db.query("update asset_operation_lease_evidence set evidence='{}' where asset_id=$1", [
      f.asset,
    ]),
  ).rejects.toThrow(/permission denied/);
  await expect(
    db.query("update asset_operation_assets set verification='verified' where id=$1", [f.asset]),
  ).rejects.toThrow(/permission denied/);
  const kinds = (
    await owner(
      "select pg_get_constraintdef(oid) definition from pg_constraint where conrelid='asset_operation_entries'::regclass and conname='asset_operation_entries_kind_check'",
    )
  ).rows[0].definition;
  expect(kinds).not.toContain("owner");
});
