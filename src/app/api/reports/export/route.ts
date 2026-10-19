import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { decodeReportResult } from "@/features/reports/report-data";
import { parseReportQuery, reportCsv, reportFinanceFilters } from "@/features/reports/report-read";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
const failure = (message: string, status: number) =>
  new Response(message, { status, headers: privateHeaders });

export async function GET(request: Request) {
  try {
    return await exportReport(request);
  } catch {
    return failure("Export unavailable", 503);
  }
}

async function exportReport(request: Request) {
  const user = await getCurrentUser();
  if (!hasPermission(user, "finance:export")) return failure("Forbidden", 403);
  let query;
  let locale: "zh" | "fr";
  try {
    const search = new URL(request.url).searchParams;
    if ([...search.keys()].some((key) => search.getAll(key).length > 1))
      throw new Error("Duplicate report filter");
    const requestedLocale = search.get("locale") || "zh";
    if (requestedLocale !== "zh" && requestedLocale !== "fr") throw new Error("Invalid locale");
    locale = requestedLocale;
    query = parseReportQuery(Object.fromEntries(search));
    if (!query.projectId) throw new Error("Report project required");
  } catch {
    return failure("Invalid report filter", 400);
  }

  const supabase = await createClient();
  const project = await supabase
    .from("projects")
    .select("id")
    .eq("id", query.projectId)
    .eq("is_active", true)
    .maybeSingle();
  if (project.error) return failure("Export unavailable", 503);
  if (!project.data) return failure("Forbidden", 403);
  const { data, error } = await supabase.rpc("finance_read_rpc", {
    p_kind: query.kind,
    p_filters: reportFinanceFilters(query),
    p_page: 1,
    p_export: true,
  });
  if (error?.code === "42501") return failure("Forbidden", 403);
  if (error?.message === "exportTooLarge") return failure("Export too large", 413);
  if (error) return failure("Export unavailable", 503);
  try {
    const result = decodeReportResult(data);
    if (result.kind !== query.kind || result.rows.length !== result.total)
      throw new Error("Incomplete report export");
    const period =
      query.kind === "ledger" ? query.month : `current-${new Date().toISOString().slice(0, 10)}`;
    return new Response(reportCsv(result, locale), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="reports-${query.projectId}-${query.kind}-${period}.csv"`,
        ...privateHeaders,
      },
    });
  } catch {
    return failure("Export unavailable", 503);
  }
}
