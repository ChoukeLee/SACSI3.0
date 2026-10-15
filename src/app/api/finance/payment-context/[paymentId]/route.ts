import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  decodePaymentContext,
  parsePaymentContextConfirmation,
  validPaymentContextId,
} from "@/features/finance/payment-context";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
type Context = { params: Promise<{ paymentId: string }> };
const failure = (error: string, status: number) => Response.json({ error }, { status, headers });
function databaseError(error: { code?: string; message?: string }) {
  if (error.code === "42501") return failure("paymentContextPermissionDenied", 403);
  if (error.message === "paymentContextNotFound") return failure(error.message, 404);
  if (
    [
      "paymentContextSnapshotChanged",
      "paymentContextRequestConflict",
      "paymentContextTargetMismatch",
    ].includes(error.message ?? "")
  )
    return failure(error.message!, 409);
  if (error.message === "invalidPaymentContext") return failure(error.message, 400);
  return failure("paymentContextUnavailable", 503);
}
export async function GET(_request: Request, context: Context) {
  const user = await getCurrentUser();
  if (!user) return failure("authenticationRequired", 401);
  if (!hasPermission(user, "finance:read")) return failure("paymentContextPermissionDenied", 403);
  const { paymentId } = await context.params;
  if (!validPaymentContextId(paymentId)) return failure("invalidPaymentContext", 400);
  try {
    const { data, error } = await (
      await createClient()
    ).rpc("payment_context_read_rpc", { p_payment_id: paymentId });
    if (error) return databaseError(error);
    return Response.json(decodePaymentContext(data), { headers });
  } catch {
    return failure("paymentContextUnavailable", 503);
  }
}
export async function POST(request: Request, context: Context) {
  const user = await getCurrentUser();
  if (!user) return failure("authenticationRequired", 401);
  if (!hasPermission(user, "finance:write")) return failure("paymentContextPermissionDenied", 403);
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return failure("paymentContextPermissionDenied", 403);
  const { paymentId } = await context.params;
  if (!validPaymentContextId(paymentId)) return failure("invalidPaymentContext", 400);
  let parsed: ReturnType<typeof parsePaymentContextConfirmation>;
  try {
    const body = await request.text();
    if (body.length > 65536) return failure("invalidPaymentContext", 400);
    parsed = parsePaymentContextConfirmation(JSON.parse(body));
  } catch {
    return failure("invalidPaymentContext", 400);
  }
  try {
    const { data, error } = await (
      await createClient()
    ).rpc("confirm_payment_context_rpc", {
      p_payment_id: paymentId,
      p_input: parsed.input,
      p_request_id: parsed.requestId,
    });
    if (error) return databaseError(error);
    return Response.json(decodePaymentContext(data), { headers });
  } catch {
    return failure("paymentContextUnavailable", 503);
  }
}
