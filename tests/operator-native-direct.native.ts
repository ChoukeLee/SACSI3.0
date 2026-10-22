import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
// @ts-expect-error The distributed connector intentionally has no TS application dependency.
import { OperatorClient, VERSION } from "../operator-connector/core.mjs";
// @ts-expect-error Exercise the actual distributed pending adapter, not an application mock.
import { durableClient } from "../operator-connector/pending-client.mjs";
// @ts-expect-error Replace only the OS-specific crypt adapter with synthetic AES-GCM.
import { pendingStore } from "../operator-connector/pending-store.mjs";

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("server-only", () => ({}));
// Hosted Auth/JWT verification is outside this fresh local Postgres shim. Every
// subsequent capability, grant, preview, commit and evidence read is real SQL.
vi.mock("@/features/business-actions/operator-request-auth", () => ({
  authenticateOperatorRequest: authenticate,
}));

import { GET as capabilitiesRoute } from "@/app/api/operator/v1/capabilities/route";
import { POST as queryRoute } from "@/app/api/operator/v1/native-collections/query/route";
import { POST as prepareRoute } from "@/app/api/operator/v1/native-collections/prepare/route";
import { POST as executeRoute } from "@/app/api/operator/v1/native-collections/execute/route";
import { GET as statusRoute } from "@/app/api/operator/v1/native-collections/status/route";

type Fields = Record<string, unknown>;
type Call = { path: string; method: string; body: unknown };
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>;
let db: pg.Client;
let actorId: string;
let loseCommittedResponse = false;
let rpcFailures: string[] = [];
let rpcQueue: Promise<void> = Promise.resolve();
const temporaryDirectories: string[] = [];

const signatures: Record<string, string[]> = {
  get_my_operator_capabilities: [],
  operator_collection_protocol_version: [],
  daily_workflow_protocol_version: [],
  booking_operations_protocol_version: [],
  operator_daily_payment_protocol_version: [],
  operator_direct_payment_protocol_version: [],
  operator_native_collection_protocol_version: [],
  can_execute_operator_native_collection: [],
  query_operator_native_collection: ["p_selector"],
  preview_operator_native_collection: ["p_request"],
  execute_operator_native_collection: ["p_request", "p_snapshot", "p_expires_at", "p_deployment"],
  find_operator_native_collection: ["p_request_id"],
};

async function login() {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actorId, role: "authenticated", email: "native-direct@test.invalid" }),
  ]);
  await db.query("set role authenticated");
}

function rpc(name: string, args: Fields = {}) {
  const call = async () => {
    const order = signatures[name];
    if (!order) throw new Error(`Unexpected native integration RPC ${name}`);
    let data: unknown;
    try {
      await login();
      const placeholders = order.map((_, i) => `$${i + 1}`).join(",");
      // Both identifiers and argument ordering come from this fixed allowlist.
      data = (
        await db.query(
          `select public.${name}(${placeholders}) result`,
          order.map((key) => {
            const value = args[key] ?? null;
            return value !== null && ["p_selector", "p_request", "p_snapshot"].includes(key)
              ? JSON.stringify(value)
              : value;
          }),
        )
      ).rows[0].result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "SQL failed";
      rpcFailures.push(`${name}: ${message}`);
      return { data: null, error: { message } };
    }
    if (loseCommittedResponse && name === "execute_operator_native_collection") {
      loseCommittedResponse = false;
      throw new Error("Synthetic response loss after native collection committed");
    }
    return { data, error: null };
  };
  // Capabilities/readiness use Promise.all. Serialize auth+RPC on this single
  // client so every call really executes as authenticated, never transient owner.
  const result = rpcQueue.then(call, call);
  rpcQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await installApplicationRebuild(db);
}, 45000);
afterAll(async () => {
  await rpcQueue;
  await cluster?.close();
  const parent = realpathSync(tmpdir());
  for (const directory of temporaryDirectories) {
    const target = realpathSync(directory);
    if (dirname(target) !== parent || !/^sacsi-native-direct-[A-Za-z0-9]+$/.test(basename(target)))
      throw new Error("Refusing cleanup outside the exact fresh native journal directory");
    rmSync(target, { recursive: true, force: false, maxRetries: 5, retryDelay: 100 });
  }
  vi.unstubAllEnvs();
});
beforeEach(() => {
  loseCommittedResponse = false;
  rpcFailures = [];
  vi.stubEnv("SACSI_OPERATOR_CONFIRMATIONS_ENABLED", "true");
  vi.stubEnv("SACSI_OPERATOR_DIRECT_EXECUTION_ENABLED", "true");
  vi.stubEnv("SACSI_OPERATOR_PREVIEW_SECRET", "a".repeat(64));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://native-direct-integration.invalid");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "synthetic-native-direct-integration");
  authenticate.mockImplementation(async () => ({
    authenticated: true,
    mode: "bearer",
    user: { id: actorId, role: "admin", displayName: "Synthetic native operator" },
    supabase: { rpc },
  }));
});

async function owner(sql: string, parameters: unknown[] = []) {
  await rpcQueue;
  await db.query("reset role");
  return db.query(sql, parameters);
}

async function seed(currency: "USD" | "CNY" = "USD") {
  const f = {
    actor: randomUUID(),
    project: randomUUID(),
    building: randomUUID(),
    unit: randomUUID(),
    customer: randomUUID(),
    contract: randomUUID(),
    first: randomUUID(),
    second: randomUUID(),
    property: randomUUID(),
    currency,
  };
  const dates = (
    await owner(`select current_date::text today,(current_date-60)::text start,
      (current_date-61)::text paid,(current_date+365)::text finish,(current_date-10)::text due`)
  ).rows[0] as { today: string; start: string; paid: string; finish: string; due: string };
  await owner("insert into auth.users(id,email) values($1,'native-direct@test.invalid')", [
    f.actor,
  ]);
  await owner(
    "insert into user_profiles(id,role,display_name) values($1,'admin','Synthetic native operator')",
    [f.actor],
  );
  await owner(
    "insert into projects(id,code,display_name,allows_long_lease) values($1::uuid,$1::text,'Synthetic native integration',true)",
    [f.project],
  );
  await owner(
    "insert into buildings(id,project_id,code,display_name) values($1::uuid,$2,$1::text,'Synthetic native integration')",
    [f.building, f.project],
  );
  await owner(
    "insert into units(id,building_id,code,unit_no,floor_label,status) values($1::uuid,$2,$1::text,'408','4','leased')",
    [f.unit, f.building],
  );
  await owner("insert into customers(id,name) values($1,'Synthetic native customer')", [
    f.customer,
  ]);
  await owner(
    "insert into lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,paid_through_date,payment_cycle,payment_day,monthly_rent_xof,rent_currency,monthly_rent_amount,status,commencement_state,expected_end_confirmed) values($1::uuid,$2,$3,$1::text,$4,$5,$6,'monthly',1,0,$7,10,'active','started',true)",
    [f.contract, f.unit, f.customer, dates.start, dates.finish, dates.paid, currency],
  );
  for (const [id, nativeAmount] of [
    [f.first, "10.00"],
    [f.second, "20.00"],
  ])
    await owner(
      "insert into receivables(id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,currency,amount_native,paid_amount_native,status) values($1,$2,$3,$4,'lease_contract',$5,'lease_rent','Synthetic original-currency bill',$6,0,0,$7,$8,0,'pending')",
      [id, f.building, f.unit, f.customer, f.contract, dates.due, currency, nativeAmount],
    );
  await owner(
    "insert into receivables(id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,currency,status) values($1,$2,$3,$4,'lease_contract',$5,'property_fee','Synthetic untouched XOF bill',$6,40000,'XOF','pending')",
    [f.property, f.building, f.unit, f.customer, f.contract, dates.due],
  );
  actorId = f.actor;
  return { ...f, ...dates };
}
type Fixture = Awaited<ReturnType<typeof seed>>;

function receipt(f: Fixture, extra: Fields = {}) {
  return {
    requestId: randomUUID(),
    originalInstruction: "Explicit synthetic original-currency rent receipt; never convert to XOF",
    inputSource: "natural_language",
    contractId: f.contract,
    currency: f.currency,
    amount: "4.25",
    paymentDate: f.today,
    paymentMethod: "bank_transfer",
    allocations: [
      { receivableId: f.first, amount: "1.10" },
      { receivableId: f.second, amount: "3.15" },
    ],
    ...extra,
  };
}

async function businessCounts(contractId: string) {
  return (
    await owner(
      `select (select count(*)::int from payments where source_id=$1) payments,
      (select count(*)::int from private.operator_native_collection_requests where contract_id=$1) requests,
      (select count(*)::int from audit_logs where entity_type='lease_collection' and entity_id=$1) audits`,
      [contractId],
    )
  ).rows[0] as { payments: number; requests: number; audits: number };
}

function connection(f: Fixture) {
  const config = {
    formatVersion: 1,
    appUrl: "https://native-direct-integration.invalid",
    supabaseUrl: "https://native-auth-integration.invalid",
    publishableKey: "sb_publishable_synthetic",
  };
  const store = {
    load: async () => ({
      userId: f.actor,
      accessToken: "synthetic-native-session",
      refreshToken: "synthetic-not-used",
      expiresAt: Date.now() + 3600000,
      appUrl: config.appUrl,
      supabaseUrl: config.supabaseUrl,
    }),
  };
  const calls: Call[] = [];
  const preparedCounts: Array<{ payments: number; requests: number; audits: number }> = [];
  const controls = {
    loseBeforeCommit: false,
    afterPrepare: undefined as (() => Promise<void>) | undefined,
  };
  const transport = async (url: string, init: RequestInit = {}) => {
    const request = new Request(url, init);
    expect(request.headers.get("authorization")).toBe("Bearer synthetic-native-session");
    expect(request.headers.get("cookie")).toBeNull();
    const path = new URL(url).pathname;
    calls.push({
      path,
      method: request.method,
      body: request.method === "POST" ? await request.clone().json() : null,
    });
    if (path === "/api/operator/v1/capabilities") return capabilitiesRoute(request);
    if (path === "/api/operator/v1/native-collections/query") return queryRoute(request);
    if (path === "/api/operator/v1/native-collections/status") return statusRoute(request);
    if (path === "/api/operator/v1/native-collections/prepare") {
      const response = await prepareRoute(request);
      preparedCounts.push(await businessCounts(f.contract));
      await controls.afterPrepare?.();
      return response;
    }
    if (path === "/api/operator/v1/native-collections/execute") {
      if (controls.loseBeforeCommit) {
        controls.loseBeforeCommit = false;
        throw new Error("Synthetic network loss before native execute delivery");
      }
      return executeRoute(request);
    }
    throw new Error(`Unexpected connector integration path ${path}`);
  };
  return {
    config,
    store,
    calls,
    preparedCounts,
    controls,
    client: new OperatorClient(config, store, transport),
  };
}

function encryptedJournal(site: string) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "sacsi-native-direct-"));
  temporaryDirectories.push(directory);
  const key = randomBytes(32);
  // Only the platform-specific DPAPI primitive is adapted. The production
  // journal schema, encrypted file IO, atomic rename and recovery are unchanged.
  const crypt = (value: string | Uint8Array, mode: "protect" | "unprotect") => {
    const input = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
    if (mode === "protect") {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    }
    const decipher = createDecipheriv("aes-256-gcm", key, input.subarray(0, 12));
    decipher.setAuthTag(input.subarray(12, 28));
    return Buffer.concat([decipher.update(input.subarray(28)), decipher.final()]);
  };
  return {
    directory,
    store: pendingStore(directory, site, crypt),
    reopen: () => pendingStore(directory, site, crypt),
  };
}

it.each([
  {
    currency: "USD" as const,
    source: "natural_language",
    amount: "4.25",
    first: "1.10",
    second: "3.15",
  },
  {
    currency: "CNY" as const,
    source: "excel_screenshot",
    amount: "0.3",
    first: "0.1",
    second: "0.20",
  },
])(
  "executes $currency from connector query through HTTP to original-currency SQL without a web confirmation",
  async ({ currency, source, amount, first, second }) => {
    const f = await seed(currency);
    const wire = connection(f);
    expect(VERSION).toBe("0.7.0");
    const manifest = await wire.client.capabilities();
    expect(manifest.nativeCollectionWorkflow).toMatchObject({
      available: true,
      domain: "lease",
      currencies: ["USD", "CNY"],
      confirmationRequired: false,
      automaticConversion: false,
    });
    const found = await wire.client.nativeCollection("query", {
      buildingCode: f.building,
      unitNo: "408",
    });
    expect(found.status).toBe("found");
    expect(found.contract).toMatchObject({ id: f.contract, rent_currency: currency });
    expect(found.receivables.map((row: { id: string }) => row.id).sort()).toEqual(
      [f.first, f.second].sort(),
    );
    expect(await businessCounts(f.contract)).toEqual({ payments: 0, requests: 0, audits: 0 });
    const request = receipt(f, {
      inputSource: source,
      amount,
      actualCollector: "Synthetic cashier",
      collectorBasis: "Explicit synthetic receipt names the cashier",
      allocations: [
        { receivableId: f.first, amount: first },
        { receivableId: f.second, amount: second },
      ],
    });
    const result = await wire.client.nativeCollection("execute", request);
    const canonicalAmount = currency === "CNY" ? "0.30" : "4.25";
    expect(result, rpcFailures.join("; ")).toMatchObject({
      status: "completed",
      verified: true,
      requestId: request.requestId,
      currency,
      amount: canonicalAmount,
      contractId: f.contract,
      executionMode: "explicit_instruction",
      paidThroughBefore: f.paid,
      paidThroughAfter: f.paid,
    });
    expect(wire.preparedCounts).toEqual([{ payments: 0, requests: 0, audits: 0 }]);
    expect(await businessCounts(f.contract)).toEqual({ payments: 1, requests: 1, audits: 1 });
    const payment = (
      await owner(
        "select amount::text,currency::text,native_settlement,exchange_rate_to_xof,recorded_by,request_id,actual_collector from payments where source_id=$1",
        [f.contract],
      )
    ).rows[0];
    expect(payment).toEqual({
      amount: canonicalAmount,
      currency,
      native_settlement: true,
      exchange_rate_to_xof: null,
      recorded_by: f.actor,
      request_id: request.requestId,
      actual_collector: "Synthetic cashier",
    });
    expect(
      (
        await owner(
          "select l.amount_xof::text,l.amount_native::text,l.currency::text from ledger_entries l join payments p on p.id=l.payment_id where p.source_id=$1",
          [f.contract],
        )
      ).rows,
    ).toEqual([{ amount_xof: "0.00", amount_native: canonicalAmount, currency }]);
    const expectedPieces = [
      { receivable_id: f.first, amount_native: currency === "CNY" ? "0.10" : "1.10", currency },
      { receivable_id: f.second, amount_native: currency === "CNY" ? "0.20" : "3.15", currency },
    ].sort((a, b) => a.receivable_id.localeCompare(b.receivable_id));
    expect(
      (
        await owner(
          "select receivable_id,amount_native::text,currency::text from lease_native_payment_allocations where request_id=$1 order by receivable_id",
          [request.requestId],
        )
      ).rows,
    ).toEqual(expectedPieces);
    expect(
      (
        await owner(
          "select amount_xof::text,paid_amount_xof::text,currency::text from receivables where id=$1",
          [f.property],
        )
      ).rows[0],
    ).toEqual({ amount_xof: "40000.00", paid_amount_xof: "0.00", currency: "XOF" });
    const audit = (
      await owner(
        "select actor_id,metadata from audit_logs where entity_type='lease_collection' and entity_id=$1",
        [f.contract],
      )
    ).rows[0];
    expect(audit.actor_id).toBe(f.actor);
    expect(audit.metadata).toMatchObject({
      channel: "external_codex",
      authorization: "explicit_instruction",
      original_instruction: request.originalInstruction,
      input_source: source,
      connector_version: "0.7.0",
      protocol_version: "1.0",
    });
    expect(wire.calls.filter((call) => call.method === "POST").map((call) => call.path)).toEqual([
      "/api/operator/v1/native-collections/query",
      "/api/operator/v1/native-collections/prepare",
      "/api/operator/v1/native-collections/execute",
    ]);
    expect(
      wire.calls.some((call) => /drafts|confirmations|\/operator\/(?!v1)/.test(call.path)),
    ).toBe(false);
    expect(rpcFailures).toEqual([]);
  },
);

it("returns only historical completion when the same native UUID is repeated, never another execute POST", async () => {
  const f = await seed();
  const wire = connection(f);
  const request = receipt(f);
  await wire.client.nativeCollection("execute", request);
  const repeated = await wire.client.nativeCollection("execute", request);
  expect(repeated).toMatchObject({
    status: "completed_previously",
    verified: false,
    requestId: request.requestId,
    currency: "USD",
    amount: "4.25",
    contractId: f.contract,
  });
  expect(wire.calls.filter((call) => call.path.endsWith("/execute"))).toHaveLength(1);
  expect(await businessCounts(f.contract)).toEqual({ payments: 1, requests: 1, audits: 1 });
  expect(rpcFailures).toEqual([]);
});

it("keeps connector, HTTP proof and persisted request identity aligned after decimal, UUID and text normalization", async () => {
  const f = await seed();
  const wire = connection(f);
  const id = randomUUID();
  const request = receipt(f, {
    requestId: id.toUpperCase(),
    contractId: f.contract.toUpperCase(),
    amount: "4.2",
    originalInstruction: "  Explicit synthetic normalized original-currency receipt  ",
    actualCollector: "  Synthetic cashier  ",
    collectorBasis: "  Explicit synthetic cashier evidence  ",
    notes: "  Synthetic preserved note  ",
    allocations: [
      { receivableId: f.first.toUpperCase(), amount: "1" },
      { receivableId: f.second.toUpperCase(), amount: "3.2" },
    ],
  });
  expect(await wire.client.nativeCollection("execute", request)).toMatchObject({
    status: "completed",
    verified: true,
    requestId: id,
    contractId: f.contract,
    amount: "4.20",
  });
  const saved = (
    await owner(
      "select request_data from private.operator_native_collection_requests where request_id=$1",
      [id],
    )
  ).rows[0].request_data;
  expect(saved).toMatchObject({
    requestId: id,
    contractId: f.contract,
    amount: "4.20",
    originalInstruction: "Explicit synthetic normalized original-currency receipt",
    actualCollector: "Synthetic cashier",
    collectorBasis: "Explicit synthetic cashier evidence",
    notes: "Synthetic preserved note",
    allocations: [
      { receivableId: f.first, amount: "1.00" },
      { receivableId: f.second, amount: "3.20" },
    ],
  });
  expect(await businessCounts(f.contract)).toEqual({ payments: 1, requests: 1, audits: 1 });
  expect(rpcFailures).toEqual([]);
});

it("persists an unknown committed result and recovers the same UUID after reopening the journal even when new writes are disabled", async () => {
  const f = await seed("CNY");
  const wire = connection(f);
  const journal = encryptedJournal(wire.config.appUrl);
  const client = durableClient(wire.client, wire.store, journal.store, wire.config);
  const request = receipt(f);
  loseCommittedResponse = true;
  await expect(client.nativeCollection("execute", request)).rejects.toThrow(
    "native_collection_outcome_unknown",
  );
  expect(await businessCounts(f.contract)).toEqual({ payments: 1, requests: 1, audits: 1 });
  expect(journal.store.get(f.actor, request.requestId)).toMatchObject({
    requestId: request.requestId,
    kind: "native_collection",
    executionMode: "direct",
    state: "unknown",
    request: { amount: "4.25", currency: "CNY" },
  });
  const ciphertext = readFileSync(
    join(journal.directory, "pending-v1", readdirSync(join(journal.directory, "pending-v1"))[0]),
  );
  expect(ciphertext.includes(Buffer.from(request.originalInstruction))).toBe(false);
  const reopenedJournal = journal.reopen();
  expect(reopenedJournal.get(f.actor, request.requestId).state).toBe("unknown");
  const reopened = durableClient(wire.client, wire.store, reopenedJournal, wire.config);
  vi.stubEnv("SACSI_OPERATOR_DIRECT_EXECUTION_ENABLED", "false");
  const recovered = await reopened.pending("recover", { requestId: request.requestId });
  expect(recovered).toMatchObject({
    status: "completed_previously",
    verified: false,
    requestId: request.requestId,
    currency: "CNY",
    amount: "4.25",
    contractId: f.contract,
  });
  expect(reopenedJournal.get(f.actor, request.requestId).state).toBe("completed_history");
  await expect(reopened.nativeCollection("execute", request)).rejects.toThrow(
    "pending_already_completed_do_not_repeat",
  );
  expect(wire.calls.filter((call) => call.path.endsWith("/execute"))).toHaveLength(1);
  expect(await businessCounts(f.contract)).toEqual({ payments: 1, requests: 1, audits: 1 });
  expect(rpcFailures).toEqual([]);
});

it("does not replay an undelivered unknown receipt during recovery and executes only after an explicit same-UUID retry", async () => {
  const f = await seed();
  const wire = connection(f);
  const journal = encryptedJournal(wire.config.appUrl);
  const client = durableClient(wire.client, wire.store, journal.store, wire.config);
  const request = receipt(f);
  wire.controls.loseBeforeCommit = true;
  await expect(client.nativeCollection("execute", request)).rejects.toThrow(
    "outcome_unknown_keep_original_request_id",
  );
  expect(await businessCounts(f.contract)).toEqual({ payments: 0, requests: 0, audits: 0 });
  const recovered = await client.pending("recover", { requestId: request.requestId });
  expect(recovered).toMatchObject({
    status: "not_found",
    requestId: request.requestId,
    verified: false,
    state: "unknown",
  });
  expect(wire.calls.filter((call) => call.path.endsWith("/execute"))).toHaveLength(1);
  expect(await businessCounts(f.contract)).toEqual({ payments: 0, requests: 0, audits: 0 });
  const explicitRetry = await client.nativeCollection("execute", request);
  expect(explicitRetry).toMatchObject({
    status: "completed",
    verified: true,
    requestId: request.requestId,
    localPendingSaved: true,
  });
  expect(journal.store.get(f.actor, request.requestId).state).toBe("completed_history");
  expect(wire.calls.filter((call) => call.path.endsWith("/execute"))).toHaveLength(2);
  expect(await businessCounts(f.contract)).toEqual({ payments: 1, requests: 1, audits: 1 });
  expect(rpcFailures).toEqual([]);
});

it("rejects a changed native snapshot after the connector preview without creating payments or a web draft", async () => {
  const f = await seed();
  const wire = connection(f);
  wire.controls.afterPrepare = async () => {
    await owner(
      "update receivables set notes='Synthetic changed fact after signed preview' where id=$1",
      [f.first],
    );
  };
  await expect(wire.client.nativeCollection("execute", receipt(f))).rejects.toThrow();
  expect(wire.preparedCounts).toEqual([{ payments: 0, requests: 0, audits: 0 }]);
  expect(await businessCounts(f.contract)).toEqual({ payments: 0, requests: 0, audits: 0 });
  expect(wire.calls.filter((call) => call.path.endsWith("/execute"))).toHaveLength(1);
  expect(rpcFailures).toEqual([]);
});

it("rechecks real database role after preview rather than trusting the earlier bearer user descriptor", async () => {
  const f = await seed();
  const wire = connection(f);
  wire.controls.afterPrepare = async () => {
    await owner("update user_profiles set role='boss' where id=$1", [f.actor]);
  };
  await expect(wire.client.nativeCollection("execute", receipt(f))).rejects.toThrow(
    "nativeCollectionPermissionDenied",
  );
  expect(await businessCounts(f.contract)).toEqual({ payments: 0, requests: 0, audits: 0 });
  expect(wire.calls.filter((call) => call.path.endsWith("/execute"))).toHaveLength(1);
  expect(rpcFailures).toEqual([]);
});
