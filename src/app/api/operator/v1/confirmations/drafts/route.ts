import { authenticateOperatorRequest } from "@/features/business-actions/operator-request-auth";
import { operatorAuthFailure } from "@/features/business-actions/operator-auth-failure";
import { parseOperatorActionRequest, parseRecordDailyPaymentInput, validateOperatorCompatibility } from "@/features/business-actions/operator-action-contract";
import { buildPaymentPreview } from "@/features/business-actions/operator-payment-preview";
import { verifyPreviewProof, validPreviewSecret } from "@/features/business-actions/operator-preview-proof";
import { confirmationReply as reply, confirmationError, confirmationDeployment, confirmationIdValid, confirmationsEnabled } from "@/features/business-actions/operator-confirmation-http";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!confirmationsEnabled()) return reply({ code: "confirmations_not_enabled" }, 503);
  const auth = await authenticateOperatorRequest(request);
  if (!auth.authenticated) { const failure = operatorAuthFailure(auth.reason); return reply(failure.body, failure.status); }
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 65536) return reply({ code: "request_too_large" }, 413);
    let body; try { body = JSON.parse(raw); } catch { return reply({ code: "invalid_json" }, 400); }
    if (body?.replacesConfirmationId !== undefined && (typeof body.replacesConfirmationId !== "string" || !confirmationIdValid(body.replacesConfirmationId))) return reply({ code: "invalid_confirmation_id" },400);
    const parsed = parseOperatorActionRequest(body?.request);
    if (!parsed.success) return reply(parsed, 400);
    const compatible = validateOperatorCompatibility(parsed.data); if (!compatible.success) return reply(compatible,409);
    const input = parseRecordDailyPaymentInput(parsed.data.input); if (!input.success) return reply(input,400);
    const secret = process.env.SACSI_OPERATOR_PREVIEW_SECRET;
    if (!validPreviewSecret(secret)) return reply({ code: "preview_signing_unavailable" },503);
    const snapshot = await auth.supabase.rpc("daily_booking_operation_snapshot", { p_booking_id: input.data.bookingId });
    if (snapshot.error) return confirmationError(snapshot.error);
    const preview = buildPaymentPreview(parsed.data, snapshot.data); if (!preview.success) return reply(preview,409);
    const deployment = confirmationDeployment();
    const check = verifyPreviewProof(body?.previewProof, { actorId: auth.user.id, request: preview.normalizedRequest, snapshot: snapshot.data, deployment }, secret);
    if (!check.valid) return reply(check,409);
    // Decode expiry only AFTER signature, actor, request and snapshot validation.
    const expiresAt = new Date(JSON.parse(Buffer.from(body.previewProof.split(".")[0], "base64url").toString("utf8")).expiresAt).toISOString();
    const result = await auth.supabase.rpc(body.replacesConfirmationId ? "reprepare_operator_payment_confirmation" : "create_operator_payment_confirmation", {
      ...(body.replacesConfirmationId ? { p_previous_id: body.replacesConfirmationId } : {}),
      p_request: { ...preview.normalizedRequest, confirmationDeployment: deployment }, p_snapshot: snapshot.data, p_expires_at: expiresAt,
    });
    if (result.error) return confirmationError(result.error);
    return reply({ status: "awaiting_account_confirmation", confirmation: result.data,
      confirmationPath: `/operator/confirmations/${result.data.id}`, requestId: parsed.data.requestId },200);
  } catch { return confirmationError({}); }
}
