import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { businessDate } from "./receipt-analysis-query";
import { sortUnits } from "@/lib/utils";
import {
  CalendarWindowError,
  decodeCalendarWindow,
  type CalendarWindowQuery,
} from "./calendar-window-model";

export async function readCalendarWindow(
  client: Pick<SupabaseClient, "rpc">,
  query: CalendarWindowQuery,
  _role?: string,
) {
  const today = businessDate();
  const { data, error } = await client.rpc("daily_calendar_context_rpc", {
    p_building_id: query.buildingId,
    p_from: query.from,
    p_to: query.to,
  });
  if (error)
    throw new CalendarWindowError(
      error.code === "42501" ? "calendarPermissionDenied" : "calendarWindowUnavailable",
      error.code === "42501" ? 403 : 503,
    );
  const window = decodeCalendarWindow(data, query);
  if (window.today !== today || !Array.isArray(window.customers)) throw new CalendarWindowError();
  return {
    ...window,
    dailyUnits: sortUnits(window.dailyUnits),
    unitLookupUnits: sortUnits(window.unitLookupUnits),
    financeSnapshot: {
      today: window.today,
      month: window.today.slice(0, 7),
      cash: null,
      currentOutstanding: window.currentOutstanding,
      monthSettled: window.monthSettled,
    },
  };
}
