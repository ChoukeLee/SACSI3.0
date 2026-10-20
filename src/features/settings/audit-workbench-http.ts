import "server-only";
import { getCurrentUser } from "@/lib/auth";
import { AuditWorkbenchReadError, parseAuditWorkbenchQuery } from "./audit-workbench-model";

export const auditWorkbenchHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export async function requireAuditWorkbenchAccess() {
  const user = await getCurrentUser();
  if (!user)
    return Response.json(
      { error: "authenticationRequired" },
      { status: 401, headers: auditWorkbenchHeaders },
    );
  if (user.role !== "admin" && user.role !== "boss")
    return Response.json(
      { error: "auditWorkbenchPermissionDenied" },
      { status: 403, headers: auditWorkbenchHeaders },
    );
  return null;
}
export function auditWorkbenchHttpQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  const input: Record<string, unknown> = {};
  for (const [key, value] of params) {
    if (Object.hasOwn(input, key)) throw new AuditWorkbenchReadError(400);
    input[key] = value;
  }
  return parseAuditWorkbenchQuery(input);
}
export function auditWorkbenchHttpError(error: unknown) {
  const known = error instanceof AuditWorkbenchReadError ? error : new AuditWorkbenchReadError();
  return Response.json(
    { error: known.message },
    { status: known.status, headers: auditWorkbenchHeaders },
  );
}
