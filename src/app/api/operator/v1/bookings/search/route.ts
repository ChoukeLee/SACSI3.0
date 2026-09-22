import { authenticateOperatorRequest } from "@/features/business-actions/operator-request-auth";
import { operatorAuthFailure } from "@/features/business-actions/operator-auth-failure";
import { confirmationReply as reply } from "@/features/business-actions/operator-confirmation-http";
import { describeBookingCandidates, parseBookingSearch, type BookingCandidateRow } from "@/features/business-actions/operator-booking-search";

export async function POST(request: Request) {
  const auth = await authenticateOperatorRequest(request);
  if (!auth.authenticated) { const failure = operatorAuthFailure(auth.reason); return reply(failure.body, failure.status); }
  let input;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 8192) return reply({ code: "request_too_large" }, 413);
    input = parseBookingSearch(JSON.parse(text));
  } catch { return reply({ code: "invalid_booking_search" }, 400); }
  try {
    const permission = await auth.supabase.rpc("can_execute_operator_action", { p_action_name: "query_daily_booking", p_risk_level: "L0" });
    if (permission.error) return reply({ code: "authorization_unavailable" }, 503);
    if (permission.data !== true) return reply({ code: "action_forbidden" }, 403);
    // Always use the authenticated client's RLS; never an administrative client.
    const units = await auth.supabase.from("units").select("id,code,unit_no,building:buildings!inner(code)")
      .eq("building.code", input.buildingCode).eq("unit_no", input.unitNo).limit(2);
    if (units.error) return reply({ code: "booking_search_unavailable" }, 503);
    if (!units.data?.length) return reply({ status: "not_found", candidates: [], executionAllowed: false }, 200);
    if (units.data.length !== 1) return reply({ code: "ambiguous_unit" }, 409);
    let query = auth.supabase.from("daily_bookings")
      .select("id,guest_name,customer:customers!daily_bookings_customer_id_fkey(name),status,check_in,check_out,actual_check_out,checkout_mode,total_amount_xof,final_amount_xof,prepaid_amount_xof,notes,updated_at")
      .eq("unit_id", units.data[0].id);
    if (input.checkInFrom) query = query.gte("check_in", input.checkInFrom);
    if (input.checkInTo) query = query.lte("check_in", input.checkInTo);
    const result = await query.order("check_in", { ascending: false }).order("id", { ascending: false }).limit(201);
    if (result.error || !result.data) return reply({ code: "booking_search_unavailable" }, 503);
    const data = describeBookingCandidates(result.data.slice(0, 200) as unknown as BookingCandidateRow[], input, result.data.length > 200, new Date().toISOString().slice(0, 10));
    return reply({ ...data, unit: units.data[0], asOf: new Date().toISOString() }, 200);
  } catch { return reply({ code: "booking_search_unavailable" }, 503); }
}
