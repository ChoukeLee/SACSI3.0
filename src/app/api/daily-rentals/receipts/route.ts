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
import { createRequestTiming } from "@/lib/performance";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request) {
  const timing = createRequestTiming();
  const started = performance.now();
  const finish = (response: Response) => {
    timing.record("total", performance.now() - started);
    return timing.response(response);
  };
  const respond = (value: unknown, status = 200) => {
    const serialization = performance.now();
    const response = Response.json(value, { status, headers });
    timing.record("response", performance.now() - serialization);
    return finish(response);
  };
  try {
    const user = await timing.measure("authorization", () => getCurrentUser());
    if (!user) return respond({ error: "authenticationRequired" }, 401);
    if (!hasPermission(user, "finance:read"))
      return respond({ error: "receiptPermissionDenied" }, 403);
    const search = new URL(request.url).searchParams;
    if ([...search.keys()].some((key) => search.getAll(key).length !== 1))
      throw new ReceiptQueryError("invalidReceiptFilter");
    const query = parseReceiptQuery(Object.fromEntries(search));
    if (query.exporting && !hasPermission(user, "finance:export"))
      return respond({ error: "receiptPermissionDenied" }, 403);
    const result = await timing.measure("database", async () =>
      readReceiptAnalysis(await createClient(), query),
    );
    if (query.exporting)
      return finish(
        new Response(receiptCsv(result, query.locale), {
          headers: {
            ...headers,
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="daily-receipts-${query.periods.current.from}-${query.periods.current.to}.csv"`,
          },
        }),
      );
    return respond(result);
  } catch (error) {
    if (error instanceof ReceiptQueryError) return respond({ error: error.message }, 400);
    if (error instanceof ReceiptReadError) return respond({ error: error.message }, error.status);
    return respond({ error: "receiptHistoryUnavailable" }, 500);
  }
}
