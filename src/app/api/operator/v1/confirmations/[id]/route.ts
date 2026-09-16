import { authenticateOperatorRequest } from "@/features/business-actions/operator-request-auth";
import { operatorAuthFailure } from "@/features/business-actions/operator-auth-failure";
import { parseRecordDailyPaymentInput } from "@/features/business-actions/operator-action-contract";
import { verifyOperatorPaymentEvidence } from "@/features/business-actions/operator-payment-verification";
import { confirmationReply as reply, confirmationError, confirmationDeployment, confirmationIdValid, confirmationsEnabled, confirmationBrowserOriginMatches } from "@/features/business-actions/operator-confirmation-http";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!confirmationsEnabled()) return reply({ code: "confirmations_not_enabled" },503);
  // Only the account's same-origin browser flow may use this HTTP endpoint.
  // This is CSRF protection, not proof of a physical human or an AI detector.
  if (request.headers.has("authorization") || !confirmationBrowserOriginMatches(request)) return reply({ code: "browser_confirmation_required" },403);
  const auth = await authenticateOperatorRequest(request);
  if (!auth.authenticated) { const failure = operatorAuthFailure(auth.reason); return reply(failure.body, failure.status); }
  if (auth.mode !== "cookie") return reply({ code: "browser_confirmation_required" },403);
  const { id } = await context.params; if (!confirmationIdValid(id)) return reply({ code: "invalid_confirmation_id" },400);
  try {
    const draft = await auth.supabase.rpc("get_operator_payment_confirmation", { p_id: id });
    if (draft.error) return confirmationError(draft.error);
    const data = draft.data;
    if (data?.status === "superseded") return reply({ code: "confirmationSuperseded" },409);
    if (data?.request?.confirmationDeployment !== confirmationDeployment()) return reply({ code: "confirmation_deployment_changed" },409);
    const input = parseRecordDailyPaymentInput(data.request.input);
    if (!input.success) return reply({ code: "invalid_confirmation_record" },409);
    let result;
    try { result = await auth.supabase.rpc("confirm_operator_payment", { p_id: id }); }
    catch { return confirmationError({},true); }
    if (result.error) return confirmationError(result.error,true);
    const evidence = verifyOperatorPaymentEvidence(result.data?.verification, { ...input.data, requestId: data.request.requestId, actorId: auth.user.id });
    if (!evidence.verified) return reply({ code: "confirmation_result_unverified", requestId: data.request.requestId,
      message: "结果复查未通过，请保留原确认单，不要新建付款。" },503);
    return reply({ status: "completed", requestId: data.request.requestId },200);
  } catch { return confirmationError({}); }
}
