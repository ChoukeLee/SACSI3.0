import { NextResponse } from "next/server";
import {
  parseOperatorActionRequest,
  parseQueryDailyBookingInput,
  parseRecordDailyPaymentInput,
  parseRenewLeaseInput,
  validateOperatorCompatibility,
} from "@/features/business-actions/operator-action-contract";
import { buildOperatorAssistanceReport } from "@/features/business-actions/operator-assistance-report";
import { decideOperatorExecution } from "@/features/business-actions/operator-execution-policy";
import { getBusinessActionDefinition } from "@/features/business-actions/registry";
import { authenticateOperatorRequest } from "@/features/business-actions/operator-request-auth";
import { operatorAuthFailure } from "@/features/business-actions/operator-auth-failure";
import { IMPLEMENTED_OPERATOR_ACTIONS } from "@/features/business-actions/operator-protocol";
import { verifyOperatorPaymentEvidence } from "@/features/business-actions/operator-payment-verification";

const MAX_BODY_BYTES = 64 * 1024;

function response(body: unknown, status: number, authMode?: "cookie" | "bearer") {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      ...(authMode ? { "X-SACSI-Auth-Mode": authMode } : {}),
    },
  });
}

function databaseErrorCode(message: string) {
  const known = [
    "bookingNotFound",
    "bookingNotPayable",
    "dailyReadPermissionDenied",
    "dailyWritePermissionDenied",
    "invalidPaymentAmount",
    "invalidPaymentDate",
    "invalidReceiptNo",
    "bookingFinanceInconsistent",
    "paymentIntegrityCheckFailed",
    "paymentAlreadyReversed",
    "paymentExceedsOutstanding",
    "requestIdConflict",
    "requestIdRequired",
  ];
  return known.find((code) => message.includes(code)) ?? "operator_action_failed";
}

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return response({ code: "request_too_large", error: "Request body is too large" }, 413);

  const auth = await authenticateOperatorRequest(request);
  if (!auth.authenticated) {
    const failure = operatorAuthFailure(auth.reason);
    return response(failure.body, failure.status);
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return response({ code: "invalid_request", error: "Unable to read request body" }, 400, auth.mode);
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return response({ code: "request_too_large", error: "Request body is too large" }, 413, auth.mode);
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return response({ code: "invalid_json", error: "Request body must be valid JSON" }, 400, auth.mode);
  }

  const parsed = parseOperatorActionRequest(json);
  if (!parsed.success) return response(parsed, 400, auth.mode);
  const actionRequest = parsed.data;

  const compatible = validateOperatorCompatibility(actionRequest);
  if (!compatible.success) return response(compatible, 409, auth.mode);

  const policy = decideOperatorExecution({
    actionName: actionRequest.actionName,
    inputSource: actionRequest.inputSource,
    scope: actionRequest.scope,
    exceptionalBusinessCase: actionRequest.exceptionalBusinessCase,
  });
  if (policy.decision === "block_and_report") {
    return response({
      status: "blocked",
      requestId: actionRequest.requestId,
      policy,
      assistanceReport: buildOperatorAssistanceReport({
        operatorName: auth.user.displayName,
        operatorUserId: auth.user.id,
        originalRequest: actionRequest.originalInstruction,
        reason: policy.reason,
        requestId: actionRequest.requestId,
        connectorVersion: actionRequest.connectorVersion,
      }),
    }, 422, auth.mode);
  }

  const definition = getBusinessActionDefinition(actionRequest.actionName);
  if (!definition || !IMPLEMENTED_OPERATOR_ACTIONS.has(actionRequest.actionName)) {
    return response({
      code: "action_not_implemented",
      error: "This protocol action is not implemented by the current server release",
      requestId: actionRequest.requestId,
    }, 501, auth.mode);
  }

  let authorized: unknown;
  try {
    const result = await auth.supabase.rpc("can_execute_operator_action", {
      p_action_name: definition.name,
      p_risk_level: definition.risk,
    });
    if (result.error) throw new Error("authorization unavailable");
    authorized = result.data;
  } catch {
    return response({ code: "authorization_unavailable", error: "Action authorization is unavailable" }, 503, auth.mode);
  }
  if (authorized !== true) {
    return response({ code: "action_forbidden", error: "This operator is not authorized for the action" }, 403, auth.mode);
  }

  if (policy.decision === "confirm") {
    return response({
      status: "confirmation_required",
      requestId: actionRequest.requestId,
      policy,
      preview: {
        actionName: actionRequest.actionName,
        inputSource: actionRequest.inputSource,
        input: actionRequest.input,
      },
    }, 202, auth.mode);
  }

  if (actionRequest.actionName === "query_daily_booking") {
    const input = parseQueryDailyBookingInput(actionRequest.input);
    if (!input.success) return response(input, 400, auth.mode);
    const { data, error } = await auth.supabase.rpc("operator_query_daily_booking", {
      p_booking_id: input.data.bookingId,
      p_building_code: input.data.buildingCode,
      p_unit_no: input.data.unitNo,
    });
    if (error) {
      const code = databaseErrorCode(error.message);
      return response({ code, error: "Daily booking query failed", requestId: actionRequest.requestId }, code.includes("PermissionDenied") ? 403 : 409, auth.mode);
    }
    return response({ status: "completed", requestId: actionRequest.requestId, actionName: actionRequest.actionName, result: data }, 200, auth.mode);
  }

  if (actionRequest.actionName === "renew_lease") {
    const input = parseRenewLeaseInput(actionRequest.input);
    if (!input.success) return response(input, 400, auth.mode);
    const actorEvidence = {
      channel: "external_codex",
      connector_version: actionRequest.connectorVersion,
      protocol_version: actionRequest.protocolVersion,
      input_source: actionRequest.inputSource,
      original_instruction: actionRequest.originalInstruction,
    };
    const { data, error } = await auth.supabase.rpc("renew_lease_rpc", {
      p_contract_id: input.data.contractId,
      p_new_end_date: input.data.newEndDate,
      p_request_id: actionRequest.requestId,
      p_actor: actorEvidence,
    });
    if (error) return response({ code: "leaseRenewalFailed", error: "Lease renewal was not recorded", requestId: actionRequest.requestId }, 409, auth.mode);
    return response({ status: "completed", requestId: actionRequest.requestId, actionName: actionRequest.actionName, result: data }, 200, auth.mode);
  }

  const input = parseRecordDailyPaymentInput(actionRequest.input);
  if (!input.success) return response(input, 400, auth.mode);
  // A missing/old migration must block BEFORE the first write, not after it.
  try {
    const version = await auth.supabase.rpc("operator_daily_payment_protocol_version");
    if (version.error || version.data !== 2) {
      return response({ code: "database_upgrade_required", requestId: actionRequest.requestId,
        error: "Payment database release is not ready; no write was attempted." }, 503, auth.mode);
    }
  } catch {
    return response({ code: "database_readiness_unavailable", requestId: actionRequest.requestId,
      error: "Cannot verify payment database readiness; no write was attempted." }, 503, auth.mode);
  }
  const actorEvidence = {
    channel: "external_codex",
    connector_version: actionRequest.connectorVersion,
    protocol_version: actionRequest.protocolVersion,
    input_source: actionRequest.inputSource,
    original_instruction: actionRequest.originalInstruction,
  };
  const unknownOutcome = () => response({ status: "execution_unknown", code: "payment_outcome_unknown",
    requestId: actionRequest.requestId, retryPolicy: "recheck_same_request_id_only",
    error: "The payment outcome is unknown. Recheck using the same requestId; never retry with a new requestId." }, 503, auth.mode);
  let writeResult;
  try {
    writeResult = await auth.supabase.rpc("daily_record_payment_rpc", {
      p_booking_id: input.data.bookingId,
      p_amount: input.data.amountXof,
      p_payment_date: input.data.paymentDate,
      p_receipt_no: input.data.receiptNo,
      p_request_id: actionRequest.requestId,
      p_actor: actorEvidence,
    });
  } catch {
    return unknownOutcome();
  }
  const { data: snapshot, error: writeError } = writeResult;
  if (writeError) {
    const code = databaseErrorCode(writeError.message);
    if (code === "operator_action_failed") return unknownOutcome();
    const status = code.includes("PermissionDenied") ? 403 : code === "bookingNotFound" ? 404 : 409;
    return response({ code, error: "This payment attempt was rejected. A previous attempt may already exist; retain the requestId.",
      requestId: actionRequest.requestId, retryPolicy: "recheck_same_request_id_only" }, status, auth.mode);
  }

  let verification: unknown = null;
  let verificationError = false;
  try {
    const result = await auth.supabase.rpc("verify_operator_daily_payment", {
      p_booking_id: input.data.bookingId,
      p_request_id: actionRequest.requestId,
    });
    verification = result.data;
    verificationError = Boolean(result.error);
  } catch {
    verificationError = true;
  }
  const evidenceCheck = verifyOperatorPaymentEvidence(verification, {
    ...input.data,
    requestId: actionRequest.requestId,
    actorId: auth.user.id,
  });
  if (verificationError || !evidenceCheck.verified) {
    return response({
      status: "verification_failed",
      code: "post_execution_verification_failed",
      error: "Payment RPC returned, but evidence verification did not pass. Do not retry with a new requestId.",
      requestId: actionRequest.requestId,
      issues: verificationError ? ["verification_unavailable"] : evidenceCheck.issues,
      retryPolicy: "recheck_same_request_id_only",
    }, 500, auth.mode);
  }

  return response({
    status: "completed",
    requestId: actionRequest.requestId,
    actionName: actionRequest.actionName,
    result: { snapshot, verification },
  }, 200, auth.mode);
}
