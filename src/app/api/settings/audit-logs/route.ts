import { createClient } from "@/lib/supabase/server";
import { readAuditWorkbench } from "@/features/settings/audit-workbench-service";
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
    return Response.json(
      await readAuditWorkbench(await createClient(), auditWorkbenchHttpQuery(request)),
      { headers: auditWorkbenchHeaders },
    );
  } catch (error) {
    return auditWorkbenchHttpError(error);
  }
}
