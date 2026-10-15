import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { businessDate } from "@/features/daily-rentals/receipt-analysis-query";
import {
  decodeReceiptRead,
  ReceiptReadError,
} from "@/features/daily-rentals/receipt-analysis-service";
import { monthRange } from "./report-aggregators";

/** Uses the same database classification as receipt history, never raw payment sums. */
export async function readDailyReceiptReport(
  client: Pick<SupabaseClient, "rpc">,
  from: string,
  to: string,
  buildingId: string | null = null,
  completeDetails = false,
) {
  const { data, error } = await client.rpc("daily_receipts_read_rpc", {
    p_input: {
      dateFrom: from,
      dateTo: to,
      previousFrom: from,
      previousTo: to,
      yearFrom: from,
      yearTo: to,
      trendFrom: from,
      trendTo: to,
      buildingId,
      query: "",
      method: "all",
      kind: "all",
    },
    p_page: 1,
    p_export: completeDetails,
  });
  if (error) throw new ReceiptReadError("receiptHistoryUnavailable");
  const result = decodeReceiptRead(data);
  if (completeDetails && result.rows.length !== result.total)
    throw new ReceiptReadError("receiptHistoryUnavailable");
  return result;
}

/** Complete monthly server aggregates; each RPC is bounded to at most 12 months. */
export async function loadDailyReceiptMonths(
  client: Pick<SupabaseClient, "rpc">,
  now = new Date(),
) {
  const today = businessDate(now);
  const current = today.slice(0, 7);
  const recentMonths = monthRange(current, 12);
  const recent = await readDailyReceiptReport(client, `${recentMonths[0]}-01`, today);
  const firstMonth = recent.coverage.firstDate?.slice(0, 7);
  if (!firstMonth || firstMonth >= recentMonths[0]) return recent.trend;
  const firstYear = Number(firstMonth.slice(0, 4));
  const endYear = Number(recentMonths[0].slice(0, 4));
  const earlier = await Promise.all(
    Array.from({ length: endYear - firstYear + 1 }, async (_, index) => {
      const year = firstYear + index;
      return readDailyReceiptReport(client, `${year}-01-01`, `${year}-12-31`);
    }),
  );
  return [
    ...earlier
      .flatMap((item) => item.trend)
      .filter((item) => item.month >= firstMonth && item.month < recentMonths[0]),
    ...recent.trend,
  ];
}
