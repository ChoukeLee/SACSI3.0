import { canAccessPage, getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  CustomerDirectoryError,
  customerDirectoryId,
  parseCustomerDirectoryQuery,
} from "@/features/customers/customer-directory-model";
import { readSacsiCustomerDirectory } from "@/features/customers/sacsi-directory-service";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request) {
  const fail = (status: number) =>
    Response.json({ error: "CustomerDirectoryUnavailable" }, { status, headers });
  try {
    const user = await getCurrentUser();
    if (!user) return fail(401);
    if (!canAccessPage(user.role, "customers") || !hasPermission(user, "customers:read"))
      return fail(403);
    const params = new URL(request.url).searchParams;
    const allowed = [
      "projectId",
      "buildingId",
      "search",
      "filter",
      "page",
      "mode",
      "customer",
      "relationshipPage",
    ];
    if ([...params.keys()].some((key) => !allowed.includes(key) || params.getAll(key).length !== 1))
      return fail(400);
    const raw = Object.fromEntries(
      [...params.entries()].filter(
        ([key]) => !["mode", "customer", "relationshipPage"].includes(key),
      ),
    );
    const mode = params.get("mode") ?? "detail";
    const relationshipPage = Number(params.get("relationshipPage") ?? 1);
    if (
      mode !== "detail" ||
      !customerDirectoryId(params.get("customer")) ||
      !Number.isSafeInteger(relationshipPage) ||
      relationshipPage < 1 ||
      relationshipPage > 100000
    )
      return fail(400);
    const query = parseCustomerDirectoryQuery(raw);
    const result = await readSacsiCustomerDirectory(
      await createClient(),
      query,
      mode,
      params.get("customer")!,
      relationshipPage,
    );
    return Response.json(result, { headers });
  } catch (error) {
    return fail(error instanceof CustomerDirectoryError ? error.status : 503);
  }
}
