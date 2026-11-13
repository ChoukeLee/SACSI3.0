import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { readOwnerSettlement } from "../src/features/asset-operations/owner-settlement-model";
import {
  parseOwnerRentBackfillInput,
  readOwnerRentAccountRpc,
  summarizeOwnerRentAccount,
  verifyOwnerRentBackfillResult,
} from "../src/features/asset-operations/owner-rent-account-model";

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
  const id = randomUUID();
  await owner("insert into auth.users(id,email) values($1,$2)", [id, id + "@test.invalid"]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,$2,'Synthetic operator')",
    [id, role],
  );
  return id;
}
async function settlement(f: { actor: string; asset: string }, extra: Json = {}) {
  await login(f.actor);
  const c = (
    await db.query("select asset_operations_owner_settlement_context_rpc($1) value", [f.asset])
  ).rows[0].value;
  return (
    await db.query("select asset_operations_record_owner_settlement_rpc($1,$2) value", [
      {
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
        sourceRef: "synthetic current:" + randomUUID(),
        reason: "Confirmed synthetic owner receipt and opening credit",
        ...extra,
      },
      randomUUID(),
    ])
  ).rows[0].value;
}
async function seed() {
  const actor = await person(),
    project = randomUUID();
  await owner("insert into projects(id,code,display_name) values($1,$2,'Synthetic')", [
    project,
    project,
  ]);
  await login(actor);
  const result = (
    await db.query("select asset_operations_write_rpc('import_catalog',$1,$2) value", [
      {
        projectId: project,
        sourceFingerprint: "a".repeat(64),
        assets: [
          {
            sourceKey: "synthetic:" + randomUUID(),
            code: "Synthetic",
            name: "Synthetic factory",
            group: "Synthetic",
            sourceRefs: ["Synthetic original source"],
            monthlyRentNative: 3500000,
            rentCurrency: "XOF",
          },
        ],
      },
      randomUUID(),
    ])
  ).rows[0].value;
  const asset = result.data.assetIds[0];
  await owner(
    "insert into asset_operation_lease_evidence(asset_id,evidence,reviewed_on,batch_id) values($1,$2,'2026-11-10',$3)",
    [
      asset,
      {
        assetSourceRef: "Synthetic original source",
        blockReceiptCutoff: true,
        leaseListed: true,
        notes: ["Original interpretation remains immutable"],
        customSentinel: "Keep this value",
      },
      randomUUID(),
    ],
  );
  const f = { actor, project, asset };
  const current = await settlement(f);
  return { ...f, current };
}
type Fixture = Awaited<ReturnType<typeof seed>>;
function historical() {
  return [
    {
      cashDate: "2025-04-05",
      amountNative: 5000000,
      currency: "XOF",
      paymentMethod: null,
      sourceRef: "synthetic history 1:" + randomUUID(),
      sourceText: "\nOriginal source row one, including its old credit statement\n",
    },
    {
      cashDate: "2026-06-16",
      amountNative: 5000000,
      currency: "XOF",
      paymentMethod: null,
      sourceRef: "synthetic history 2:" + randomUUID(),
      sourceText: "Original source row two",
    },
    {
      cashDate: "2026-07-14",
      amountNative: 5000000,
      currency: "XOF",
      paymentMethod: null,
      sourceRef: "synthetic history 3:" + randomUUID(),
      sourceText: "Original source row three",
    },
    {
      cashDate: "2026-10-15",
      amountNative: 2500000,
      currency: "XOF",
      paymentMethod: null,
      sourceRef: "synthetic history 4:" + randomUUID(),
      sourceText: "Original source merged row four",
    },
  ];
}
async function input(f: Fixture, extra: Json = {}) {
  await login(f.actor);
  const c = (
    await db.query("select asset_operations_owner_settlement_context_rpc($1) value", [f.asset])
  ).rows[0].value;
  return {
    assetId: f.asset,
    expectedUpdatedAt: c.expectedUpdatedAt,
    expectedEvidenceHash: c.expectedEvidenceHash,
    expectedSettlementRequestId: c.previousSettlement.requestId,
    rateSourceRef: "Synthetic confirmed unchanged monthly rate",
    reason:
      "Retain original source text and append the independently inferred historical credit correction; no cash changes",
    history: historical(),
    ...extra,
  };
}
async function write(f: Fixture, p: Json, id = randomUUID(), client = db) {
  await login(f.actor, client);
  const value = (
    await client.query("select asset_operations_backfill_owner_rent_history_rpc($1,$2) value", [
      p,
      id,
    ])
  ).rows[0].value;
  try {
    expect(
      verifyOwnerRentBackfillResult(
        value,
        parseOwnerRentBackfillInput(p, new Date().toISOString().slice(0, 10)),
        id,
        f.actor,
      ),
    ).toEqual({ account: value.data.ownerRentAccount, idempotent: value.idempotent });
  } catch (error) {
    throw new Error("PostgreSQL history result rejected by independent verifier", { cause: error });
  }
  return value;
}
async function read(f: Fixture, actor = f.actor) {
  await login(actor);
  const value = (
    await db.query("select asset_operations_owner_rent_account_rpc($1) value", [f.asset])
  ).rows[0].value;
  if (value.account)
    expect(readOwnerRentAccountRpc(value, value.account, f.asset).settlementEntryIds).toEqual(
      value.settlementEntryIds,
    );
  return value;
}
async function snapshot(f: Fixture) {
  return (
    await owner(
      "select jsonb_build_object('asset',(select to_jsonb(a) from asset_operation_assets a where id=$1),'evidence',(select to_jsonb(e) from asset_operation_lease_evidence e where asset_id=$1),'entries',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from asset_operation_entries e where asset_id=$1),'journals',(select coalesce(jsonb_agg(to_jsonb(j) order by request_id),'[]') from private.asset_operation_requests j where payload->>'assetId'=$1::text),'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from audit_logs a where entity_id=$1 or metadata->'input'->>'assetId'=$1::text),'payments',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from payments p),'ledger',(select coalesce(jsonb_agg(to_jsonb(l) order by id),'[]') from ledger_entries l),'receivables',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from receivables r)) value",
      [f.asset],
    )
  ).rows[0].value;
}

it("returns no configured account without changing the existing strict owner context", async () => {
  const f = await seed(),
    before = await snapshot(f);
  expect(await read(f)).toEqual({ assetId: f.asset, account: null, settlementEntryIds: [] });
  expect(await snapshot(f)).toEqual(before);
});

it("records four historical actual receipts once and preserves latest cash, credit anchor and tenant data", async () => {
  const f = await seed(),
    other = await seed(),
    beforeOther = await snapshot(other),
    before = await snapshot(f),
    p = await input(f),
    result = await write(f, p),
    after = await snapshot(f);
  expect(result).toMatchObject({
    success: true,
    idempotent: false,
    data: {
      assetId: f.asset,
      ownerRentAccount: {
        version: 1,
        ownerName: "Synthetic owner",
        shareBps: 5000,
        currency: "XOF",
        wholeMonthlyRentNative: 3500000,
        chargingRule: "full_calendar_month",
        recordedBy: f.actor,
      },
    },
  });
  expect(result.data.entryIds).toHaveLength(4);
  expect(after.entries).toHaveLength(5);
  expect(after.entries.reduce((s: number, e: Json) => s + e.amount_native, 0)).toBe(22500000);
  expect(after.entries.find((e: Json) => e.id === f.current.data.entryId)).toEqual(
    before.entries[0],
  );
  expect(after.evidence.evidence.ownerSettlement).toEqual(before.evidence.evidence.ownerSettlement);
  expect(after.evidence.evidence.blockReceiptCutoff).toBe(true);
  expect(after.evidence.evidence).not.toHaveProperty("paidThrough");
  expect(after.evidence.evidence).not.toHaveProperty("outstanding");
  expect(after.evidence.evidence.notes.slice(0, before.evidence.evidence.notes.length)).toEqual(
    before.evidence.evidence.notes,
  );
  for (const h of result.data.ownerRentAccount.history) {
    expect(h.paymentMethod).toBeNull();
    const e = after.entries.find((e: Json) => e.id === h.entryId);
    expect(e).toMatchObject({
      amount_native: h.amountNative,
      currency: "XOF",
      cash_date: h.cashDate,
      kind: "income",
      category: "rent",
      period_start: null,
      period_end: null,
      recognition_method: "unallocated",
      verification: "verified",
      payment_id: null,
      ledger_entry_id: null,
    });
    expect(e.description).toContain("原表未记载");
  }
  expect(result.data.ownerRentAccount.history[0].sourceText).toBe(p.history[0].sourceText);
  for (const key of ["payments", "ledger", "receivables"]) expect(after[key]).toEqual(before[key]);
  expect(await snapshot(other)).toEqual(beforeOther);
  expect(await read(f)).toEqual({
    assetId: f.asset,
    account: result.data.ownerRentAccount,
    settlementEntryIds: [f.current.data.entryId],
  });
  const proof = after.entries.map((e: Json) => ({
    id: e.id,
    assetId: e.asset_id,
    kind: e.kind,
    category: e.category,
    amountNative: e.amount_native,
    currency: e.currency,
    cashDate: e.cash_date,
    periodStart: e.period_start,
    periodEnd: e.period_end,
    recognitionMethod: e.recognition_method,
    verification: e.verification,
    status: e.voided_at ? "voided" : e.verification,
    sourceRef: e.source_ref,
    voidedAt: e.voided_at,
  }));
  const summary = summarizeOwnerRentAccount(
    result.data.ownerRentAccount,
    readOwnerSettlement(after.evidence.evidence.ownerSettlement),
    proof,
    f.asset,
    "2026-11-13",
  );
  expect(summary).toMatchObject({
    cumulativeActualNative: 22500000,
    monthlyOwnerRentNative: 1750000,
    dueMonthCount: 27,
    arrearsNative: 47250000,
    appliedCreditNative: 0,
    firstUnpaidDate: "2024-09-01",
    asOf: "2026-11-13",
  });
});

it("lets boss read a validated account but prohibits boss writes and denies anonymous/service roles", async () => {
  const f = await seed(),
    p = await input(f);
  await write(f, p);
  const boss = await person("boss");
  expect((await read(f, boss)).account.ownerName).toBe("Synthetic owner");
  await expect(write({ ...f, actor: boss }, p)).rejects.toThrow(/PermissionDenied/);
  for (const role of ["anon", "service_role"]) {
    await owner("set role " + role);
    await expect(
      db.query("select asset_operations_owner_rent_account_rpc($1)", [f.asset]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query("select asset_operations_backfill_owner_rent_history_rpc($1,$2)", [p, randomUUID()]),
    ).rejects.toThrow(/permission denied/);
  }
  const denied = await person("finance");
  await owner("update projects set access_mode='restricted' where id=$1", [f.project]);
  await expect(read(f, denied)).rejects.toThrow(/AccessDenied/);
});

it("idempotently recovers original batch before stale CAS and rejects overwrites/changed payload", async () => {
  const f = await seed(),
    p = await input(f),
    id = randomUUID(),
    first = await write(f, p, id),
    before = await snapshot(f);
  expect(await write(f, p, id)).toEqual({ ...first, idempotent: true });
  expect(await snapshot(f)).toEqual(before);
  await expect(write(f, { ...p, reason: p.reason + " changed" }, id)).rejects.toThrow(
    /requestIdConflict/,
  );
  await expect(write(f, await input(f))).rejects.toThrow(/AlreadyRecorded/);
});

it.each(["sql", "table", "ownerName", "shareBps", "openingWholeCredit"])(
  "rejects arbitrary or inferred %s overrides",
  async (key) => {
    const f = await seed(),
      p = await input(f, { [key]: "untrusted" }),
      before = await snapshot(f);
    await expect(write(f, p)).rejects.toThrow(/invalidOwnerSettlement/);
    expect(await snapshot(f)).toEqual(before);
  },
);

it("rejects unsorted/future dates, missing methods, duplicate sources, source collisions and current receipt copies", async () => {
  const f = await seed();
  for (const change of [
    (p: Json) => p.history.reverse(),
    (p: Json) => (p.history[3].cashDate = "2026-11-13"),
    (p: Json) => delete p.history[0].paymentMethod,
    (p: Json) => (p.history[1].sourceRef = p.history[0].sourceRef),
    (p: Json) => {
      p.history = [{ ...p.history[0], cashDate: "2026-11-12", amountNative: 5000000 }];
    },
    (p: Json) => (p.history[0].amountNative = 0),
    (p: Json) => (p.history[0].currency = "USD"),
  ]) {
    const p = await input(f);
    change(p);
    await expect(write(f, p)).rejects.toThrow(
      /OrderConflict|Recorded|Collision|invalidOwnerSettlement/,
    );
  }
  expect((await snapshot(f)).entries).toHaveLength(1);
});

it("rejects changed evidence/asset tokens and wrong settlement anchor", async () => {
  const f = await seed(),
    wrong = await input(f, { expectedSettlementRequestId: randomUUID() });
  await expect(write(f, wrong)).rejects.toThrow(/AnchorConflict/);
  const p = await input(f);
  await owner(
    "update asset_operation_lease_evidence set evidence=evidence||'{\"newSource\":true}'::jsonb where asset_id=$1",
    [f.asset],
  );
  await expect(write(f, p)).rejects.toThrow(/RecordChanged/);
  const q = await input(f);
  await owner("update asset_operation_assets set updated_at=clock_timestamp() where id=$1", [
    f.asset,
  ]);
  await expect(write(f, q)).rejects.toThrow(/RecordChanged/);
});

it("discovers all future settlement receipts across more than two roll-forwards without editing stored account", async () => {
  const f = await seed(),
    result = await write(f, await input(f)),
    original = result.data.ownerRentAccount;
  const second = await settlement(f, {
    periodStart: "2024-09-01",
    periodEnd: "2024-11-30",
    openingWholeCredit: 0,
    amountNative: 5250000,
  });
  const third = await settlement(f, {
    periodStart: "2024-12-01",
    periodEnd: "2025-02-28",
    openingWholeCredit: 0,
    amountNative: 5250000,
  });
  const account = await read(f);
  expect(account.account).toEqual(original);
  expect(account.settlementEntryIds).toEqual([
    f.current.data.entryId,
    second.data.entryId,
    third.data.entryId,
  ]);
});

it("rejects skipped settlement months after account setup and rolls the new receipt back", async () => {
  const f = await seed();
  await write(f, await input(f));
  const before = await snapshot(f);
  await expect(
    settlement(f, {
      periodStart: "2024-12-01",
      periodEnd: "2025-02-28",
      openingWholeCredit: 0,
      amountNative: 5250000,
    }),
  ).rejects.toThrow(/ownerSettlementPeriodConflict/);
  expect(await snapshot(f)).toEqual(before);
});

it("preserves legacy settlement timing for an asset without an owner rent account", async () => {
  const f = await seed();
  const next = await settlement(f, {
    periodStart: "2024-12-01",
    periodEnd: "2025-02-28",
    openingWholeCredit: 0,
    amountNative: 5250000,
  });
  expect(next.success).toBe(true);
  expect(next.data.ownerSettlement.periodStart).toBe("2024-12-01");
  expect(await read(f)).toEqual({ assetId: f.asset, account: null, settlementEntryIds: [] });
});

it("protects historical entries from ordinary void/delete including after roll-forward", async () => {
  const f = await seed(),
    r = await write(f, await input(f));
  await settlement(f, {
    periodStart: "2024-09-01",
    periodEnd: "2024-11-30",
    openingWholeCredit: 0,
    amountNative: 5250000,
  });
  const before = await snapshot(f),
    entry = before.entries.find((e: Json) => e.id === r.data.entryIds[0]);
  await login(f.actor);
  await expect(
    db.query("select asset_operations_write_rpc('void_entry',$1,$2)", [
      { entryId: entry.id, expectedUpdatedAt: entry.updated_at, reason: "Synthetic ordinary void" },
      randomUUID(),
    ]),
  ).rejects.toThrow(/ReceiptLinked/);
  await expect(
    owner("delete from asset_operation_entries where id=$1", [entry.id]),
  ).rejects.toThrow(/ReceiptLinked/);
  expect(await snapshot(f)).toEqual(before);
});

it("fails closed when a stored account cash link or source is corrupted", async () => {
  const f = await seed();
  await write(f, await input(f));
  await owner(
    "update asset_operation_lease_evidence set evidence=jsonb_set(evidence,'{ownerRentAccount,history,0,amountNative}','1') where asset_id=$1",
    [f.asset],
  );
  await expect(read(f)).rejects.toThrow(/HistoryConflict/);
});

it("fails closed on missing parent payload/result metadata instead of accepting SQL NULL comparisons", async () => {
  for (const section of ["payload", "result"]) {
    const f = await seed(),
      result = await write(f, await input(f));
    await owner(
      `update private.asset_operation_requests set ${section}=${section}-'assetId' where request_id=$1`,
      [result.data.ownerRentAccount.requestId],
    );
    if (section === "result")
      await owner(
        "update private.asset_operation_requests set result=jsonb_set(result,'{data}',(result->'data')-'assetId') where request_id=$1",
        [result.data.ownerRentAccount.requestId],
      );
    await expect(read(f)).rejects.toThrow(/HistoryConflict/);
  }
});

it("rolls all history entries and child journals back if evidence update fails", async () => {
  const f = await seed(),
    p = await input(f),
    before = await snapshot(f);
  await owner(
    "create function private.synthetic_history_fail() returns trigger language plpgsql as $$ begin raise exception 'SyntheticHistoryLateFailure'; end $$; create trigger synthetic_history_fail before update on asset_operation_lease_evidence for each row execute function private.synthetic_history_fail()",
  );
  try {
    await expect(write(f, p)).rejects.toThrow(/SyntheticHistoryLateFailure/);
  } finally {
    await owner(
      "drop trigger synthetic_history_fail on asset_operation_lease_evidence; drop function private.synthetic_history_fail()",
    );
  }
  expect(await snapshot(f)).toEqual(before);
});

it("serializes concurrent exact requests and posts history only once", async () => {
  const f = await seed(),
    p = await input(f),
    id = randomUUID(),
    other = await cluster.connect();
  await login(f.actor);
  await db.query("begin");
  try {
    await write(f, p, id);
    const waiting = write(f, p, id, other);
    await db.query("commit");
    expect((await waiting).idempotent).toBe(true);
  } finally {
    await db.query("rollback");
    await other.end();
  }
  expect((await snapshot(f)).entries).toHaveLength(5);
});
