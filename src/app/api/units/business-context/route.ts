import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { unitWorkbenchUuid } from "@/features/units/unit-workbench-model";
import {
  readUnitBusinessContext,
  UnitBusinessContextError,
} from "@/features/units/unit-business-context-read";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const fail = (status: number) =>
  Response.json({ error: "UnitBusinessContextUnavailable" }, { status, headers });
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return fail(401);
    if (!["admin", "finance", "boss", "rental_sales"].includes(user.role)) return fail(403);
    const params = new URL(request.url).searchParams;
    const id = params.get("unit") ?? "";
    const page = params.get("page") ?? "1";
    if (
      [...params.keys()].some(
        (key) =>
          !["unit", "page", "project", "building"].includes(key) || params.getAll(key).length !== 1,
      ) ||
      !unitWorkbenchUuid.test(id) ||
      !/^[1-9]\d{0,4}$/.test(page)
    )
      return fail(400);
    for (const key of ["project", "building"])
      if (params.has(key) && !unitWorkbenchUuid.test(params.get(key)!)) return fail(400);
    const data = await readUnitBusinessContext(await createClient(), id, Number(page), {
      project: params.get("project") ?? undefined,
      building: params.get("building") ?? undefined,
    });
    return Response.json(data, { headers });
  } catch (error) {
    return fail(error instanceof UnitBusinessContextError ? error.status : 503);
  }
}
