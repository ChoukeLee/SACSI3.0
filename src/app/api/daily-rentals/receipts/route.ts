import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  parseReceiptQuery,
  ReceiptQueryError,
  receiptCsv,
} from "@/features/daily-rentals/receipt-analysis-query";
import {
  readReceiptAnalysis,
  ReceiptReadError,
} from "@/features/daily-rentals/receipt-analysis-service";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "authenticationRequired" }, { status: 401, headers });
  if (!hasPermission(user, "finance:read"))
    return Response.json({ error: "receiptPermissionDenied" }, { status: 403, headers });
  try {
    const search = new URL(request.url).searchParams;
    if ([...search.keys()].some((key) => search.getAll(key).length !== 1))
      throw new ReceiptQueryError("invalidReceiptFilter");
    const query = parseReceiptQuery(Object.fromEntries(search));
    if (query.exporting && !hasPermission(user, "finance:export"))
      return Response.json({ error: "receiptPermissionDenied" }, { status: 403, headers });
    const result = await readReceiptAnalysis(await createClient(), query);
    if (query.exporting)
      return new Response(receiptCsv(result, query.locale), {
        headers: {
          ...headers,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="daily-receipts-${query.periods.current.from}-${query.periods.current.to}.csv"`,
        },
      });
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof ReceiptQueryError)
      return Response.json({ error: error.message }, { status: 400, headers });
    if (error instanceof ReceiptReadError)
      return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "receiptHistoryUnavailable" }, { status: 503, headers });
  }
}
