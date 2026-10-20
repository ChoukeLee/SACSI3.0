import { createClient } from "@/lib/supabase/server";
import {
  auditWorkbenchCsv,
  readAuditWorkbenchExport,
} from "@/features/settings/audit-workbench-service";
import {
  auditWorkbenchHeaders,
  auditWorkbenchHttpError,
  auditWorkbenchHttpQuery,
  requireAuditWorkbenchAccess,
} from "@/features/settings/audit-workbench-http";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const denied = await requireAuditWorkbenchAccess();
    if (denied) return denied;
    const result = await readAuditWorkbenchExport(
      await createClient(),
      auditWorkbenchHttpQuery(request),
    );
    return new Response(auditWorkbenchCsv(result.rows), {
      headers: {
        ...auditWorkbenchHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="sacsi-audit.csv"',
        "X-Audit-Row-Count": String(result.total),
      },
    });
  } catch (error) {
    return auditWorkbenchHttpError(error);
  }
}
