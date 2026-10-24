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
  CimacMaintenanceFailure,
  cimacObject,
  cimacOnlyKeys,
  cimacUuid,
  parseCimacMaintenance,
  type CimacMaintenanceRequest,
} from "./cimac-maintenance";
import { verifyCimacMaintenanceResult } from "./cimac-maintenance-verification";

type Auth = Extract<
  Awaited<ReturnType<typeof authenticateOperatorRequest>>,
  { authenticated: true }
>;
function databaseFailure(error: { message?: string }) {
  const code = error.message?.match(
    /\b(?:cimacMaintenance[A-Za-z]+|invalidCimacMaintenance|requestIdConflict)\b/,
  )?.[0];
  return new CimacMaintenanceFailure(
    code ?? "cimac_maintenance_unavailable",
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
    rpc(auth, "cimac_maintenance_protocol_version"),
    rpc(auth, "can_execute_cimac_maintenance"),
  ]);
  if (version !== 1) throw new CimacMaintenanceFailure("cimac_maintenance_upgrade_required", 503);
  if (allowed !== true) throw new CimacMaintenanceFailure("cimacMaintenancePermissionDenied", 403);
}
function unknown(requestId: string) {
  return reply(
    {
      status: "execution_unknown",
      verified: false,
      code: "cimac_maintenance_outcome_unknown",
      requestId,
      retryPolicy: "recheck_same_request_id_only",
      message: "执行结果尚未核实，请保留原请求号查询，不能换号或重复入账。",
    },
    503,
  );
}
function previous(value: unknown, input: CimacMaintenanceRequest, actorId: string) {
  if (
    !cimacObject(value) ||
    value.requestId !== input.requestId ||
    value.actorId !== actorId ||
    !isDeepStrictEqual(value.request, input)
  )
    throw new CimacMaintenanceFailure("cimacMaintenanceRequestConflict", 409);
  return {
    status: "completed_previously",
    verified: false,
    requestId: input.requestId,
    actorId,
    operationCount: input.operations.length,
    executionMode: "explicit_instruction",
  };
}

/** The authenticated bearer owns the write. Browser cookies and service keys never select an actor. */
export async function cimacMaintenancePost(
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
  let attempted = false;
  let requestId: string | undefined;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 131072)
      return reply({ code: "request_too_large" }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return reply({ code: "invalid_json" }, 400);
    }
    if (
      operation === "execute" &&
      (!cimacObject(body) ||
        !cimacOnlyKeys(body, ["request", "previewProof"]) ||
        typeof body.previewProof !== "string" ||
        body.previewProof.length > 4096)
    )
      throw new CimacMaintenanceFailure("invalidCimacMaintenance");
    const input = parseCimacMaintenance(
      operation === "execute" && cimacObject(body) ? body.request : body,
    );
    requestId = input.requestId;
    await ready(auth);
    if (operation !== "query") {
      const prior = await rpc(auth, "find_cimac_maintenance", { p_request_id: requestId });
      if (!cimacObject(prior))
        throw new CimacMaintenanceFailure("cimac_maintenance_status_unavailable", 503);
      if (prior.status === "completed_previously")
        return reply(previous(prior, input, auth.user.id), 200);
      if (prior.status !== "not_found")
        throw new CimacMaintenanceFailure("cimac_maintenance_status_unavailable", 503);
    }
    const preview = await rpc(auth, "preview_cimac_maintenance", { p_request: input });
    if (
      !cimacObject(preview) ||
      preview.status !== "previewed" ||
      preview.requestId !== requestId ||
      preview.operationCount !== input.operations.length ||
      !cimacObject(preview.snapshot) ||
      typeof preview.snapshot.fingerprint !== "string" ||
      !preview.snapshot.fingerprint ||
      typeof preview.snapshot.requestHash !== "string" ||
      !preview.snapshot.requestHash
    )
      throw new CimacMaintenanceFailure("cimac_maintenance_preview_unavailable", 503);
    if (operation === "query") return reply({ ...preview, verified: false, readOnly: true }, 200);
    const secret = process.env.SACSI_OPERATOR_PREVIEW_SECRET;
    if (!validPreviewSecret(secret))
      throw new CimacMaintenanceFailure("preview_signing_unavailable", 503);
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
    const result = await rpc(auth, "execute_cimac_maintenance", {
      p_request: input,
      p_snapshot: snapshot,
      p_expires_at: expiresAt,
      p_deployment: deployment,
    });
    if (cimacObject(result) && result.status === "completed_previously") {
      try {
        return reply(previous(result, input, auth.user.id), 200);
      } catch {
        return unknown(requestId);
      }
    }
    if (!verifyCimacMaintenanceResult(result, input, auth.user.id)) return unknown(requestId);
    return reply(
      { ...(result as Record<string, unknown>), executionMode: "explicit_instruction" },
      200,
    );
  } catch (error) {
    if (attempted && requestId) return unknown(requestId);
    if (error instanceof CimacMaintenanceFailure) return reply({ code: error.code }, error.status);
    return reply({ code: "cimac_maintenance_unavailable" }, 503);
  }
}

export async function cimacMaintenanceStatus(request: Request) {
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
  try {
    const params = new URL(request.url).searchParams;
    const requestId = params.get("requestId");
    if (
      [...params.keys()].some((key) => key !== "requestId") ||
      params.getAll("requestId").length !== 1 ||
      !cimacUuid(requestId)
    )
      return reply({ code: "invalid_request_id" }, 400);
    await ready(auth);
    const result = await rpc(auth, "find_cimac_maintenance", {
      p_request_id: requestId.toLowerCase(),
    });
    if (
      !cimacObject(result) ||
      !["not_found", "completed_previously"].includes(String(result.status)) ||
      (result.status === "completed_previously" &&
        (result.requestId !== requestId.toLowerCase() || result.actorId !== auth.user.id))
    )
      return reply({ code: "cimac_maintenance_status_unavailable" }, 503);
    return reply({ ...result, requestId: requestId.toLowerCase(), verified: false }, 200);
  } catch (error) {
    if (error instanceof CimacMaintenanceFailure) return reply({ code: error.code }, error.status);
    return reply({ code: "cimac_maintenance_status_unavailable" }, 503);
  }
}
