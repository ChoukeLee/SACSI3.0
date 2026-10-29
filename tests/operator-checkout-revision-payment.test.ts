import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { previewActor, previewBooking, previewSecret } from "./fixtures/operator-preview";
const { rpc, authenticate } = vi.hoisted(() => ({ rpc: vi.fn(), authenticate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/business-actions/operator-request-auth", () => ({
  authenticateOperatorRequest: authenticate,
}));
import { GET } from "@/app/api/operator/v1/capabilities/route";
import { executeOperatorDirect } from "@/features/business-actions/operator-direct-execution";
import { issuePreviewProof } from "@/features/business-actions/operator-preview-proof";
import { confirmationDeployment } from "@/features/business-actions/operator-confirmation-http";
// @ts-expect-error The standalone connector intentionally has no application TS dependency.
import { OperatorClient } from "../operator-connector/core.mjs";
// @ts-expect-error The standalone connector intentionally has no application TS dependency.
import { tools as connectorTools } from "../operator-connector/mcp-tools.mjs";

const input = {
  requestId: "77777777-7777-4777-8777-777777777777",
  operation: "revise_checkout_and_collect",
  bookingId: previewBooking,
  correctsRequestId: "66666666-6666-4666-8666-666666666666",
  actualCheckOut: "2026-10-19",
  amountXof: 40000,
  paymentDate: "2026-10-29",
  paymentMethod: "cash",
  inputSource: "excel_screenshot",
  reason: "用户修订为两晚，后续又收到四万，原四万保留",
  originalInstruction: "截图定位后，用户补充实际两晚，后面又收了四万。",
};
const snapshot = {
  snapshot: { synthetic: true },
  plan: {
    operation: input.operation,
    correctsRequestId: input.correctsRequestId,
    totalAfter: 80000,
    paidAfter: 80000,
    outstandingAfter: 0,
  },
};
let revisionInstalled = true,
  baseInstalled = true,
  correctionAllowed = true,
  paymentAllowed = true;
let role = "admin";
beforeEach(() => {
  vi.resetAllMocks();
  revisionInstalled = baseInstalled = correctionAllowed = paymentAllowed = true;
  role = "admin";
  vi.stubEnv("SACSI_OPERATOR_CONFIRMATIONS_ENABLED", "true");
  vi.stubEnv("SACSI_OPERATOR_DIRECT_EXECUTION_ENABLED", "true");
  vi.stubEnv("SACSI_OPERATOR_PREVIEW_SECRET", previewSecret);
  authenticate.mockImplementation(async () => ({
    authenticated: true,
    mode: "bearer",
    user: { id: previewActor, displayName: "Synthetic", role },
    supabase: { rpc },
  }));
  rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
    if (name === "booking_checkout_revision_payment_protocol_version")
      return revisionInstalled ? { data: 1 } : { error: { message: "missing" } };
    if (name === "booking_checkout_correction_protocol_version")
      return { data: baseInstalled ? 1 : 0 };
    if (name === "get_my_operator_capabilities")
      return {
        data: [
          {
            action_name: "correct_daily_booking",
            authorized: correctionAllowed,
            authorization_source: correctionAllowed ? "role" : "none",
          },
          {
            action_name: "record_daily_payment",
            authorized: paymentAllowed,
            authorization_source: paymentAllowed ? "role" : "none",
          },
        ],
      };
    if (name.endsWith("protocol_version"))
      return { data: name === "operator_daily_payment_protocol_version" ? 2 : 1 };
    if (name === "operator_booking_operation") {
      if (args?.p_mode === "status") return { data: { status: "not_found" } };
      if (args?.p_mode === "preview") return { data: snapshot };
      if (args?.p_mode === "create")
        return { data: { id: "88888888-8888-4888-8888-888888888888" } };
      if (args?.p_mode === "confirm")
        return {
          data: {
            status: "completed",
            verified: true,
            requestId: input.requestId,
            bookingId: previewBooking,
            operation: input.operation,
            amountXof: input.amountXof,
          },
        };
    }
    return { data: false };
  });
});
afterEach(() => vi.unstubAllEnvs());
function writes() {
  return rpc.mock.calls.filter(
    ([name, args]) =>
      name === "operator_booking_operation" && ["create", "confirm"].includes(args?.p_mode),
  );
}
function direct(request: Record<string, unknown> = input, actorId = previewActor) {
  const proof = issuePreviewProof(
    { actorId, request: input, snapshot, deployment: confirmationDeployment() },
    previewSecret,
  ).previewProof;
  return executeOperatorDirect(
    new Request("https://test.invalid/api/operator/v1/booking-operations/execute", {
      method: "POST",
      headers: { authorization: "Bearer synthetic", "content-type": "application/json" },
      body: JSON.stringify({ request, previewProof: proof }),
    }),
    "booking_operation",
  );
}
it.each([
  "missing_protocol",
  "disabled_base",
  "no_correction_grant",
  "no_payment_grant",
  "not_admin",
  "ready",
])(
  "advertises the revision/payment capability only with both live grants and protocols: %s",
  async (scenario) => {
    if (scenario === "missing_protocol") revisionInstalled = false;
    if (scenario === "disabled_base") baseInstalled = false;
    if (scenario === "no_correction_grant") correctionAllowed = false;
    if (scenario === "no_payment_grant") paymentAllowed = false;
    if (scenario === "not_admin") role = "front_desk";
    const d = await (
      await GET(new Request("https://test.invalid/api/operator/v1/capabilities"))
    ).json();
    expect(d.bookingOperations.checkoutRevisionPayment.available).toBe(scenario === "ready");
    expect(d.bookingOperations.operations.includes(input.operation)).toBe(scenario === "ready");
  },
);
it("passes the bound completed-parent reference and payment through one atomic operation", async () => {
  const r = await direct();
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({
    status: "completed",
    verified: true,
    requestId: input.requestId,
  });
  expect(writes()).toHaveLength(2);
  expect(writes()[0][1].p_request).toEqual(input);
});
it("fails closed on an older database before any write", async () => {
  revisionInstalled = false;
  expect((await direct()).status).toBe(503);
  expect(writes()).toEqual([]);
});
it.each(["parent", "amount", "method", "source"])("rejects signed %s tampering", async (field) => {
  const changed =
    field === "parent"
      ? { correctsRequestId: "99999999-9999-4999-8999-999999999999" }
      : field === "amount"
        ? { amountXof: 10000 }
        : field === "method"
          ? { paymentMethod: "bank_transfer" }
          : { inputSource: "natural_language" };
  expect((await direct({ ...input, ...changed })).status).toBe(409);
  expect(writes()).toEqual([]);
});

const config = {
  formatVersion: 1,
  localTest: true,
  appUrl: "http://127.0.0.1:3100",
  supabaseUrl: "http://127.0.0.1:54321",
  publishableKey: "sb_publishable_test",
};
const reply = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
function manifest(ready: boolean) {
  return {
    protocolVersion: "1.0",
    minimumConnectorVersion: "0.6.0",
    identity: { userId: "owner" },
    safeguards: {
      serviceRoleAllowed: false,
      arbitrarySqlAllowed: false,
      systemChangesAllowed: false,
      screenshotWritesRequireConfirmation: false,
      batchWritesRequireConfirmation: false,
    },
    directExecution: {
      available: true,
      version: 1,
      authorization: "explicit_instruction",
      workflows: ["booking_operation"],
    },
    actions: [],
    bookingOperations: {
      available: true,
      version: 1,
      operations: [input.operation],
      checkoutRevisionPayment: { available: ready, version: 1 },
    },
  };
}
function store() {
  return {
    load: async () => ({
      userId: "owner",
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      expiresAt: Date.now() + 3600000,
      appUrl: config.appUrl,
      supabaseUrl: config.supabaseUrl,
    }),
  };
}
it("requires the independent connector capability before preview or execution", async () => {
  const transport = vi.fn().mockResolvedValue(reply(manifest(false)));
  await expect(
    new OperatorClient(config, store(), transport).bookingOperation("execute", input),
  ).rejects.toThrow("checkout_revision_payment_upgrade_required");
  expect(transport).toHaveBeenCalledTimes(1);
});
it("retains parent, screenshot provenance and one payment under the same child request", async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(reply(manifest(true)))
    .mockResolvedValueOnce(reply({ status: "not_found" }))
    .mockResolvedValueOnce(reply({ previewProof: "signed-revision" }))
    .mockResolvedValueOnce(
      reply({
        status: "completed",
        verified: true,
        requestId: input.requestId,
        operation: input.operation,
        bookingId: previewBooking,
        amountXof: input.amountXof,
      }),
    );
  expect(
    await new OperatorClient(config, store(), transport).bookingOperation("execute", input),
  ).toMatchObject({ status: "completed", verified: true });
  expect(JSON.parse(transport.mock.calls[2][1].body)).toEqual(input);
  expect(JSON.parse(transport.mock.calls[3][1].body)).toEqual({
    request: input,
    previewProof: "signed-revision",
  });
  const schema = connectorTools.find(
    (t: { name: string }) => t.name === "execute_booking_operation",
  ).inputSchema;
  expect(schema.properties.operation.enum).toContain(input.operation);
  expect(schema.properties.correctsRequestId.pattern).toBeTruthy();
});
