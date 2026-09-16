export type OperatorAuthFailureReason =
  | "missing_or_invalid_session"
  | "account_not_configured"
  | "authentication_unavailable";

/** Inspect structured server errors only; never return their messages/tokens. */
export function classifyOperatorAuthError(error: { name?: string; status?: number; code?: string }): OperatorAuthFailureReason {
  if (error.name === "AuthRetryableFetchError" || error.name === "AuthUnknownError"
    || error.status === 0 || error.status === 408 || error.status === 429
    || (typeof error.status === "number" && error.status >= 500)
    || error.code === "request_timeout") return "authentication_unavailable";
  return "missing_or_invalid_session";
}

export function operatorAuthFailure(reason: OperatorAuthFailureReason) {
  if (reason === "authentication_unavailable") return {
    status: 503, body: { code: reason, error: "Authentication service unavailable; retry later without changing accounts" },
  };
  if (reason === "account_not_configured") return {
    status: 403, body: { code: reason, error: "Account not configured" },
  };
  return { status: 401, body: { code: reason, error: "Authentication required" } };
}
