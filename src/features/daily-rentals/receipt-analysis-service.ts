import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { composeReceiptAnalysis, parseReceiptQuery } from "./receipt-analysis-query";
import { decodeReceiptRead, ReceiptReadError } from "./receipt-read-model";
export { decodeReceiptRead, ReceiptReadError } from "./receipt-read-model";
const unavailable = () => new ReceiptReadError("receiptHistoryUnavailable");
export async function readReceiptAnalysis(
  client: Pick<SupabaseClient, "rpc">,
  query: ReturnType<typeof parseReceiptQuery>,
) {
  const { data, error } = await client.rpc("daily_receipts_read_rpc", {
    p_input: query.input,
    p_page: query.exporting ? 1 : query.filters.page,
    p_export: query.exporting,
  });
  if (error) {
    if (error.code === "42501") throw new ReceiptReadError("receiptPermissionDenied", 403);
    if (error.message === "dailyReceiptsExportTooLarge")
      throw new ReceiptReadError("receiptExportTooLarge", 413);
    if (["invalidDailyReceiptsFilter", "invalidDailyReceiptsDateRange"].includes(error.message))
      throw new ReceiptReadError("invalidReceiptFilter", 400);
    throw unavailable();
  }
  const result = decodeReceiptRead(data);
  if (
    (!query.exporting && result.rows.length > 50) ||
    (query.exporting && result.rows.length !== result.total)
  )
    throw unavailable();
  return composeReceiptAnalysis(result, query);
}
