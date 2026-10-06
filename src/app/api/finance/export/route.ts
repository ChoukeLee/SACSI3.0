import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  financeCsv,
  parseFinanceRead,
  type FinanceReadResult,
} from "@/features/finance/finance-read";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!hasPermission(user, "finance:export")) return new Response("Forbidden", { status: 403 });
  let query;
  try {
    const search = new URL(request.url).searchParams;
    if ([...search.keys()].some((key) => search.getAll(key).length > 1))
      throw new Error("Duplicate filter");
    query = parseFinanceRead(Object.fromEntries(search));
  } catch {
    return new Response("Invalid filter", { status: 400 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_read_rpc", {
    p_kind: query.kind,
    p_filters: query.filters,
    p_page: 1,
    p_export: true,
  });
  if (error || !data) return new Response("Export unavailable", { status: 503 });
  return new Response(financeCsv(data as FinanceReadResult), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="finance-${query.kind}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
