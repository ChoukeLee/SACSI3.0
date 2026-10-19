import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/supabase/fetch-all";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failure = (error: string, status: number) => Response.json({ error }, { status, headers });

type Building = { id: string; project_id: string; display_name: string; code: string };
type Unit = { id: string; unit_no: string; building_id: string };

/** Metadata only: all reads use the signed-in client and its existing RLS policies. */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return failure("authenticationRequired", 401);
    if (!hasPermission(user, "finance:write")) return failure("manualEntryPermissionDenied", 403);

    const search = new URL(request.url).searchParams;
    if (
      [...search.keys()].some(
        (key) =>
          !["projectId", "buildingId"].includes(key) ||
          search.getAll(key).length !== 1 ||
          !uuid.test(search.get(key) ?? ""),
      )
    )
      return failure("invalidManualEntryScope", 400);
    const projectId = search.get("projectId")?.toLowerCase() ?? null;
    const buildingId = search.get("buildingId")?.toLowerCase() ?? null;
    const client = await createClient();
    const buildings = await fetchAllPages<Building>((from, to) => {
      let query = client
        .from("buildings")
        .select("id,project_id,display_name,code", { count: "exact" })
        .eq("is_active", true);
      if (projectId) query = query.eq("project_id", projectId);
      if (buildingId) query = query.eq("id", buildingId);
      return query.order("id").range(from, to);
    }, "manual entry buildings");
    // A missing or RLS-hidden requested scope must not silently fall back to all buildings.
    if ((projectId || buildingId) && !buildings.length)
      return failure("manualEntryScopeNotFound", 404);
    if (
      buildings.some(
        (building) =>
          !uuid.test(building.id) ||
          !uuid.test(building.project_id) ||
          (projectId && building.project_id !== projectId) ||
          (buildingId && building.id !== buildingId),
      ) ||
      new Set(buildings.map((building) => building.id)).size !== buildings.length
    )
      return failure("manualEntryOptionsUnavailable", 503);

    // Without an explicitly selected building, return the small authorized catalog only.
    // Never fetch every unit merely because the manual entry drawer was opened.
    const units = buildingId
      ? await fetchAllPages<Unit>(
          (from, to) =>
            client
              .from("units")
              .select("id,unit_no,building_id", { count: "exact" })
              .eq("building_id", buildingId)
              .order("id")
              .range(from, to),
          "manual entry units",
        )
      : [];
    if (
      units.some((unit) => !uuid.test(unit.id) || unit.building_id !== buildingId) ||
      new Set(units.map((unit) => unit.id)).size !== units.length
    )
      return failure("manualEntryOptionsUnavailable", 503);
    return Response.json({ scope: { projectId, buildingId }, buildings, units }, { headers });
  } catch {
    return failure("manualEntryOptionsUnavailable", 503);
  }
}
