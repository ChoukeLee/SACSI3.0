import { authenticateOperatorRequest } from "@/features/business-actions/operator-request-auth";
import { operatorAuthFailure } from "@/features/business-actions/operator-auth-failure";
import { confirmationReply as reply } from "@/features/business-actions/operator-confirmation-http";
import { directExecutionEnabled } from "@/features/business-actions/operator-direct-execution";
import { batchUuid } from "@/features/business-actions/operator-batch";

async function authorized(request: Request) {
  if (!directExecutionEnabled()) return reply({ code: "direct_execution_unavailable" }, 503);
  const auth = await authenticateOperatorRequest(request);
  if (!auth.authenticated) {
    const failure = operatorAuthFailure(auth.reason);
    return reply(failure.body, failure.status);
  }
  if (auth.mode !== "bearer" || auth.user.role !== "admin") {
    return reply({ code: "operationForbidden" }, 403);
  }
  return auth;
}

export async function POST(request: Request) {
  const auth = await authorized(request);
  if (auth instanceof Response) return auth;

  let body;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 8192) {
      return reply({ code: "request_too_large" }, 413);
    }
    body = JSON.parse(raw);
  } catch {
    return reply({ code: "operationInvalidRequest" }, 400);
  }
  if (
    !body ||
    Object.keys(body).some(
      (key) =>
        !["requestId", "bookingIds", "amountEachXof", "refundDate", "paymentMethod"].includes(key),
    ) ||
    !batchUuid(body.requestId) ||
    !Array.isArray(body.bookingIds) ||
    body.bookingIds.length < 1 ||
    body.bookingIds.length > 20 ||
    !body.bookingIds.every(batchUuid) ||
    !Number.isSafeInteger(body.amountEachXof) ||
    body.amountEachXof <= 0 ||
    body.amountEachXof > 999999999999 ||
    typeof body.refundDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(body.refundDate) ||
    !["cash", "check", "bank_transfer", "other"].includes(body.paymentMethod)
  ) {
    return reply({ code: "operationInvalidRequest" }, 400);
  }
  const { data, error } = await auth.supabase.rpc("operator_cancel_refunded_reservations", {
    p_request_id: body.requestId,
    p_booking_ids: body.bookingIds,
    p_amount_each: body.amountEachXof,
    p_refund_date: body.refundDate,
    p_method: body.paymentMethod,
  });
  if (error) {
    if (error.code === "42501") return reply({ code: "operationForbidden" }, 403);
    const known = [
      "operationInvalidRequest",
      "operationRequestConflict",
      "operationRefundReviewRequired",
      "operationFinanceMismatch",
    ];
    if (known.includes(error.message)) return reply({ code: error.message }, 409);
    return reply({ code: "cancellation_outcome_unknown", requestId: body.requestId }, 503);
  }
  return reply(data, 200);
}

export async function GET(request: Request) {
  const auth = await authorized(request);
  if (auth instanceof Response) return auth;
  const requestId = new URL(request.url).searchParams.get("requestId");
  if (!batchUuid(requestId)) return reply({ code: "operationInvalidRequest" }, 400);
  const { data, error } = await auth.supabase.rpc("operator_cancel_refunded_reservations_status", {
    p_request_id: requestId,
  });
  if (error) return reply({ code: "cancellation_status_unavailable", requestId }, 503);
  return reply(data, 200);
}
