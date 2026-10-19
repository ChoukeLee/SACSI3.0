import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cimacExportCsv, parseCimacExportQuery } from "@/features/finance/cimac-export-model";
import { CimacExportReadError, readCimacExport } from "@/features/finance/cimac-export-read";

export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
const failure = (status: number) =>
  new Response(
    status === 403 ? "Forbidden" : status === 400 ? "Invalid filter" : "Export unavailable",
    {
      status,
      headers,
    },
  );

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!hasPermission(user, "finance:export")) return failure(403);
    let query;
    try {
      query = parseCimacExportQuery(new URL(request.url).searchParams);
    } catch {
      return failure(400);
    }
    const client = await createClient();
    const bundle = await readCimacExport(client, query);
    const csv = cimacExportCsv(bundle, query);
    if (new TextEncoder().encode(csv).byteLength > 4_000_000) return failure(413);
    return new Response(csv, {
      headers: {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="cimac-${query.view}-${bundle.readAt.slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    // Never log SQL errors, amounts, customer data, query strings or cookies.
    console.error("cimac-export-unavailable");
    return failure(error instanceof CimacExportReadError ? error.status : 503);
  }
}
