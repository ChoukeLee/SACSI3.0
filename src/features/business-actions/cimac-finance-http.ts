import "server-only";
import { isDeepStrictEqual } from "node:util";
import { authenticateOperatorRequest } from "./operator-request-auth";
import { extractBearerToken } from "./operator-auth-header";
import { operatorAuthFailure } from "./operator-auth-failure";
import { confirmationDeployment, confirmationReply as reply } from "./operator-confirmation-http";
import { directExecutionEnabled } from "./operator-direct-execution";
import {
  issuePreviewProof,
  validPreviewSecret,
  verifyPreviewProof,
} from "./operator-preview-proof";
import {
  CimacFinanceFailure,
  cimacFinanceObject,
  cimacFinanceOnlyKeys,
  cimacFinanceUuid,
  parseCimacFinance,
  type CimacFinanceRequest,
} from "./cimac-finance";
import { verifyCimacFinanceResult } from "./cimac-finance-verification";

type Auth = Extract<
  Awaited<ReturnType<typeof authenticateOperatorRequest>>,
  { authenticated: true }
>;
function databaseFailure(error: { message?: string }) {
  const code = error.message?.match(
    /\b(?:cimacFinance[A-Za-z]+|invalidCimacFinance|requestIdConflict)\b/,
  )?.[0];
  return new CimacFinanceFailure(
    code ?? "cimac_finance_unavailable",
    code && /Permission|Forbidden|AccessDenied/.test(code) ? 403 : code ? 409 : 503,
  );
}
async function rpc(auth: Auth, name: string, parameters?: Record<string, unknown>) {
  const result = await auth.supabase.rpc(name, parameters);
  if (result.error) throw databaseFailure(result.error);
  return result.data as unknown;
}
async function ready(auth: Auth) {
  const [version, allowed] = await Promise.all([
    rpc(auth, "cimac_finance_protocol_version"),
    rpc(auth, "can_execute_cimac_finance"),
  ]);
  if (version !== 1) throw new CimacFinanceFailure("cimac_finance_upgrade_required", 503);
  if (allowed !== true) throw new CimacFinanceFailure("cimacFinancePermissionDenied", 403);
}
function unknown(requestId: string) {
  return reply(
    {
      status: "execution_unknown",
      verified: false,
      code: "cimac_finance_outcome_unknown",
      requestId,
      retryPolicy: "recheck_same_request_id_only",
      message: "执行结果尚未核实，请保留原请求号查询，不能换号或重复入账。",
    },
    503,
  );
}
function previous(value: unknown, input: CimacFinanceRequest, actorId: string) {
  if (
    !cimacFinanceObject(value) ||
    value.requestId !== input.requestId ||
    value.actorId !== actorId ||
    !isDeepStrictEqual(value.request, input)
  )
    throw new CimacFinanceFailure("cimacFinanceRequestConflict", 409);
  return {
    status: "completed_previously",
    verified: false,
    requestId: input.requestId,
    request: input,
    actorId,
    operationCount: input.operations.length,
    executionMode: "explicit_instruction",
  };
}
function canonicalStatusRequest(value: unknown, requestId: string) {
  try {
    const parsed = parseCimacFinance(value);
    return parsed.requestId === requestId && isDeepStrictEqual(parsed, value);
  } catch {
    return false;
  }
}

/** The authenticated bearer owns the write. Browser cookies and service keys never select an actor. */
export async function cimacFinancePost(
  request: Request,
  operation: "query" | "prepare" | "execute",
) {
  if (operation !== "query" && !directExecutionEnabled())
    return reply({ code: "direct_execution_not_enabled" }, 503);
  // Do not even initialize a cookie client when the connector token is absent.
  if (!extractBearerToken(request.headers.get("authorization"))) {
    const failure = operatorAuthFailure("missing_or_invalid_session");
    return reply(failure.body, failure.status);
  }
  const auth = await authenticateOperatorRequest(request);
  if (!auth.authenticated) {
    const failure = operatorAuthFailure(auth.reason);
    return reply(failure.body, failure.status);
  }
  if (auth.mode !== "bearer") return reply({ code: "connector_bearer_required" }, 403);
  if (auth.user.role !== "admin") return reply({ code: "cimacFinancePermissionDenied" }, 403);
  let attempted = false;
  let requestId: string | undefined;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 262144)
      return reply({ code: "request_too_large" }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return reply({ code: "invalid_json" }, 400);
    }
    if (
      operation === "execute" &&
      (!cimacFinanceObject(body) ||
        !cimacFinanceOnlyKeys(body, ["request", "previewProof"]) ||
        typeof body.previewProof !== "string" ||
        body.previewProof.length > 4096)
    )
      throw new CimacFinanceFailure("invalidCimacFinance");
    const input = parseCimacFinance(
      operation === "execute" && cimacFinanceObject(body) ? body.request : body,
    );
    requestId = input.requestId;
    await ready(auth);
    if (operation !== "query") {
      const prior = await rpc(auth, "find_cimac_finance", { p_request_id: requestId });
      if (!cimacFinanceObject(prior))
        throw new CimacFinanceFailure("cimac_finance_status_unavailable", 503);
      if (prior.status === "completed_previously")
        return reply(previous(prior, input, auth.user.id), 200);
      if (prior.status !== "not_found")
        throw new CimacFinanceFailure("cimac_finance_status_unavailable", 503);
    }
    const preview = await rpc(auth, "preview_cimac_finance", { p_request: input });
    if (
      !cimacFinanceObject(preview) ||
      preview.status !== "previewed" ||
      preview.requestId !== requestId ||
      preview.operationCount !== input.operations.length ||
      !cimacFinanceObject(preview.snapshot) ||
      typeof preview.snapshot.fingerprint !== "string" ||
      !preview.snapshot.fingerprint ||
      typeof preview.snapshot.requestHash !== "string" ||
      !preview.snapshot.requestHash
    )
      throw new CimacFinanceFailure("cimac_finance_preview_unavailable", 503);
    if (operation === "query") return reply({ ...preview, verified: false, readOnly: true }, 200);
    const secret = process.env.SACSI_OPERATOR_PREVIEW_SECRET;
    if (!validPreviewSecret(secret))
      throw new CimacFinanceFailure("preview_signing_unavailable", 503);
    const snapshot = preview.snapshot;
    const deployment = confirmationDeployment();
    const binding = { actorId: auth.user.id, request: input, snapshot, deployment };
    if (operation === "prepare")
      return reply(
        {
          status: "ready_for_direct_execution",
          requestId,
          preview,
          ...issuePreviewProof(binding, secret),
        },
        200,
      );
    const token = (body as { previewProof: string }).previewProof;
    const checked = verifyPreviewProof(token, binding, secret);
    if (!checked.valid) return reply(checked, 409);
    const expiresAt = new Date(
      JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString()).expiresAt,
    ).toISOString();
    attempted = true;
    const result = await rpc(auth, "execute_cimac_finance", {
      p_request: input,
      p_snapshot: snapshot,
      p_expires_at: expiresAt,
      p_deployment: deployment,
    });
    if (cimacFinanceObject(result) && result.status === "completed_previously") {
      try {
        return reply(previous(result, input, auth.user.id), 200);
      } catch {
        return unknown(requestId);
      }
    }
    if (!verifyCimacFinanceResult(result, input, auth.user.id)) return unknown(requestId);
    return reply(
      { ...(result as Record<string, unknown>), executionMode: "explicit_instruction" },
      200,
    );
  } catch (error) {
    if (attempted && requestId) return unknown(requestId);
    if (error instanceof CimacFinanceFailure) return reply({ code: error.code }, error.status);
    return reply({ code: "cimac_finance_unavailable" }, 503);
  }
}

export async function cimacFinanceStatus(request: Request) {
  // An emergency write stop must not prevent recovering an already-sent request.
  if (!extractBearerToken(request.headers.get("authorization"))) {
    const failure = operatorAuthFailure("missing_or_invalid_session");
    return reply(failure.body, failure.status);
  }
  const auth = await authenticateOperatorRequest(request);
  if (!auth.authenticated) {
    const failure = operatorAuthFailure(auth.reason);
    return reply(failure.body, failure.status);
  }
  if (auth.mode !== "bearer") return reply({ code: "connector_bearer_required" }, 403);
  if (auth.user.role !== "admin") return reply({ code: "cimacFinancePermissionDenied" }, 403);
  try {
    const params = new URL(request.url).searchParams;
    const requestId = params.get("requestId");
    if (
      [...params.keys()].some((key) => key !== "requestId") ||
      params.getAll("requestId").length !== 1 ||
      !cimacFinanceUuid(requestId)
    )
      return reply({ code: "invalid_request_id" }, 400);
    await ready(auth);
    const result = await rpc(auth, "find_cimac_finance", {
      p_request_id: requestId.toLowerCase(),
    });
    if (
      !cimacFinanceObject(result) ||
      !["not_found", "completed_previously"].includes(String(result.status)) ||
      (result.status === "completed_previously" &&
        (result.requestId !== requestId.toLowerCase() ||
          result.actorId !== auth.user.id ||
          !canonicalStatusRequest(result.request, requestId.toLowerCase())))
    )
      return reply({ code: "cimac_finance_status_unavailable" }, 503);
    return reply({ ...result, requestId: requestId.toLowerCase(), verified: false }, 200);
  } catch (error) {
    if (error instanceof CimacFinanceFailure) return reply({ code: error.code }, error.status);
    return reply({ code: "cimac_finance_status_unavailable" }, 503);
  }
}
