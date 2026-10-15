import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { businessDate } from "./receipt-analysis-query";
import { DAILY_BOOKING_AGENT_NAMES } from "./daily-booking-agents";
import {
  CalendarContextError,
  decodeCalendarCash,
  decodeCustomerSearch,
  type parseCustomerSearch,
} from "./calendar-context-model";

function failure(error: { code?: string }) {
  return new CalendarContextError(
    error.code === "42501" ? "calendarPermissionDenied" : "calendarContextUnavailable",
    error.code === "42501" ? 403 : 503,
  );
}
export async function readCalendarCash(client: Pick<SupabaseClient, "rpc">, buildingId: string) {
  const { data, error } = await client.rpc("daily_calendar_cash_summary_rpc", {
    p_building_id: buildingId,
  });
  if (error) throw failure(error);
  return decodeCalendarCash(data, buildingId, businessDate());
}
export async function readDailyCustomerCandidates(
  client: Pick<SupabaseClient, "rpc">,
  query: ReturnType<typeof parseCustomerSearch>,
) {
  const { data, error } = await client.rpc("daily_customer_candidates_rpc", {
    p_building_id: query.buildingId,
    p_query: query.query,
    p_page: query.page,
    p_names: [...DAILY_BOOKING_AGENT_NAMES],
  });
  if (error) throw failure(error);
  return decodeCustomerSearch(data, query);
}
