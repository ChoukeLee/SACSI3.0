import { authenticateOperatorRequest } from "@/features/business-actions/operator-request-auth";
import { operatorAuthFailure } from "@/features/business-actions/operator-auth-failure";
import { confirmationReply as reply } from "@/features/business-actions/operator-confirmation-http";
import { buildDailyChangePlan, parseDailyChangeRequest } from "@/features/business-actions/operator-daily-plan";

export async function POST(request: Request) {
  const auth = await authenticateOperatorRequest(request);
  if (!auth.authenticated) { const failure = operatorAuthFailure(auth.reason); return reply(failure.body, failure.status); }
  let input;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 8192) return reply({ code: "request_too_large" }, 413);
    input = parseDailyChangeRequest(JSON.parse(text));
  } catch { return reply({ code: "invalid_daily_plan" }, 400); }
  try {
    const permission = await auth.supabase.rpc("can_execute_operator_action", { p_action_name: "query_daily_booking", p_risk_level: "L0" });
    if (permission.error) return reply({ code: "authorization_unavailable" }, 503);
    if (permission.data !== true) return reply({ code: "action_forbidden" }, 403);
    // Guard the legacy snapshot RPC with the caller's RLS-scoped booking read.
    const visible = await auth.supabase.from("daily_bookings").select("id,unit_id").eq("id", input.bookingId).maybeSingle();
    if (visible.error) return reply({ code: "daily_plan_unavailable" }, 503);
    if (!visible.data) return reply({ code: "booking_not_found" }, 404);
    const access = await auth.supabase.rpc("can_access_unit", { target_unit_id: visible.data.unit_id });
    if (access.error) return reply({ code: "authorization_unavailable" }, 503);
    if (access.data !== true) return reply({ code: "action_forbidden" }, 403);
    const result = await auth.supabase.rpc("operator_query_daily_booking", { p_booking_id: input.bookingId, p_building_code: null, p_unit_no: null });
    if (result.error || result.data?.status !== "found") return reply({ code: "daily_plan_unavailable" }, 503);
    return reply(buildDailyChangePlan(input, result.data.snapshot, new Date().toISOString().slice(0, 10)), 200);
  } catch { return reply({ code: "daily_plan_unavailable" }, 503); }
}
