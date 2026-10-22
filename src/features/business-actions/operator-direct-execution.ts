import "server-only";

import { isDeepStrictEqual } from "node:util";
import { authenticateOperatorRequest } from "./operator-request-auth";
import { operatorAuthFailure } from "./operator-auth-failure";
import {
  parseOperatorActionRequest,
  parseRecordDailyPaymentInput,
  validateOperatorCompatibility,
  type OperatorActionRequest,
} from "./operator-action-contract";
import { batchUuid, parseCollectionRequest } from "./operator-batch";
import { parseDailyChangeRequest } from "./operator-daily-plan";
import { isBookingOperation } from "./booking-operation-contract";
import { buildPaymentPreview } from "./operator-payment-preview";
import { verifyOperatorPaymentEvidence } from "./operator-payment-verification";
import { checkCollectionReceipts } from "./collection-duplicate-check";
import { validPreviewSecret, verifyPreviewProof } from "./operator-preview-proof";
import {
  confirmationDeployment,
  confirmationsEnabled,
  confirmationReply as reply,
} from "./operator-confirmation-http";

export type DirectExecutionWorkflow =
  "daily_payment" | "collection" | "daily_workflow" | "booking_operation";

type ObjectValue = Record<string, unknown>;
type OperatorAuth = Extract<
  Awaited<ReturnType<typeof authenticateOperatorRequest>>,
  { authenticated: true }
>;

/** A deployment policy, never an AI-supplied assertion of human approval. */
export function directExecutionEnabled(): boolean {
  return confirmationsEnabled() && process.env.SACSI_OPERATOR_DIRECT_EXECUTION_ENABLED === "true";
}

class DirectFailure extends Error {
  constructor(
    readonly code: string,
    readonly status: number = 409,
  ) {
    super(code);
  }
}

function object(value: unknown): value is ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value: ObjectValue, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function databaseFailure(error: { message?: string }) {
  const code = error.message?.match(
    /\b(?:operation[A-Za-z]+|workflow[A-Za-z]+|collection[A-Za-z]+|confirmation[A-Za-z]+|invalidCollection[A-Za-z]+|invalidConfirmationRequest|duplicateCollection[A-Za-z]+|bookingNotFound|bookingFinanceInconsistent|dailyWritePermissionDenied|paymentExceedsOutstanding)\b/,
  )?.[0];
  return new DirectFailure(
    code ?? "direct_execution_unavailable",
    code?.endsWith("Forbidden") || code === "dailyWritePermissionDenied"
      ? 403
      : code && /Unavailable|ResultInvalid|VerificationFailed|ResultChanged/.test(code)
        ? 503
        : code
          ? 409
          : 503,
  );
}

async function rpc(auth: OperatorAuth, name: string, args?: ObjectValue): Promise<unknown> {
  const result = await auth.supabase.rpc(name, args);
  if (result.error) throw databaseFailure(result.error);
  return result.data;
}

function parseInput(workflow: DirectExecutionWorkflow, value: unknown): ObjectValue {
  if (!object(value) || !batchUuid(value.requestId))
    throw new DirectFailure("invalid_request_id", 400);
  if (workflow === "daily_payment") {
    if (
      !onlyKeys(value, [
        "protocolVersion",
        "connectorVersion",
        "requestId",
        "actionName",
        "inputSource",
        "scope",
        "exceptionalBusinessCase",
        "originalInstruction",
        "input",
      ]) ||
      !object(value.input) ||
      !onlyKeys(value.input, ["bookingId", "amountXof", "paymentDate", "receiptNo"])
    )
      throw new DirectFailure("invalid_direct_request", 400);
    const parsed = parseOperatorActionRequest(value);
    if (!parsed.success) throw new DirectFailure(parsed.code, 400);
    const compatible = validateOperatorCompatibility(parsed.data);
    if (!compatible.success) throw new DirectFailure(compatible.code, 409);
    if (
      parsed.data.actionName !== "record_daily_payment" ||
      !["natural_language", "excel_screenshot"].includes(parsed.data.inputSource) ||
      parsed.data.scope !== "business_data" ||
      parsed.data.exceptionalBusinessCase
    )
      throw new DirectFailure("direct_scope_not_supported", 422);
    const input = parseRecordDailyPaymentInput(parsed.data.input);
    if (!input.success) throw new DirectFailure(input.code, 400);
    return { ...parsed.data, input: input.data };
  }
  if (workflow === "collection") {
    try {
      return { ...parseCollectionRequest(value) };
    } catch {
      throw new DirectFailure("invalidCollectionRequest", 400);
    }
  }
  if (workflow === "daily_workflow") {
    const { requestId, ...fields } = value;
    let parsed;
    try {
      parsed = parseDailyChangeRequest(fields);
    } catch {
      throw new DirectFailure("workflowInvalidRequest", 400);
    }
    if (
      !parsed.effectiveCheckOut ||
      parsed.amountXof === undefined ||
      !parsed.paymentDate ||
      !parsed.paymentMethod
    )
      throw new DirectFailure("workflowInvalidRequest", 400);
    return { ...parsed, requestId };
  }
  if (
    !isBookingOperation(value.operation) ||
    typeof value.originalInstruction !== "string" ||
    !value.originalInstruction.trim() ||
    value.originalInstruction.length > 4000 ||
    !onlyKeys(value, [
      "requestId",
      "operation",
      "originalInstruction",
      "unitId",
      "bookingId",
      "bookingAgentId",
      "guestName",
      "checkIn",
      "checkOut",
      "nightlyPriceXof",
      "targetUnitId",
      "paymentId",
      "reason",
      "amountXof",
      "finalAmountXof",
      "paymentDate",
      "paymentMethod",
    ])
  )
    throw new DirectFailure("operationInvalidRequest", 400);
  // The existing locked database preview validates each operation's complete
  // vocabulary, mandatory facts, permissions, dates and financial state.
  return value;
}

async function checkReadiness(auth: OperatorAuth, workflow: DirectExecutionWorkflow) {
  const versions: Array<[string, number]> =
    workflow === "daily_payment"
      ? [
          ["operator_daily_payment_protocol_version", 2],
          ["operator_direct_payment_protocol_version", 1],
        ]
      : [
          [
            workflow === "collection"
              ? "operator_collection_protocol_version"
              : workflow === "daily_workflow"
                ? "daily_workflow_protocol_version"
                : "booking_operations_protocol_version",
            1,
          ],
        ];
  for (const [name, expected] of versions) {
    if ((await rpc(auth, name)) !== expected)
      throw new DirectFailure("direct_database_upgrade_required", 503);
  }
  if (workflow === "daily_payment") {
    if (
      (await rpc(auth, "can_execute_operator_action", {
        p_action_name: "record_daily_payment",
        p_risk_level: "L2",
      })) !== true
    )
      throw new DirectFailure("action_forbidden", 403);
  }
}

async function findExisting(
  auth: OperatorAuth,
  workflow: DirectExecutionWorkflow,
  requestId: string,
) {
  const data =
    workflow === "booking_operation"
      ? await rpc(auth, "operator_booking_operation", {
          p_mode: "status",
          p_request: { requestId },
        })
      : await rpc(
          auth,
          workflow === "daily_payment"
            ? "find_operator_payment_confirmation"
            : workflow === "collection"
              ? "find_operator_collection"
              : "find_daily_workflow",
          { p_request_id: requestId },
        );
  if (!object(data)) throw new DirectFailure("direct_status_unavailable", 503);
  return data;
}

async function readExisting(auth: OperatorAuth, workflow: DirectExecutionWorkflow, id: string) {
  const data =
    workflow === "booking_operation"
      ? await rpc(auth, "operator_booking_operation", { p_mode: "get", p_id: id })
      : await rpc(
          auth,
          workflow === "daily_payment"
            ? "get_operator_payment_confirmation"
            : workflow === "collection"
              ? "get_operator_collection"
              : "get_daily_workflow",
          { p_id: id },
        );
  if (!object(data)) throw new DirectFailure("direct_status_unavailable", 503);
  return data;
}

function storedRequest(data: ObjectValue, workflow: DirectExecutionWorkflow) {
  const original = workflow === "daily_payment" ? data.request : data.request_data;
  if (!object(original)) return null;
  if (workflow !== "daily_payment") return original;
  const { confirmationDeployment, executionChannel, executionAuthorization, ...request } = original;
  void confirmationDeployment;
  void executionChannel;
  void executionAuthorization;
  return request;
}

async function livePreview(
  auth: OperatorAuth,
  workflow: DirectExecutionWorkflow,
  input: ObjectValue,
) {
  if (workflow === "daily_payment") {
    const snapshot = await rpc(auth, "daily_booking_operation_snapshot", {
      p_booking_id: (input.input as ObjectValue).bookingId,
    });
    const preview = buildPaymentPreview(input as unknown as OperatorActionRequest, snapshot);
    if (!preview.success) throw new DirectFailure(preview.code, 409);
    return { snapshot, request: preview.normalizedRequest as unknown as ObjectValue };
  }
  const snapshot = await rpc(
    auth,
    workflow === "collection"
      ? "preview_operator_collection"
      : workflow === "daily_workflow"
        ? "preview_daily_workflow"
        : "operator_booking_operation",
    { ...(workflow === "booking_operation" ? { p_mode: "preview" } : {}), p_request: input },
  );
  if (workflow === "collection") {
    try {
      await checkCollectionReceipts(auth.supabase, parseCollectionRequest(input));
    } catch (error) {
      throw databaseFailure(error instanceof Error ? error : {});
    }
  }
  return { snapshot, request: input };
}

async function createDraft(
  auth: OperatorAuth,
  workflow: DirectExecutionWorkflow,
  input: ObjectValue,
  snapshot: unknown,
  expiresAt: string,
  deployment: string,
  replacesId?: string,
) {
  if (workflow === "daily_payment") {
    return rpc(
      auth,
      replacesId
        ? "reprepare_operator_payment_confirmation"
        : "create_operator_payment_confirmation",
      {
        ...(replacesId ? { p_previous_id: replacesId } : {}),
        p_request: {
          ...input,
          confirmationDeployment: deployment,
          executionChannel: "external_codex",
          executionAuthorization: "explicit_instruction",
        },
        p_snapshot: snapshot,
        p_expires_at: expiresAt,
      },
    );
  }
  return rpc(
    auth,
    workflow === "collection"
      ? "create_operator_collection"
      : workflow === "daily_workflow"
        ? "create_daily_workflow"
        : "operator_booking_operation",
    {
      ...(workflow === "booking_operation" ? { p_mode: "create" } : {}),
      p_request: input,
      p_snapshot: snapshot,
      p_expires_at: expiresAt,
      p_deployment: deployment,
      p_replaces_id: replacesId ?? null,
    },
  );
}

async function commit(auth: OperatorAuth, workflow: DirectExecutionWorkflow, id: string) {
  return rpc(
    auth,
    workflow === "daily_payment"
      ? "confirm_operator_payment"
      : workflow === "collection"
        ? "confirm_operator_collection"
        : workflow === "daily_workflow"
          ? "confirm_daily_workflow"
          : "operator_booking_operation",
    {
      p_id: id,
      ...(workflow === "booking_operation"
        ? { p_mode: "confirm", p_deployment: confirmationDeployment() }
        : {}),
    },
  );
}

function unknownOutcome(requestId: string) {
  return reply(
    {
      status: "execution_unknown",
      code: "direct_execution_outcome_unknown",
      verified: false,
      requestId,
      retryPolicy: "recheck_same_request_id_only",
      message: "执行结果暂未核实，请按原请求号查询；不要换号重录。",
    },
    503,
  );
}

/** Explicit connector delegation reuses the same authenticated, locked writers.
 * Preview integrity is not presented as proof that a human clicked a button.
 * Browser fallback endpoints retain their original cookie/CSRF protections.
 */
export async function executeOperatorDirect(request: Request, workflow: DirectExecutionWorkflow) {
  if (!directExecutionEnabled()) return reply({ code: "direct_execution_not_enabled" }, 503);
  const auth = await authenticateOperatorRequest(request);
  if (!auth.authenticated) {
    const failure = operatorAuthFailure(auth.reason);
    return reply(failure.body, failure.status);
  }
  if (auth.mode !== "bearer") return reply({ code: "connector_authentication_required" }, 403);
  let requestId: string | undefined;
  let commitAttempted = false;
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 65536)
      return reply({ code: "request_too_large" }, 413);
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 65536)
      return reply({ code: "request_too_large" }, 413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return reply({ code: "invalid_json" }, 400);
    }
    if (
      !object(body) ||
      !onlyKeys(body, ["request", "previewProof", "replacesConfirmationId"]) ||
      typeof body.previewProof !== "string" ||
      (body.replacesConfirmationId !== undefined && !batchUuid(body.replacesConfirmationId))
    )
      return reply({ code: "invalid_direct_request" }, 400);
    const input = parseInput(workflow, body.request);
    requestId = input.requestId as string;
    await checkReadiness(auth, workflow);
    const existing = await findExisting(auth, workflow, requestId);
    if (existing.status === "completed") {
      if (!batchUuid(existing.id)) throw new DirectFailure("direct_status_unavailable", 503);
      const original = await readExisting(auth, workflow, existing.id);
      const owner = workflow === "daily_payment" ? original.actorId : original.actor_id;
      if (owner !== auth.user.id) throw new DirectFailure("direct_request_forbidden", 403);
      if (!isDeepStrictEqual(storedRequest(original, workflow), input))
        throw new DirectFailure("direct_request_conflict", 409);
      return reply(
        {
          status: "completed_previously",
          verified: false,
          requestId,
          confirmationId: existing.id,
          executionMode: "explicit_instruction",
          message: "原请求已有完成记录，本次未新增操作；这不代表重新核验了现账。",
        },
        200,
      );
    }
    const secret = process.env.SACSI_OPERATOR_PREVIEW_SECRET;
    if (!validPreviewSecret(secret)) throw new DirectFailure("preview_signing_unavailable", 503);
    const live = await livePreview(auth, workflow, input);
    const deployment = confirmationDeployment();
    const checked = verifyPreviewProof(
      body.previewProof,
      { actorId: auth.user.id, request: live.request, snapshot: live.snapshot, deployment },
      secret,
    );
    if (!checked.valid) throw new DirectFailure(checked.code, 409);
    // Expiry is decoded only after HMAC, actor, request, live snapshot and
    // deployment validation. No fresh preview is silently accepted on conflict.
    const expiresAt = new Date(
      JSON.parse(Buffer.from(body.previewProof.split(".")[0], "base64url").toString()).expiresAt,
    ).toISOString();
    const draft = await createDraft(
      auth,
      workflow,
      live.request,
      live.snapshot,
      expiresAt,
      deployment,
      body.replacesConfirmationId as string | undefined,
    );
    if (!object(draft) || !batchUuid(draft.id))
      throw new DirectFailure("direct_draft_unavailable", 503);
    commitAttempted = true;
    const result = await commit(auth, workflow, draft.id);
    if (!object(result) || result.requestId !== requestId) return unknownOutcome(requestId);
    if (result.status === "completed_previously")
      return reply(
        { ...result, requestId, verified: false, executionMode: "explicit_instruction" },
        200,
      );
    if (result.status !== "completed") return unknownOutcome(requestId);
    if (workflow === "daily_payment") {
      const parsed = parseRecordDailyPaymentInput(live.request.input as ObjectValue);
      if (
        !parsed.success ||
        !verifyOperatorPaymentEvidence(result.verification, {
          ...parsed.data,
          requestId,
          actorId: auth.user.id,
        }).verified
      )
        return unknownOutcome(requestId);
    } else if (
      result.verified !== true ||
      (workflow === "collection" && result.totalXof !== input.totalXof) ||
      (workflow === "daily_workflow" &&
        (result.amountXof !== input.amountXof || result.bookingId !== input.bookingId)) ||
      (workflow === "booking_operation" &&
        (result.operation !== input.operation ||
          (input.bookingId !== undefined && result.bookingId !== input.bookingId)))
    )
      return unknownOutcome(requestId);
    return reply(
      {
        ...result,
        verified: true,
        requestId,
        executionMode: "explicit_instruction",
        ...(input.amountXof !== undefined ? { amountXof: input.amountXof } : {}),
      },
      200,
    );
  } catch (error) {
    if (commitAttempted && requestId && !(error instanceof DirectFailure && error.status < 500))
      return unknownOutcome(requestId);
    const failure =
      error instanceof DirectFailure
        ? error
        : new DirectFailure("direct_execution_unavailable", 503);
    return reply(
      {
        code: failure.code,
        ...(requestId ? { requestId, retryPolicy: "recheck_same_request_id_only" } : {}),
        verified: false,
      },
      failure.status,
    );
  }
}
