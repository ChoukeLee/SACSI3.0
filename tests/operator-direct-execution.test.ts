import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  previewActor,
  previewBooking,
  previewRequest,
  previewSecret,
  previewSnapshot,
} from "./fixtures/operator-preview";

const { rpc, authenticate, duplicateCheck } = vi.hoisted(() => ({
  rpc: vi.fn(),
  authenticate: vi.fn(),
  duplicateCheck: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/features/business-actions/operator-request-auth", () => ({
  authenticateOperatorRequest: authenticate,
}));
vi.mock("@/features/business-actions/collection-duplicate-check", () => ({
  checkCollectionReceipts: duplicateCheck,
}));
import {
  executeOperatorDirect,
  type DirectExecutionWorkflow,
} from "@/features/business-actions/operator-direct-execution";
import { issuePreviewProof } from "@/features/business-actions/operator-preview-proof";
import { confirmationDeployment } from "@/features/business-actions/operator-confirmation-http";
import { buildPaymentPreview } from "@/features/business-actions/operator-payment-preview";

const requestId = "77777777-7777-4777-8777-777777777777";
const confirmationId = "88888888-8888-4888-8888-888888888888";
const otherActor = "22222222-2222-4222-8222-222222222222";
const kinds: DirectExecutionWorkflow[] = [
  "daily_payment",
  "collection",
  "daily_workflow",
  "booking_operation",
];
const snapshots = {
  daily_payment: previewSnapshot(),
  collection: [{ lineId: "1", snapshot: "synthetic collection" }],
  daily_workflow: { plan: { totalAfter: 50000 }, snapshot: "synthetic workflow" },
  booking_operation: { plan: { operation: "refund" }, snapshot: "synthetic refund" },
};
function input(kind: DirectExecutionWorkflow): Record<string, unknown> {
  if (kind === "daily_payment") return { ...previewRequest(), connectorVersion: "0.6.0" };
  if (kind === "collection")
    return {
      requestId,
      protocolVersion: "1.0",
      connectorVersion: "0.6.0",
      originalInstruction: "明确指令：登记合成收款",
      totalXof: 10000,
      rows: [
        {
          lineId: "1",
          sourceText: "合成凭证数据",
          domain: "daily",
          targetId: previewBooking,
          totalXof: 10000,
          paymentDate: "2026-10-22",
          paymentMethod: "bank_transfer",
          allocations: [{ receivableId: "99999999-9999-4999-8999-999999999999", amountXof: 10000 }],
        },
      ],
    };
  if (kind === "daily_workflow")
    return {
      requestId,
      originalInstruction: "明确指令：合成续住及收款",
      bookingId: previewBooking,
      operation: "extend_and_collect",
      effectiveCheckOut: "2026-10-28",
      amountXof: 10000,
      paymentDate: "2026-10-22",
      paymentMethod: "bank_transfer",
    };
  return {
    requestId,
    originalInstruction: "明确指令：登记已实际发生的合成退款",
    bookingId: previewBooking,
    operation: "refund",
    amountXof: 10000,
    finalAmountXof: 20000,
    paymentDate: "2026-10-22",
    paymentMethod: "bank_transfer",
    reason: "合成测试实际退款原因",
  };
}
function normalized(kind: DirectExecutionWorkflow) {
  const value = input(kind);
  if (kind !== "daily_payment") return value;
  const result = buildPaymentPreview(
    value as ReturnType<typeof previewRequest>,
    snapshots.daily_payment,
  );
  if (!result.success) throw new Error(result.code);
  return result.normalizedRequest;
}
function paymentEvidence() {
  return {
    verified: true,
    evidenceVersion: 2,
    checks: { payment: true, bookingFinance: true, receivables: true, ledger: true, audit: true },
    payment: {
      id: "payment",
      source_type: "daily_booking",
      source_id: previewBooking,
      request_kind: "daily_payment",
      request_id: requestId,
      amount: 10000,
      payment_date: "2026-09-15",
      receipt_no: "TEST",
      currency: "XOF",
      exchange_rate_to_xof: 1,
    },
    booking: { id: previewBooking, prepaidAmountXof: 20000, finalAmountXof: 30000 },
    audit: { id: "audit", actorId: previewActor, action: "supplementary_payment" },
    receivables: [{ id: "receivable", amountXof: 30000, paidAmountXof: 20000, status: "partial" }],
  };
}
function result(kind: DirectExecutionWorkflow) {
  return {
    status: "completed",
    requestId,
    ...(kind === "daily_payment" ? { verification: paymentEvidence() } : { verified: true }),
    ...(kind === "collection" ? { totalXof: 10000 } : {}),
    ...(kind === "daily_workflow"
      ? { amountXof: 10000, bookingId: previewBooking, operation: "extend_and_collect" }
      : {}),
    ...(kind === "booking_operation" ? { operation: "refund", bookingId: previewBooking } : {}),
  };
}
function proof(kind: DirectExecutionWorkflow, actorId = previewActor, issued = Date.now()) {
  return issuePreviewProof(
    {
      actorId,
      request: normalized(kind),
      snapshot: snapshots[kind],
      deployment: confirmationDeployment(),
    },
    previewSecret,
    issued,
  ).previewProof;
}
function request(kind: DirectExecutionWorkflow, envelope: Record<string, unknown> = {}) {
  return new Request("https://test.invalid/api/operator/v1/direct", {
    method: "POST",
    headers: { authorization: "Bearer synthetic-session", "content-type": "application/json" },
    body: JSON.stringify({ request: input(kind), previewProof: proof(kind), ...envelope }),
  });
}
function writes() {
  return rpc.mock.calls.filter(
    ([name, args]) =>
      /^(create_|reprepare_|confirm_)/.test(name) ||
      (name === "operator_booking_operation" && ["create", "confirm"].includes(args?.p_mode)),
  );
}
async function defaultRpc(name: string, args?: Record<string, unknown>) {
  if (name === "operator_daily_payment_protocol_version") return { data: 2, error: null };
  if (name.endsWith("protocol_version")) return { data: 1, error: null };
  if (name === "can_execute_operator_action") return { data: true, error: null };
  if (
    name.startsWith("find_") ||
    (name === "operator_booking_operation" && args?.p_mode === "status")
  )
    return { data: { status: "not_found" }, error: null };
  if (name === "daily_booking_operation_snapshot")
    return { data: snapshots.daily_payment, error: null };
  if (name === "preview_operator_collection") return { data: snapshots.collection, error: null };
  if (name === "preview_daily_workflow") return { data: snapshots.daily_workflow, error: null };
  if (name === "operator_booking_operation" && args?.p_mode === "preview")
    return { data: snapshots.booking_operation, error: null };
  if (
    name.startsWith("create_") ||
    name.startsWith("reprepare_") ||
    (name === "operator_booking_operation" && args?.p_mode === "create")
  )
    return { data: { id: confirmationId, status: "pending" }, error: null };
  const kind =
    name === "confirm_operator_payment"
      ? "daily_payment"
      : name === "confirm_operator_collection"
        ? "collection"
        : name === "confirm_daily_workflow"
          ? "daily_workflow"
          : name === "operator_booking_operation" && args?.p_mode === "confirm"
            ? "booking_operation"
            : null;
  if (kind) return { data: result(kind), error: null };
  throw new Error(`Unexpected synthetic RPC ${name}`);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SACSI_OPERATOR_CONFIRMATIONS_ENABLED", "true");
  vi.stubEnv("SACSI_OPERATOR_DIRECT_EXECUTION_ENABLED", "true");
  vi.stubEnv("SACSI_OPERATOR_PREVIEW_SECRET", previewSecret);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "synthetic-release");
  authenticate.mockResolvedValue({
    authenticated: true,
    mode: "bearer",
    user: { id: previewActor, role: "admin" },
    supabase: { rpc },
  });
  duplicateCheck.mockResolvedValue(undefined);
  rpc.mockImplementation(defaultRpc);
});
afterEach(() => vi.unstubAllEnvs());

describe("controlled connector direct execution", () => {
  it.each(kinds)(
    "executes %s with matching signed live preview, existing atomic writer and verified result",
    async (kind) => {
      const response = await executeOperatorDirect(request(kind), kind);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: "completed",
        requestId,
        verified: true,
        executionMode: "explicit_instruction",
      });
      expect(writes()).toHaveLength(2);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      if (kind === "daily_payment") {
        expect(writes()[0][1].p_request).toMatchObject({
          executionChannel: "external_codex",
          executionAuthorization: "explicit_instruction",
        });
        expect(writes()[0][1].p_request).not.toHaveProperty("actorId");
      }
      if (kind === "collection") expect(duplicateCheck).toHaveBeenCalledOnce();
    },
  );
  it("keeps refund execution under the existing operation writer rather than a generic SQL tool", async () => {
    const response = await executeOperatorDirect(request("booking_operation"), "booking_operation");
    expect(await response.json()).toMatchObject({
      operation: "refund",
      amountXof: 10000,
      verified: true,
    });
    expect(writes()[0][1].p_request).toMatchObject({
      operation: "refund",
      reason: "合成测试实际退款原因",
    });
    expect(writes()[1][1]).toEqual({
      p_id: confirmationId,
      p_mode: "confirm",
      p_deployment: confirmationDeployment(),
    });
  });
  it.each(kinds)(
    "rejects %s before auth/write when the deployment has not enabled direct execution",
    async (kind) => {
      vi.stubEnv("SACSI_OPERATOR_DIRECT_EXECUTION_ENABLED", "false");
      expect((await executeOperatorDirect(request(kind), kind)).status).toBe(503);
      expect(authenticate).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it.each(kinds)(
    "does not turn cookie-based %s fallback requests into connector authority",
    async (kind) => {
      authenticate.mockResolvedValue({
        authenticated: true,
        mode: "cookie",
        user: { id: previewActor },
        supabase: { rpc },
      });
      expect((await executeOperatorDirect(request(kind), kind)).status).toBe(403);
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it("preserves authentication failures without a write or identity fallback", async () => {
    authenticate.mockResolvedValue({ authenticated: false, reason: "missing_or_invalid_session" });
    expect((await executeOperatorDirect(request("collection"), "collection")).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(kinds)("rejects model-generated human approval flags on %s", async (kind) => {
    expect(
      (await executeOperatorDirect(request(kind, { humanConfirmed: true }), kind)).status,
    ).toBe(400);
    expect(writes()).toHaveLength(0);
  });
  it.each(kinds)("stops %s for another actor's proof without creating a draft", async (kind) => {
    const response = await executeOperatorDirect(
      request(kind, { previewProof: proof(kind, otherActor) }),
      kind,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "preview_changed", requestId });
    expect(writes()).toHaveLength(0);
  });
  it.each(kinds)("stops %s for an expired proof", async (kind) => {
    const response = await executeOperatorDirect(
      request(kind, { previewProof: proof(kind, previewActor, Date.now() - 11 * 60 * 1000) }),
      kind,
    );
    expect(await response.json()).toMatchObject({ code: "preview_expired", requestId });
    expect(writes()).toHaveLength(0);
  });
  it.each(kinds)("does not re-preview and accept a tampered %s proof", async (kind) => {
    const response = await executeOperatorDirect(
      request(kind, { previewProof: proof(kind) + "x" }),
      kind,
    );
    expect(await response.json()).toMatchObject({ code: "invalid_preview_proof", requestId });
    expect(writes()).toHaveLength(0);
  });
  it.each(kinds)(
    "rejects a changed live %s snapshot instead of silently accepting the new state",
    async (kind) => {
      rpc.mockImplementation(async (name, args) => {
        const response = await defaultRpc(name, args);
        const isSnapshot =
          name === "daily_booking_operation_snapshot" ||
          name === "preview_operator_collection" ||
          name === "preview_daily_workflow" ||
          (name === "operator_booking_operation" && args?.p_mode === "preview");
        if (!isSnapshot) return response;
        const current = structuredClone(response.data);
        return {
          data: Array.isArray(current)
            ? current.map((row) => ({ ...row, changed: true }))
            : { ...(current as Record<string, unknown>), changed: true },
          error: null,
        };
      });
      expect(await (await executeOperatorDirect(request(kind), kind)).json()).toMatchObject({
        code: "preview_changed",
        requestId,
      });
      expect(writes()).toHaveLength(0);
    },
  );
  it.each(kinds)(
    "reports unknown outcome and retains the original request when %s loses its commit response",
    async (kind) => {
      rpc.mockImplementation(async (name, args) => {
        if (
          name.startsWith("confirm_") ||
          (name === "operator_booking_operation" && args?.p_mode === "confirm")
        )
          throw new Error("synthetic connection loss; SECRET must not escape");
        return defaultRpc(name, args);
      });
      const response = await executeOperatorDirect(request(kind), kind);
      const body = await response.json();
      expect(response.status).toBe(503);
      expect(body).toMatchObject({
        status: "execution_unknown",
        requestId,
        verified: false,
        retryPolicy: "recheck_same_request_id_only",
      });
      expect(JSON.stringify(body)).not.toContain("SECRET");
      expect(writes()).toHaveLength(2);
    },
  );
  it.each(kinds)(
    "refuses to claim %s success when the committed result belongs to a different request",
    async (kind) => {
      rpc.mockImplementation(async (name, args) => {
        const reply = await defaultRpc(name, args);
        if (
          name.startsWith("confirm_") ||
          (name === "operator_booking_operation" && args?.p_mode === "confirm")
        )
          return { data: { ...result(kind), requestId: otherActor }, error: null };
        return reply;
      });
      expect(await (await executeOperatorDirect(request(kind), kind)).json()).toMatchObject({
        status: "execution_unknown",
        verified: false,
        requestId,
      });
    },
  );
  it.each(kinds)(
    "recovers a completed %s using the same ID without claiming fresh verification or replaying",
    async (kind) => {
      rpc.mockImplementation(async (name, args) => {
        if (
          name.startsWith("find_") ||
          (name === "operator_booking_operation" && args?.p_mode === "status")
        )
          return { data: { status: "completed", id: confirmationId, requestId }, error: null };
        if (
          name.startsWith("get_") ||
          (name === "operator_booking_operation" && args?.p_mode === "get")
        )
          return {
            data:
              kind === "daily_payment"
                ? {
                    actorId: previewActor,
                    request: {
                      ...normalized(kind),
                      confirmationDeployment: "old",
                      executionChannel: "external_codex",
                      executionAuthorization: "explicit_instruction",
                    },
                  }
                : { actor_id: previewActor, request_data: normalized(kind) },
            error: null,
          };
        return defaultRpc(name, args);
      });
      const response = await executeOperatorDirect(request(kind), kind);
      expect(await response.json()).toMatchObject({
        status: "completed_previously",
        requestId,
        verified: false,
      });
      expect(writes()).toHaveLength(0);
    },
  );
  it("rejects reuse of a completed request ID for a different amount", async () => {
    rpc.mockImplementation(async (name, args) => {
      if (name === "find_operator_collection")
        return { data: { status: "completed", id: confirmationId }, error: null };
      if (name === "get_operator_collection")
        return {
          data: {
            actor_id: previewActor,
            request_data: { ...input("collection"), totalXof: 20000 },
          },
          error: null,
        };
      return defaultRpc(name, args);
    });
    expect(
      await (await executeOperatorDirect(request("collection"), "collection")).json(),
    ).toMatchObject({ code: "direct_request_conflict", requestId });
    expect(writes()).toHaveLength(0);
  });
  it("blocks a live collection conflict rather than creating or committing partial rows", async () => {
    rpc.mockImplementation(async (name, args) =>
      name === "preview_operator_collection"
        ? { data: null, error: { message: "collectionAmountConflict" } }
        : defaultRpc(name, args),
    );
    expect((await executeOperatorDirect(request("collection"), "collection")).status).toBe(409);
    expect(writes()).toHaveLength(0);
  });
  it("blocks duplicate receipt uncertainty before either write RPC", async () => {
    duplicateCheck.mockRejectedValue(new Error("collectionDuplicateCheckUnavailable"));
    const response = await executeOperatorDirect(request("collection"), "collection");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "collectionDuplicateCheckUnavailable" });
    expect(writes()).toHaveLength(0);
  });
  it("blocks payment direct execution before write when its audit migration is missing", async () => {
    rpc.mockImplementation(async (name, args) =>
      name === "operator_direct_payment_protocol_version"
        ? { data: null, error: null }
        : defaultRpc(name, args),
    );
    expect(
      await (await executeOperatorDirect(request("daily_payment"), "daily_payment")).json(),
    ).toMatchObject({ code: "direct_database_upgrade_required" });
    expect(writes()).toHaveLength(0);
  });
  it("rejects a payment result whose audit actor does not match the authenticated operator", async () => {
    rpc.mockImplementation(async (name, args) =>
      name === "confirm_operator_payment"
        ? {
            data: {
              ...result("daily_payment"),
              verification: {
                ...paymentEvidence(),
                audit: { id: "audit", actorId: otherActor, action: "supplementary_payment" },
              },
            },
            error: null,
          }
        : defaultRpc(name, args),
    );
    expect(
      await (await executeOperatorDirect(request("daily_payment"), "daily_payment")).json(),
    ).toMatchObject({ status: "execution_unknown", verified: false, requestId });
  });
});
