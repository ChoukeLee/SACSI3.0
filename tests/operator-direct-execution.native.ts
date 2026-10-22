import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";
// @ts-expect-error Standalone Node connector distribution has no application TS dependency.
import { OperatorClient } from "../operator-connector/core.mjs";

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/business-actions/operator-request-auth", () => ({
  authenticateOperatorRequest: authenticate,
}));

import { POST as paymentPreview } from "@/app/api/operator/v1/confirmations/prepare/route";
import { POST as directPaymentRoute } from "@/app/api/operator/v1/confirmations/execute/route";
import { GET as capabilitiesRoute } from "@/app/api/operator/v1/capabilities/route";
import { GET as paymentStatusRoute } from "@/app/api/operator/v1/confirmations/status/route";
import { collectionPost } from "@/features/business-actions/operator-collection-http";
import { dailyWorkflowPost } from "@/features/business-actions/operator-daily-workflow-http";
import { bookingOperationPost } from "@/features/business-actions/operator-booking-operation-http";
import { executeOperatorDirect } from "@/features/business-actions/operator-direct-execution";

type Workflow = "daily_payment" | "collection" | "daily_workflow" | "booking_operation";
type Fields = Record<string, unknown>;
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>;
let db: Awaited<ReturnType<Awaited<ReturnType<typeof createNativePaymentPostgres>>["connect"]>>;
let actorId: string;
let loseCommittedResponse = false;
let rpcFailures: string[] = [];

const signatures: Record<string, string[]> = {
  get_my_operator_capabilities: [],
  can_execute_operator_action: ["p_action_name", "p_risk_level"],
  operator_daily_payment_protocol_version: [],
  operator_direct_payment_protocol_version: [],
  operator_collection_protocol_version: [],
  daily_workflow_protocol_version: [],
  booking_operations_protocol_version: [],
  daily_booking_operation_snapshot: ["p_booking_id"],
  daily_record_payment_rpc: [
    "p_booking_id",
    "p_amount",
    "p_payment_date",
    "p_receipt_no",
    "p_request_id",
    "p_actor",
  ],
  verify_operator_daily_payment: ["p_booking_id", "p_request_id"],
  create_operator_payment_confirmation: ["p_request", "p_snapshot", "p_expires_at"],
  reprepare_operator_payment_confirmation: [
    "p_previous_id",
    "p_request",
    "p_snapshot",
    "p_expires_at",
  ],
  get_operator_payment_confirmation: ["p_id"],
  confirm_operator_payment: ["p_id"],
  find_operator_payment_confirmation: ["p_request_id"],
  preview_operator_collection: ["p_request"],
  create_operator_collection: [
    "p_request",
    "p_snapshot",
    "p_expires_at",
    "p_deployment",
    "p_replaces_id",
  ],
  get_operator_collection: ["p_id"],
  confirm_operator_collection: ["p_id"],
  find_operator_collection: ["p_request_id"],
  preview_daily_workflow: ["p_request"],
  create_daily_workflow: [
    "p_request",
    "p_snapshot",
    "p_expires_at",
    "p_deployment",
    "p_replaces_id",
  ],
  get_daily_workflow: ["p_id"],
  confirm_daily_workflow: ["p_id"],
  find_daily_workflow: ["p_request_id"],
  operator_booking_operation: [
    "p_mode",
    "p_request",
    "p_id",
    "p_snapshot",
    "p_expires_at",
    "p_deployment",
    "p_replaces_id",
  ],
};

async function login() {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actorId, role: "authenticated", email: "direct@test.invalid" }),
  ]);
  await db.query("set role authenticated");
}

async function rpc(name: string, args: Fields = {}) {
  const order = signatures[name];
  if (!order) {
    rpcFailures.push(`Unexpected native test RPC ${name}`);
    throw new Error(`Unexpected native test RPC ${name}`);
  }
  let data: unknown;
  try {
    await login();
    const placeholders = order.map((_, index) => `$${index + 1}`).join(",");
    // Function names and argument order come only from this test's allow list.
    data = (
      await db.query(
        `select public.${name}(${placeholders}) result`,
        order.map((key) => {
          const value = args[key] ?? null;
          return value !== null && ["p_request", "p_snapshot", "p_actor"].includes(key)
            ? JSON.stringify(value)
            : value;
        }),
      )
    ).rows[0].result;
  } catch (error) {
    rpcFailures.push(`${name}: ${error instanceof Error ? error.message : "SQL failed"}`);
    return {
      data: null,
      error: { message: error instanceof Error ? error.message : "SQL failed" },
    };
  }
  if (
    loseCommittedResponse &&
    (name === "confirm_daily_workflow" ||
      name === "confirm_operator_collection" ||
      name === "confirm_operator_payment" ||
      name === "daily_record_payment_rpc" ||
      (name === "operator_booking_operation" && args.p_mode === "confirm"))
  ) {
    loseCommittedResponse = false;
    throw new Error("Synthetic response loss after the native transaction committed");
  }
  return { data, error: null };
}

beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await installApplicationRebuild(db);
}, 45000);
afterAll(async () => {
  await cluster?.close();
  vi.unstubAllEnvs();
});
beforeEach(() => {
  loseCommittedResponse = false;
  rpcFailures = [];
  vi.stubEnv("SACSI_OPERATOR_CONFIRMATIONS_ENABLED", "true");
  vi.stubEnv("SACSI_OPERATOR_DIRECT_EXECUTION_ENABLED", "true");
  vi.stubEnv("SACSI_OPERATOR_PREVIEW_SECRET", "8".repeat(64));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://native-direct-test.invalid");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "native-direct-execution");
  authenticate.mockImplementation(async () => ({
    authenticated: true,
    mode: "bearer",
    user: { id: actorId, role: "admin", displayName: "Synthetic direct operator" },
    supabase: { rpc },
  }));
});

async function owner(sql: string, parameters: unknown[] = []) {
  await db.query("reset role");
  return db.query(sql, parameters);
}

async function seed(status = "checked_in", currentDeparture = false) {
  const actor = randomUUID(),
    project = randomUUID(),
    building = randomUUID();
  const unit = randomUUID(),
    target = randomUUID(),
    agent = randomUUID();
  const booking = randomUUID(),
    receivable = randomUUID();
  const dates = (
    await owner(
      "select current_date::text today,(current_date+2)::text later,(current_date+3)::text extra,(current_date-3)::text earlier",
    )
  ).rows[0] as { today: string; later: string; extra: string; earlier: string };
  const checkIn = currentDeparture ? dates.earlier : dates.today;
  const checkOut = currentDeparture ? dates.today : dates.later;
  const total = currentDeparture ? 30000 : 20000;
  await owner("insert into auth.users(id,email) values($1,'direct@test.invalid')", [actor]);
  await owner(
    "insert into user_profiles(id,role,display_name) values($1,'admin','Synthetic direct operator')",
    [actor],
  );
  await owner(
    "insert into projects(id,code,display_name,allows_daily_rental) values($1::uuid,$1::text,'Synthetic',true)",
    [project],
  );
  await owner(
    "insert into buildings(id,project_id,code,display_name) values($1::uuid,$2,$1::text,'Synthetic')",
    [building, project],
  );
  await owner(
    "insert into units(id,building_id,code,unit_no,floor_label,status) values($1::uuid,$3,$1::text,'D01','T',$4),($2::uuid,$3,$2::text,'D02','T','available')",
    [unit, target, building, status === "confirmed" ? "reserved" : "daily_occupied"],
  );
  await owner(
    "insert into unit_business_flags(unit_id,business_type,is_enabled) values($1,'daily_rental',true),($2,'daily_rental',true)",
    [unit, target],
  );
  await owner("insert into customers(id,name) values($1,'Synthetic agent')", [agent]);
  await owner(
    "insert into daily_bookings(id,unit_id,customer_id,booking_agent_id,check_in,check_out,nightly_price_xof,total_amount_xof,final_amount_xof,status,billing_status) values($1,$2,$3,$3,$4,$5,10000,$6,$6,$7,'need_top_up')",
    [booking, unit, agent, checkIn, checkOut, total, status],
  );
  await owner(
    "insert into receivables(id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof) values($1,$2,$3,$4,'daily_booking',$5,'daily_rental','Synthetic direct stay',$6,$7)",
    [receivable, building, unit, agent, booking, checkIn, total],
  );
  actorId = actor;
  await login();
  return { actor, unit, target, agent, booking, receivable, total, ...dates };
}

function http(body: unknown) {
  return new Request("https://native-direct-test.invalid/api/operator/v1/direct-test", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer synthetic-test-only" },
    body: JSON.stringify(body),
  });
}
async function prepare(workflow: Workflow, request: Fields) {
  const response =
    workflow === "daily_payment"
      ? await paymentPreview(http(request))
      : workflow === "collection"
        ? await collectionPost(http(request), "prepare")
        : workflow === "daily_workflow"
          ? await dailyWorkflowPost(http(request), "prepare")
          : await bookingOperationPost(http(request), "prepare");
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(body.previewProof).toBeTypeOf("string");
  return { request, previewProof: body.previewProof as string };
}
async function execute(workflow: Workflow, envelope: Fields) {
  const response = await executeOperatorDirect(http(envelope), workflow);
  return { status: response.status, body: await response.json() };
}
async function countPayments(bookingId: string) {
  return (await owner("select count(*)::int n from payments where source_id=$1", [bookingId]))
    .rows[0].n as number;
}
function operation(bookingId: string, name: string, fields: Fields = {}) {
  return {
    requestId: randomUUID(),
    operation: name,
    bookingId,
    originalInstruction: "Explicit synthetic business instruction",
    ...fields,
  };
}
async function pay(bookingId: string, amount = 20000) {
  const result = await rpc("daily_record_payment_rpc", {
    p_booking_id: bookingId,
    p_amount: amount,
    p_payment_date: new Date().toISOString().slice(0, 10),
    p_request_id: randomUUID(),
    p_actor: { channel: "external_codex", original_instruction: "Synthetic setup receipt" },
  });
  expect(result.error).toBeNull();
  return (await owner("select id from payments where source_id=$1 and amount>0", [bookingId]))
    .rows[0].id as string;
}

it("records a single payment through the direct HTTP boundary with native financial and actor evidence", async () => {
  const f = await seed();
  const request = {
    protocolVersion: "1.0",
    connectorVersion: "0.6.0",
    requestId: randomUUID(),
    actionName: "record_daily_payment",
    scope: "business_data",
    exceptionalBusinessCase: false,
    inputSource: "excel_screenshot",
    originalInstruction: "Explicit synthetic screenshot receipt",
    input: { bookingId: f.booking, amountXof: 10000, paymentDate: f.today },
  };
  const result = await execute("daily_payment", await prepare("daily_payment", request));
  expect(result.status, `${JSON.stringify(result.body)} ${rpcFailures.join("; ")}`).toBe(200);
  expect(result.body).toMatchObject({
    status: "completed",
    requestId: request.requestId,
    verified: true,
  });
  expect(await countPayments(f.booking)).toBe(1);
  const audits = (
    await owner("select actor_id,metadata from audit_logs where entity_id=$1", [f.booking])
  ).rows;
  expect(
    audits.some((row) => row.actor_id === f.actor && row.metadata.channel === "external_codex"),
  ).toBe(true);
  expect(audits.some((row) => row.metadata.channel === "sacsi_web")).toBe(false);
});

it("replaces a pending natural-language payment under the same request ID and retains its original proposal and source", async () => {
  const f = await seed();
  const requestId = randomUUID();
  const initial = {
    protocolVersion: "1.0",
    connectorVersion: "0.6.0",
    requestId,
    actionName: "record_daily_payment",
    scope: "business_data",
    exceptionalBusinessCase: false,
    inputSource: "natural_language",
    originalInstruction: "Synthetic initial pending receipt of 5000",
    input: { bookingId: f.booking, amountXof: 5000, paymentDate: f.today, receiptNo: null },
  };
  const snapshot = await rpc("daily_booking_operation_snapshot", { p_booking_id: f.booking });
  expect(snapshot.error).toBeNull();
  const firstDraft = await rpc("create_operator_payment_confirmation", {
    p_request: {
      ...initial,
      executionChannel: "external_codex",
      executionAuthorization: "explicit_instruction",
      confirmationDeployment: `${process.env.NEXT_PUBLIC_SUPABASE_URL}|${process.env.VERCEL_GIT_COMMIT_SHA}`,
    },
    p_snapshot: snapshot.data,
    p_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });
  expect(firstDraft.error).toBeNull();
  const originalId = (firstDraft.data as { id: string }).id;
  const revised = {
    ...initial,
    originalInstruction: "Explicit synthetic correction: receipt amount is 10000",
    input: { ...initial.input, amountXof: 10000 },
  };
  const result = await execute("daily_payment", {
    ...(await prepare("daily_payment", revised)),
    replacesConfirmationId: originalId,
  });
  expect(result.status, `${JSON.stringify(result.body)} ${rpcFailures.join("; ")}`).toBe(200);
  expect(result.body).toMatchObject({ status: "completed", verified: true, requestId });
  const current = (
    await owner(
      "select id,request_id,request_data,status from private.operator_payment_confirmations where request_id=$1",
      [requestId],
    )
  ).rows[0];
  expect(current.id).not.toBe(originalId);
  expect(current.status).toBe("completed");
  expect(current.request_id).toBe(requestId);
  expect(current.request_data).toMatchObject({
    inputSource: "natural_language",
    executionChannel: "external_codex",
    executionAuthorization: "explicit_instruction",
  });
  expect(current.request_data.input.amountXof).toBe(10000);
  const previous = (
    await owner(
      "select successor_id,previous_record from private.operator_confirmation_history where id=$1 and request_id=$2",
      [originalId, requestId],
    )
  ).rows[0];
  expect(previous.successor_id).toBe(current.id);
  expect(previous.previous_record.request_data).toMatchObject({
    inputSource: "natural_language",
    originalInstruction: initial.originalInstruction,
  });
  expect(previous.previous_record.request_data.input.amountXof).toBe(5000);
  const audit = (
    await owner(
      "select actor_id,metadata from audit_logs where action='reprepare_operator_payment' and entity_id=$1",
      [f.booking],
    )
  ).rows[0];
  expect(audit.actor_id).toBe(f.actor);
  expect(audit.metadata).toMatchObject({
    channel: "external_codex",
    input_source: "natural_language",
    previous_amount: 5000,
    amount: 10000,
  });
  expect(await countPayments(f.booking)).toBe(1);
  expect(
    (await owner("select amount,request_id from payments where source_id=$1", [f.booking])).rows[0],
  ).toEqual({ amount: "10000.00", request_id: requestId });
});

it("does not let the legacy payment create or reprepare path accept natural language without direct execution metadata", async () => {
  const f = await seed();
  const request = {
    protocolVersion: "1.0",
    connectorVersion: "0.6.0",
    requestId: randomUUID(),
    actionName: "record_daily_payment",
    scope: "business_data",
    exceptionalBusinessCase: false,
    inputSource: "natural_language",
    originalInstruction: "Synthetic legacy natural language must not bypass its channel",
    input: { bookingId: f.booking, amountXof: 10000, paymentDate: f.today },
  };
  const snapshot = await rpc("daily_booking_operation_snapshot", { p_booking_id: f.booking });
  expect(snapshot.error).toBeNull();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const rejectedCreate = await rpc("create_operator_payment_confirmation", {
    p_request: request,
    p_snapshot: snapshot.data,
    p_expires_at: expiresAt,
  });
  expect(rejectedCreate.error?.message).toContain("invalidConfirmationRequest");
  const validLegacy = await rpc("create_operator_payment_confirmation", {
    p_request: { ...request, inputSource: "excel_screenshot" },
    p_snapshot: snapshot.data,
    p_expires_at: expiresAt,
  });
  expect(validLegacy.error).toBeNull();
  const rejectedReplacement = await rpc("reprepare_operator_payment_confirmation", {
    p_previous_id: (validLegacy.data as { id: string }).id,
    p_request: request,
    p_snapshot: snapshot.data,
    p_expires_at: expiresAt,
  });
  expect(rejectedReplacement.error?.message).toContain("invalidConfirmationRequest");
  expect(await countPayments(f.booking)).toBe(0);
  expect(
    (
      await owner(
        "select count(*)::int n from private.operator_confirmation_history where request_id=$1",
        [request.requestId],
      )
    ).rows[0].n,
  ).toBe(0);
});

it("runs the distributed connector through actual HTTP handlers and native SQL, then recovers the same natural-language request without another payment", async () => {
  const f = await seed();
  const origin = "https://native-direct-test.invalid";
  const authOrigin = "https://native-auth-test.invalid";
  const calls: string[] = [];
  const transport = async (url: string, init: RequestInit = {}) => {
    const request = new Request(url, init);
    const path = new URL(url).pathname;
    calls.push(path);
    if (path === "/api/operator/v1/capabilities") return capabilitiesRoute(request);
    if (path === "/api/operator/v1/confirmations/status") return paymentStatusRoute(request);
    if (path === "/api/operator/v1/confirmations/prepare") return paymentPreview(request);
    if (path === "/api/operator/v1/confirmations/execute") return directPaymentRoute(request);
    throw new Error(`Unexpected connector transport path ${path}`);
  };
  const client = new OperatorClient(
    {
      formatVersion: 1,
      appUrl: origin,
      supabaseUrl: authOrigin,
      publishableKey: "sb_publishable_synthetic",
    },
    {
      load: async () => ({
        userId: f.actor,
        accessToken: "synthetic-native-session",
        refreshToken: "synthetic-not-used",
        expiresAt: Date.now() + 3600000,
        appUrl: origin,
        supabaseUrl: authOrigin,
      }),
    },
    transport,
  );
  const request = {
    requestId: randomUUID(),
    actionName: "record_daily_payment",
    scope: "business_data",
    exceptionalBusinessCase: false,
    inputSource: "natural_language",
    originalInstruction: "Explicit synthetic natural-language receipt instruction",
    input: { bookingId: f.booking, amountXof: 10000, paymentDate: f.today },
  };
  const first = await client.executePayment(request);
  expect(first).toMatchObject({
    status: "completed",
    verified: true,
    requestId: request.requestId,
  });
  expect(await countPayments(f.booking)).toBe(1);
  const replay = await client.executePayment(request);
  expect(replay).toMatchObject({
    status: "completed_previously",
    verified: false,
    requestId: request.requestId,
  });
  expect(await countPayments(f.booking)).toBe(1);
  expect(calls.filter((path) => path.endsWith("/execute"))).toHaveLength(1);
  expect(
    calls.some((path) => path.includes("/drafts") || /\/confirmations\/[0-9a-f-]{36}$/.test(path)),
  ).toBe(false);
  const audit = (
    await owner(
      "select metadata from audit_logs where action='confirm_operator_payment' and entity_id=$1",
      [f.booking],
    )
  ).rows[0].metadata;
  expect(audit).toMatchObject({
    channel: "external_codex",
    input_source: "natural_language",
    confirmation_method: "explicit_instruction",
  });
});

it("posts a collection batch without a web confirmation while retaining explicit allocation and payment method", async () => {
  const f = await seed();
  const request = {
    protocolVersion: "1.0",
    connectorVersion: "0.6.0",
    requestId: randomUUID(),
    originalInstruction: "Explicit synthetic collection instruction",
    totalXof: 10000,
    rows: [
      {
        lineId: "receipt-line-1",
        sourceText: "Synthetic D01 XOF 10000 bank transfer",
        domain: "daily",
        targetId: f.booking,
        totalXof: 10000,
        paymentDate: f.today,
        paymentMethod: "bank_transfer",
        allocations: [{ receivableId: f.receivable, amountXof: 10000 }],
      },
    ],
  };
  const result = await execute("collection", await prepare("collection", request));
  expect(result.status, `${JSON.stringify(result.body)} ${rpcFailures.join("; ")}`).toBe(200);
  expect(result.body).toMatchObject({
    verified: true,
    requestId: request.requestId,
    totalXof: 10000,
  });
  const payment = (
    await owner("select amount,payment_method from payments where source_id=$1", [f.booking])
  ).rows[0];
  expect(payment).toEqual({ amount: "10000.00", payment_method: "bank_transfer" });
  expect(
    (
      await owner(
        "select actor_id from audit_logs where action='operator_collection_item' and entity_id=$1",
        [f.receivable],
      )
    ).rows[0].actor_id,
  ).toBe(f.actor);
});

it("atomically extends and collects as one direct business operation", async () => {
  const f = await seed("checked_in", true);
  const request = operation(f.booking, "extend_and_collect", {
    effectiveCheckOut: f.later,
    amountXof: 50000,
    paymentDate: f.today,
    paymentMethod: "bank_transfer",
  });
  const result = await execute("daily_workflow", await prepare("daily_workflow", request));
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(result.body).toMatchObject({
    verified: true,
    requestId: request.requestId,
    amountXof: 50000,
  });
  const row = (
    await owner(
      "select check_out::text,final_amount_xof,prepaid_amount_xof,status from daily_bookings where id=$1",
      [f.booking],
    )
  ).rows[0];
  expect(row).toEqual({
    check_out: f.later,
    final_amount_xof: "50000.00",
    prepaid_amount_xof: "50000.00",
    status: "checked_in",
  });
  expect(await countPayments(f.booking)).toBe(1);
});

it("executes an explicit reversal without deleting the original receipt or changing its owner", async () => {
  const f = await seed();
  const paymentId = await pay(f.booking);
  const request = operation(f.booking, "reverse", {
    paymentId,
    reason: "Explicit synthetic wrong receipt correction",
  });
  const result = await execute("booking_operation", await prepare("booking_operation", request));
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(result.body).toMatchObject({ verified: true, requestId: request.requestId });
  expect(await countPayments(f.booking)).toBe(2);
  expect(
    (
      await owner(
        "select amount,request_kind,reversal_of_payment_id from payments where request_id=$1",
        [request.requestId],
      )
    ).rows[0],
  ).toEqual({
    amount: "-20000.00",
    request_kind: "daily_reversal",
    reversal_of_payment_id: paymentId,
  });
});

it("records an explicitly specified actual refund separately from a reversal", async () => {
  const f = await seed("checked_out");
  const original = await pay(f.booking);
  const request = operation(f.booking, "refund", {
    amountXof: 5000,
    finalAmountXof: 15000,
    paymentDate: f.today,
    paymentMethod: "bank_transfer",
    reason: "Explicit synthetic actual customer refund",
  });
  const result = await execute("booking_operation", await prepare("booking_operation", request));
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(result.body).toMatchObject({ verified: true, requestId: request.requestId });
  const refund = (
    await owner(
      "select id,amount,request_kind,payment_method,reversal_of_payment_id from payments where request_id=$1",
      [request.requestId],
    )
  ).rows[0];
  expect(refund).toMatchObject({
    amount: "-5000.00",
    request_kind: "daily_refund",
    payment_method: "bank_transfer",
    reversal_of_payment_id: null,
  });
  expect(
    (
      await owner("select direction,amount_xof from ledger_entries where payment_id=$1", [
        refund.id,
      ])
    ).rows[0],
  ).toEqual({ direction: "expense", amount_xof: "5000.00" });
  expect((await owner("select id from payments where id=$1", [original])).rows[0].id).toBe(
    original,
  );
});

it("corrects an explicitly identified historical room error while preserving financial history", async () => {
  const f = await seed();
  const paymentId = await pay(f.booking);
  const before = (await owner("select * from payments where id=$1", [paymentId])).rows[0];
  const request = operation(f.booking, "correct_room", {
    targetUnitId: f.target,
    reason: "Explicit synthetic originally mistyped room",
  });
  const result = await execute("booking_operation", await prepare("booking_operation", request));
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(result.body).toMatchObject({ verified: true, requestId: request.requestId });
  expect((await owner("select * from payments where id=$1", [paymentId])).rows[0]).toEqual({
    ...before,
    unit_id: f.target,
  });
  expect(
    (
      await owner("select unit_id,booking_agent_id,status from daily_bookings where id=$1", [
        f.booking,
      ])
    ).rows[0],
  ).toEqual({ unit_id: f.target, booking_agent_id: f.agent, status: "checked_in" });
});

it("stops a stale signed snapshot before cancellation and preserves the original request identity", async () => {
  const f = await seed("confirmed");
  const request = operation(f.booking, "cancel", { reason: "Explicit synthetic stale-state test" });
  const envelope = await prepare("booking_operation", request);
  await owner("update daily_bookings set notes='Changed business fact after preview' where id=$1", [
    f.booking,
  ]);
  const result = await execute("booking_operation", envelope);
  expect(result.status).toBe(409);
  expect(
    (await owner("select status from daily_bookings where id=$1", [f.booking])).rows[0].status,
  ).toBe("confirmed");
  expect(
    (
      await owner(
        "select count(*)::int n from audit_logs where action='operator_booking_cancel' and entity_id=$1",
        [f.booking],
      )
    ).rows[0].n,
  ).toBe(0);
});

it("rechecks current database grants even when the earlier bearer identity and preview were valid", async () => {
  const f = await seed("confirmed");
  const request = operation(f.booking, "cancel", {
    reason: "Explicit synthetic privilege revocation test",
  });
  const envelope = await prepare("booking_operation", request);
  await owner("update user_profiles set role='boss' where id=$1", [f.actor]);
  const result = await execute("booking_operation", envelope);
  expect(result.status).toBe(403);
  expect(
    (await owner("select status from daily_bookings where id=$1", [f.booking])).rows[0].status,
  ).toBe("confirmed");
});

it("recovers a committed-but-lost response by original identity without executing twice", async () => {
  const f = await seed("confirmed");
  const request = operation(f.booking, "cancel", {
    reason: "Explicit synthetic lost-response test",
  });
  const envelope = await prepare("booking_operation", request);
  loseCommittedResponse = true;
  const first = await execute("booking_operation", envelope);
  expect(first.status).toBe(503);
  expect(first.body).toMatchObject({
    requestId: request.requestId,
    retryPolicy: "recheck_same_request_id_only",
  });
  const status = await rpc("operator_booking_operation", {
    p_mode: "status",
    p_request: { requestId: request.requestId },
  });
  expect(status.error).toBeNull();
  expect(status.data).toMatchObject({
    status: "completed",
    requestId: request.requestId,
    verified: false,
  });
  await execute("booking_operation", envelope);
  expect(
    (
      await owner(
        "select count(*)::int n from audit_logs where action='operator_booking_cancel' and entity_id=$1",
        [f.booking],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (await owner("select status from daily_bookings where id=$1", [f.booking])).rows[0].status,
  ).toBe("cancelled");
});

it("upgrades an existing pending web payment without changing its facts, audit channel or function grants", async () => {
  const migration = "20261022193343_operator_direct_payment_audit.sql";
  const originalDb = db;
  const originalActor = actorId;
  const upgradeCluster = await createNativePaymentPostgres();
  try {
    db = await upgradeCluster.connect();
    await installApplicationRebuild(db, { beforeMigration: migration });
    const f = await seed();
    const request = {
      protocolVersion: "1.0",
      connectorVersion: "0.5.0",
      requestId: randomUUID(),
      actionName: "record_daily_payment",
      scope: "business_data",
      exceptionalBusinessCase: false,
      inputSource: "excel_screenshot",
      originalInstruction: "Existing synthetic web payment draft",
      input: { bookingId: f.booking, amountXof: 10000, paymentDate: f.today },
    };
    const snapshot = await rpc("daily_booking_operation_snapshot", { p_booking_id: f.booking });
    expect(snapshot.error).toBeNull();
    const draft = await rpc("create_operator_payment_confirmation", {
      p_request: request,
      p_snapshot: snapshot.data,
      p_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
    expect(draft.error).toBeNull();
    const before = (
      await owner("select to_jsonb(b) fact from daily_bookings b where id=$1", [f.booking])
    ).rows[0].fact;
    const grantQuery = `select n.nspname,p.proname,p.proacl::text,p.prosecdef,p.proconfig
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and p.proname in ('create_operator_payment_confirmation','confirm_operator_payment','reprepare_operator_payment_confirmation')
      order by n.nspname,p.proname`;
    const beforeGrants = (await owner(grantQuery)).rows;
    await owner(readFileSync(`supabase/migrations/${migration}`, "utf8"));
    expect((await owner(grantQuery)).rows).toEqual(beforeGrants);
    expect(
      (await owner("select to_jsonb(b) fact from daily_bookings b where id=$1", [f.booking]))
        .rows[0].fact,
    ).toEqual(before);
    const result = await rpc("confirm_operator_payment", {
      p_id: (draft.data as { id: string }).id,
    });
    expect(result.error).toBeNull();
    const audit = (
      await owner(
        "select actor_id,metadata from audit_logs where entity_id=$1 and action='confirm_operator_payment'",
        [f.booking],
      )
    ).rows[0];
    expect(audit.actor_id).toBe(f.actor);
    expect(audit.metadata).toMatchObject({
      channel: "sacsi_web",
      confirmation_method: "authenticated_account_confirmation",
    });
    expect(await countPayments(f.booking)).toBe(1);
    const protocolGrants = (
      await owner(`select public.operator_direct_payment_protocol_version() version,
      has_function_privilege('authenticated','public.operator_direct_payment_protocol_version()','execute') authenticated,
      has_function_privilege('anon','public.operator_direct_payment_protocol_version()','execute') anon,
      has_function_privilege('service_role','public.operator_direct_payment_protocol_version()','execute') service`)
    ).rows[0];
    expect(protocolGrants).toEqual({
      version: 1,
      authenticated: true,
      anon: false,
      service: false,
    });
  } finally {
    db = originalDb;
    actorId = originalActor;
    await upgradeCluster.close();
  }
}, 45000);
