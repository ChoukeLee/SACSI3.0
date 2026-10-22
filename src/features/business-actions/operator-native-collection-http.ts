import "server-only";
import { isDeepStrictEqual } from "node:util";
import { authenticateOperatorRequest } from "./operator-request-auth";
import { operatorAuthFailure } from "./operator-auth-failure";
import { confirmationDeployment, confirmationReply as reply } from "./operator-confirmation-http";
import { directExecutionEnabled } from "./operator-direct-execution";
import {
  issuePreviewProof,
  validPreviewSecret,
  verifyPreviewProof,
} from "./operator-preview-proof";
import {
  NativeCollectionFailure,
  nativeObject,
  nativeOnlyKeys,
  nativeUuid,
  parseNativeCollection,
  parseNativeSelector,
} from "./operator-native-collection";
import { verifyNativeCollectionResult } from "./operator-native-collection-verification";

type Auth = Extract<
  Awaited<ReturnType<typeof authenticateOperatorRequest>>,
  { authenticated: true }
>;
function databaseFailure(error: { message?: string }) {
  const code = error.message?.match(
    /\b(?:nativeCollection[A-Za-z]+|invalidNativeCollection|leaseCollection[A-Za-z]+|requestIdConflict)\b/,
  )?.[0];
  return new NativeCollectionFailure(
    code ?? "native_collection_unavailable",
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
    rpc(auth, "operator_native_collection_protocol_version"),
    rpc(auth, "can_execute_operator_native_collection"),
  ]);
  if (version !== 1) throw new NativeCollectionFailure("native_collection_upgrade_required", 503);
  if (allowed !== true) throw new NativeCollectionFailure("nativeCollectionPermissionDenied", 403);
}
function unknown(requestId: string) {
  return reply(
    {
      status: "execution_unknown",
      verified: false,
      code: "native_collection_outcome_unknown",
      requestId,
      retryPolicy: "recheck_same_request_id_only",
      message: "执行结果尚未核实，请保留原请求号查询，不能换号或重复录入。",
    },
    503,
  );
}

/** Bearer-only business boundary. No cookie fallback or second web confirmation. */
export async function nativeCollectionPost(
  request: Request,
  operation: "query" | "prepare" | "execute",
) {
  if (!directExecutionEnabled()) return reply({ code: "direct_execution_not_enabled" }, 503);
  const auth = await authenticateOperatorRequest(request);
  if (!auth.authenticated) {
    const f = operatorAuthFailure(auth.reason);
    return reply(f.body, f.status);
  }
  if (auth.mode !== "bearer") return reply({ code: "connector_bearer_required" }, 403);
  let attempted = false;
  let requestId: string | undefined;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 65536)
      return reply({ code: "request_too_large" }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return reply({ code: "invalid_json" }, 400);
    }
    await ready(auth);
    if (operation === "query")
      return reply(
        await rpc(auth, "query_operator_native_collection", {
          p_selector: parseNativeSelector(body),
        }),
        200,
      );
    if (
      operation === "execute" &&
      (!nativeObject(body) ||
        !nativeOnlyKeys(body, ["request", "previewProof"]) ||
        typeof body.previewProof !== "string")
    )
      throw new NativeCollectionFailure("invalidNativeCollection");
    const input = parseNativeCollection(
      operation === "execute" && nativeObject(body) ? body.request : body,
    );
    requestId = input.requestId;
    // A known completion is history, not a fresh verification of today's ledger.
    const prior = await rpc(auth, "find_operator_native_collection", { p_request_id: requestId });
    if (!nativeObject(prior))
      throw new NativeCollectionFailure("native_collection_status_unavailable", 503);
    if (prior.status === "completed_previously") {
      if (!isDeepStrictEqual(prior.request, input))
        throw new NativeCollectionFailure("nativeCollectionRequestConflict", 409);
      return reply(
        {
          status: "completed_previously",
          verified: false,
          requestId,
          currency: prior.currency,
          amount: prior.amount,
          contractId: prior.contractId,
          executionMode: "explicit_instruction",
        },
        200,
      );
    }
    if (prior.status !== "not_found")
      throw new NativeCollectionFailure("native_collection_status_unavailable", 503);
    const secret = process.env.SACSI_OPERATOR_PREVIEW_SECRET;
    if (!validPreviewSecret(secret))
      throw new NativeCollectionFailure("preview_signing_unavailable", 503);
    const snapshot = await rpc(auth, "preview_operator_native_collection", { p_request: input });
    const deployment = confirmationDeployment();
    const binding = { actorId: auth.user.id, request: input, snapshot, deployment };
    if (operation === "prepare")
      return reply(
        {
          status: "ready_for_direct_execution",
          requestId,
          preview: {
            contractId: input.contractId,
            currency: input.currency,
            amount: input.amount,
            paymentDate: input.paymentDate,
            allocations: input.allocations,
            coverage: input.coverage ?? null,
            nativeOnly: true,
            conversionToXof: false,
          },
          ...issuePreviewProof(binding, secret),
        },
        200,
      );
    const checked = verifyPreviewProof(
      (body as Record<string, unknown>).previewProof,
      binding,
      secret,
    );
    if (!checked.valid) return reply(checked, 409);
    const token = (body as { previewProof: string }).previewProof;
    const expiresAt = new Date(
      JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString()).expiresAt,
    ).toISOString();
    attempted = true;
    const result = await rpc(auth, "execute_operator_native_collection", {
      p_request: input,
      p_snapshot: snapshot,
      p_expires_at: expiresAt,
      p_deployment: deployment,
    });
    if (nativeObject(result) && result.status === "completed_previously") {
      if (
        result.requestId !== requestId ||
        result.currency !== input.currency ||
        result.amount !== input.amount ||
        result.contractId !== input.contractId
      )
        return unknown(requestId);
      return reply({ ...result, verified: false, executionMode: "explicit_instruction" }, 200);
    }
    if (!verifyNativeCollectionResult(result, input, auth.user.id)) return unknown(requestId);
    return reply(
      { ...(result as Record<string, unknown>), executionMode: "explicit_instruction" },
      200,
    );
  } catch (error) {
    if (attempted && requestId) return unknown(requestId);
    if (error instanceof NativeCollectionFailure) return reply({ code: error.code }, error.status);
    return reply({ code: "native_collection_unavailable" }, 503);
  }
}

export async function nativeCollectionStatus(request: Request) {
  // Disabling new writes must not hide the outcome of an already-sent receipt.
  const auth = await authenticateOperatorRequest(request);
  if (!auth.authenticated) {
    const f = operatorAuthFailure(auth.reason);
    return reply(f.body, f.status);
  }
  if (auth.mode !== "bearer") return reply({ code: "connector_bearer_required" }, 403);
  try {
    const params = new URL(request.url).searchParams;
    const id = params.get("requestId");
    if (
      [...params.keys()].some((k) => k !== "requestId") ||
      params.getAll("requestId").length !== 1 ||
      !nativeUuid(id)
    )
      return reply({ code: "invalid_request_id" }, 400);
    await ready(auth);
    const result = await rpc(auth, "find_operator_native_collection", {
      p_request_id: id.toLowerCase(),
    });
    if (
      !nativeObject(result) ||
      !["not_found", "completed_previously"].includes(String(result.status))
    )
      return reply({ code: "native_collection_status_unavailable" }, 503);
    return reply({ ...result, requestId: id.toLowerCase(), verified: false }, 200);
  } catch (error) {
    if (error instanceof NativeCollectionFailure) return reply({ code: error.code }, error.status);
    return reply({ code: "native_collection_status_unavailable" }, 503);
  }
}
