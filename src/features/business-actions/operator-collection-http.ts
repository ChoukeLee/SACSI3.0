import { authenticateOperatorRequest } from "./operator-request-auth";
import { operatorAuthFailure } from "./operator-auth-failure";
import { batchUuid, collectionPreview, collectionFeedback, parseCollectionRequest, suggestCollectionAllocation, suggestMonthlyLeaseSplit } from "./operator-batch";
import { issuePreviewProof, validPreviewSecret, verifyPreviewProof } from "./operator-preview-proof";
import { confirmationReply as reply, confirmationDeployment, confirmationsEnabled, confirmationBrowserOriginMatches } from "./operator-confirmation-http";

export function collectionError(error: { message?: string }, unknownOutcome = false) {
  const code = error.message?.match(/\b(collection[A-Za-z]+|invalidCollection[A-Za-z]+|duplicateCollection[A-Za-z]+|invalid_batch_[a-z_]+|duplicate_batch_[a-z_]+|row_total_mismatch|batch_total_mismatch)\b/)?.[0];
  return reply({ code: code || (unknownOutcome ? "collection_outcome_unknown" : "collection_unavailable"),
    message: collectionFeedback(code || "") }, code === "collectionForbidden" ? 403 : code ? 409 : 503);
}
export async function collectionPost(request: Request, operation: "query" | "prepare" | "drafts") {
  if (!confirmationsEnabled()) return reply({ code: "confirmations_not_enabled" }, 503);
  const auth = await authenticateOperatorRequest(request);
  if (!auth.authenticated) { const f = operatorAuthFailure(auth.reason); return reply(f.body, f.status); }
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 65536) return reply({ code: "request_too_large" }, 413);
    let body; try { body = JSON.parse(raw); } catch { return reply({ code: "invalid_json" }, 400); }
    if (operation === "query") {
      if (!body || typeof body !== "object" || Array.isArray(body) || !["daily", "lease", "sale"].includes(body.domain)
        || Object.keys(body).some(k => !["domain", "targetId", "buildingCode", "unitNo", "selectedReceivableIds", "totalXof", "periodStart", "periodEnd"].includes(k))
        || (body.targetId ? !batchUuid(body.targetId) || body.buildingCode !== undefined || body.unitNo !== undefined
          : ![body.buildingCode, body.unitNo].every(v => typeof v === "string" && v.trim() && v.length <= 40))) return reply({ code: "invalid_selector" }, 400);
      const result = await auth.supabase.rpc("query_operator_collection", { p_domain: body.domain, p_target_id: body.targetId ?? null, p_building_code: body.buildingCode ?? null, p_unit_no: body.unitNo ?? null });
      if (result.error) return collectionError(result.error);
      if (body.periodStart !== undefined || body.periodEnd !== undefined) {
        if (body.domain !== "lease" || result.data.status !== "found") return reply({ code: "contract_selection_required" }, 409);
        result.data.monthlySplit = suggestMonthlyLeaseSplit(result.data.contract, result.data.propertyFeeRules ?? [], body.totalXof, body.periodStart, body.periodEnd);
      }
      if (body.selectedReceivableIds !== undefined) {
        if (!Array.isArray(body.selectedReceivableIds) || body.selectedReceivableIds.length > 36 || !body.selectedReceivableIds.every(batchUuid)) return reply({ code: "invalid_selection" }, 400);
        const selected = (result.data.receivables ?? []).filter((r: { id: string; status: string; management_status: string }) => body.selectedReceivableIds.includes(r.id) && !["paid", "cancelled"].includes(r.status) && !["historical_pending", "excluded"].includes(r.management_status));
        result.data.suggestion = selected.length === body.selectedReceivableIds.length
          ? suggestCollectionAllocation(body.totalXof, selected) : { status: "clarification_required", question: "所选应收项不存在或已不可收款，请重新核对。" };
      }
      return reply(result.data, 200);
    }
    const input = parseCollectionRequest(operation === "drafts" ? body?.request : body);
    const secret = process.env.SACSI_OPERATOR_PREVIEW_SECRET;
    if (!validPreviewSecret(secret)) return reply({ code: "preview_signing_unavailable" }, 503);
    const snapshot = await auth.supabase.rpc("preview_operator_collection", { p_request: input });
    if (snapshot.error) return collectionError(snapshot.error);
    const binding = { actorId: auth.user.id, request: input, snapshot: snapshot.data, deployment: confirmationDeployment() };
    if (operation === "prepare") return reply({ status: "preview_requires_human_confirmation", preview: collectionPreview(input, snapshot.data), ...issuePreviewProof(binding, secret) }, 200);
    if (body.replacesConfirmationId !== undefined && !batchUuid(body.replacesConfirmationId)) return reply({ code: "invalid_confirmation_id" }, 400);
    const checked = verifyPreviewProof(body.previewProof, binding, secret);
    if (!checked.valid) return reply(checked, 409);
    const expiresAt = new Date(JSON.parse(Buffer.from(body.previewProof.split(".")[0], "base64url").toString()).expiresAt).toISOString();
    const result = await auth.supabase.rpc("create_operator_collection", { p_request: input, p_snapshot: snapshot.data, p_expires_at: expiresAt, p_deployment: binding.deployment, p_replaces_id: body.replacesConfirmationId ?? null });
    if (result.error) return collectionError(result.error);
    return reply({ status: result.data.status === "completed" ? "completed_previously" : "awaiting_account_confirmation", confirmation: result.data, confirmationPath: `/operator/collections/${result.data.id}`, requestId: input.requestId }, 200);
  } catch (error) { return collectionError(error instanceof Error ? error : {}); }
}

export async function confirmCollection(request: Request, id: string) {
  if (!confirmationsEnabled()) return reply({ code: "confirmations_not_enabled" }, 503);
  if (request.headers.has("authorization") || !confirmationBrowserOriginMatches(request)) return reply({ code: "browser_confirmation_required" }, 403);
  const auth = await authenticateOperatorRequest(request);
  if (!auth.authenticated) { const f = operatorAuthFailure(auth.reason); return reply(f.body, f.status); }
  if (auth.mode !== "cookie") return reply({ code: "browser_confirmation_required" }, 403);
  if (!batchUuid(id)) return reply({ code: "invalid_confirmation_id" }, 400);
  try {
    const draft = await auth.supabase.rpc("get_operator_collection", { p_id: id });
    if (draft.error) return collectionError(draft.error);
    if (draft.data.deployment !== confirmationDeployment()) return reply({ code: "confirmation_deployment_changed" }, 409);
    const result = await auth.supabase.rpc("confirm_operator_collection", { p_id: id });
    if (result.error) return collectionError(result.error, true);
    if (result.data?.verified !== true || result.data.requestId !== draft.data.request_id || result.data.totalXof !== draft.data.request_data.totalXof) return collectionError({ message: "collectionResultInvalid" }, true);
    return reply(result.data, 200);
  } catch { return collectionError({}, true); }
}
