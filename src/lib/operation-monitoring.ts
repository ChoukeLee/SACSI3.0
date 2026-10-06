import "server-only";
import * as Sentry from "@sentry/nextjs";

/** Explicit allowlist only. No instructions, amounts, contacts or token payloads. */
export function captureOperationFailure(input: {
  operation: string;
  requestId: string;
  code?: string;
}) {
  if (!/^[a-z_]{1,64}$/.test(input.operation) || !/^[0-9a-f-]{36}$/i.test(input.requestId)) return;
  const code = /^[A-Z0-9_]{1,32}$/.test(input.code ?? "") ? input.code! : "UNKNOWN";
  Sentry.captureException(new Error("Business operation unavailable"), {
    tags: { operation: input.operation, request_id: input.requestId, error_code: code },
  });
}
