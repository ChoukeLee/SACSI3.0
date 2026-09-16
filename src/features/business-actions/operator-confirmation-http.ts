import { NextResponse } from "next/server";

export const confirmationReply = (body: unknown, status: number) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});
export function confirmationError(error: { message?: string }, unknownOutcome = false) {
  const codes = ["confirmationForbidden", "confirmationNotFound", "confirmationExpired", "confirmationSnapshotChanged",
    "confirmationRequestConflict", "confirmationScopeUnsupported", "confirmationResultInvalid", "invalidConfirmationRequest",
    "bookingNotFound", "bookingFinanceInconsistent", "paymentExceedsOutstanding", "invalidPaymentAmount", "invalidPaymentDate", "invalidReceiptNo", "confirmationAlreadyExecuted"];
  const code = codes.find(value => error.message?.includes(value));
  return confirmationReply({ code: code ?? (unknownOutcome ? "confirmation_outcome_unknown" : "confirmation_unavailable"),
    message: "请保留原确认单与请求编号核查，不要换请求号重录。" },
    !code ? 503 : code === "confirmationForbidden" ? 403 : code === "confirmationNotFound" ? 404 : 409);
}
export const confirmationIdValid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const confirmationDeployment = () => `${process.env.NEXT_PUBLIC_SUPABASE_URL}|${process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_APP_VERSION ?? "local-development"}`;
export const confirmationsEnabled = () => process.env.SACSI_OPERATOR_CONFIRMATIONS_ENABLED === "true";

export function confirmationBrowserOriginMatches(request: Request) {
  try {
    // Proxies/Next dev may normalize 127.0.0.1 into localhost internally. Pin the
    // public origin explicitly; never trust arbitrary forwarded-host headers.
    const configured = process.env.SACSI_OPERATOR_PUBLIC_ORIGIN;
    const expected = configured ?? new URL(request.url).origin;
    const url = new URL(expected);
    if (url.origin !== expected || (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1","localhost"].includes(url.hostname)))) return false;
    return request.headers.get("origin") === expected;
  } catch { return false; }
}
