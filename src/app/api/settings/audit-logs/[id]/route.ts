import { createClient } from "@/lib/supabase/server";
import { readAuditWorkbenchDetail } from "@/features/settings/audit-workbench-service";
import {
  auditWorkbenchHeaders,
  auditWorkbenchHttpError,
  requireAuditWorkbenchAccess,
} from "@/features/settings/audit-workbench-http";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const denied = await requireAuditWorkbenchAccess();
    if (denied) return denied;
    const { id } = await context.params;
    return Response.json(await readAuditWorkbenchDetail(await createClient(), id), {
      headers: auditWorkbenchHeaders,
    });
  } catch (error) {
    return auditWorkbenchHttpError(error);
  }
}
