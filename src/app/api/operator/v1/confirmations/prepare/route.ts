import { NextResponse } from "next/server";
import { authenticateOperatorRequest } from "@/features/business-actions/operator-request-auth";
import { operatorAuthFailure } from "@/features/business-actions/operator-auth-failure";
import { parseOperatorActionRequest, parseRecordDailyPaymentInput, validateOperatorCompatibility } from "@/features/business-actions/operator-action-contract";
import { buildPaymentPreview } from "@/features/business-actions/operator-payment-preview";
import { issuePreviewProof, validPreviewSecret } from "@/features/business-actions/operator-preview-proof";

export const runtime = "nodejs";
const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/** Read-only preview. No confirmation receipt is consumed and no money is written. */
export async function POST(request: Request) {
  const auth = await authenticateOperatorRequest(request);
  if (!auth.authenticated) { const failure = operatorAuthFailure(auth.reason); return reply(failure.body, failure.status); }
  let body: unknown;
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 65536) return reply({ code: "request_too_large" }, 413);
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 65536) return reply({ code: "request_too_large" }, 413);
    body = JSON.parse(text);
  } catch { return reply({ code: "invalid_json" }, 400); }
  const parsed = parseOperatorActionRequest(body);
  if (!parsed.success) return reply(parsed, 400);
  const action = parsed.data;
  const compatible = validateOperatorCompatibility(action);
  if (!compatible.success) return reply(compatible, 409);
  if (action.actionName !== "record_daily_payment" || action.inputSource !== "excel_screenshot"
    || action.scope !== "business_data" || action.exceptionalBusinessCase) return reply({ code: "preview_scope_not_supported" }, 422);
  const input = parseRecordDailyPaymentInput(action.input);
  if (!input.success) return reply(input, 400);
  const secret = process.env.SACSI_OPERATOR_PREVIEW_SECRET;
  if (!validPreviewSecret(secret)) return reply({ code: "preview_signing_unavailable" }, 503);
  try {
    const authorization = await auth.supabase.rpc("can_execute_operator_action", { p_action_name: "record_daily_payment", p_risk_level: "L2" });
    if (authorization.error) return reply({ code: "authorization_unavailable" }, 503);
    if (authorization.data !== true) return reply({ code: "action_forbidden" }, 403);
    const version = await auth.supabase.rpc("operator_daily_payment_protocol_version");
    if (version.error || version.data !== 2) return reply({ code: "database_upgrade_required" }, 503);
    // Selectors come from the validated request, never a client-provided snapshot.
    const snapshot = await auth.supabase.rpc("daily_booking_operation_snapshot", { p_booking_id: input.data.bookingId });
    if (snapshot.error) return reply({ code: "preview_snapshot_unavailable" }, 503);
    const result = buildPaymentPreview(action, snapshot.data);
    if (!result.success) return reply(result, 409);
    const deployment = `${process.env.NEXT_PUBLIC_SUPABASE_URL}|${process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_APP_VERSION ?? "local-development"}`;
    const proof = issuePreviewProof({ actorId: auth.user.id, request: result.normalizedRequest, snapshot: snapshot.data, deployment }, secret);
    return reply({ status: "preview_requires_human_confirmation", executionAvailable: false,
      actor: { id: auth.user.id, displayName: auth.user.displayName }, preview: result.preview, ...proof,
      notice: "This is a read-only preview, not approval or a payment result. A separate same-account webpage confirmation is required before posting." }, 200);
  } catch { return reply({ code: "preview_unavailable" }, 503); }
}
