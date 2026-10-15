import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readDailyReceiptReport } from "@/features/reports/daily-receipt-report-service";
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
  role: string,
) {
  const today = businessDate();
  const [{ data, error }, receipts] = await Promise.all([
    client.rpc("daily_calendar_window_rpc", {
      p_building_id: query.buildingId,
      p_from: query.from,
      p_to: query.to,
    }),
    ["admin", "finance", "boss"].includes(role)
      ? readDailyReceiptReport(
          client,
          `${today.slice(0, 7)}-01`,
          today,
          query.buildingId,
          true,
        ).catch(() => null)
      : Promise.resolve(null),
  ]);
  if (error)
    throw new CalendarWindowError(
      error.code === "42501" ? "calendarPermissionDenied" : "calendarWindowUnavailable",
      error.code === "42501" ? 403 : 503,
    );
  const window = decodeCalendarWindow(data, query);
  if (window.today !== today) throw new CalendarWindowError();
  return {
    ...window,
    dailyUnits: sortUnits(window.dailyUnits),
    unitLookupUnits: sortUnits(window.unitLookupUnits),
    financeSnapshot: {
      today: window.today,
      month: window.today.slice(0, 7),
      cash: receipts?.summary ?? null,
      includedPaymentIds:
        receipts?.rows.filter((r) => r.kind !== "excluded").map((r) => r.id) ?? [],
      currentOutstanding: window.currentOutstanding,
      monthSettled: window.monthSettled,
    },
  };
}
