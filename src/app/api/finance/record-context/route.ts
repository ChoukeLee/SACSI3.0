import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseFinanceRecordContextQuery } from "@/features/finance/finance-record-context";
import {
  FinanceRecordContextReadError,
  readFinanceRecordContext,
} from "@/features/finance/finance-record-context-read";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const failure = (error: string, status: number) => Response.json({ error }, { status, headers });
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return failure("authenticationRequired", 401);
    if (!hasPermission(user, "finance:read"))
      return failure("financeRecordContextPermissionDenied", 403);
    let query;
    try {
      query = parseFinanceRecordContextQuery(new URL(request.url).searchParams);
    } catch {
      return failure("invalidFinanceRecordContext", 400);
    }
    const context = await readFinanceRecordContext(await createClient(), query);
    return Response.json(context, { headers });
  } catch (error) {
    if (error instanceof FinanceRecordContextReadError) return failure(error.message, error.status);
    return failure("financeRecordContextUnavailable", 503);
  }
}
