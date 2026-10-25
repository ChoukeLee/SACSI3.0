import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeaseBuilding } from "@/features/leases/project-scope";
import { WorkspaceReadError, type WorkspaceQuery } from "./workspace-model";

export type ContractWorkArea = "sacsi" | "cimac";

/** Workspace isolation is additional to, never a replacement for, the user's RLS. */
export function contractBuildingsForWorkArea(
  buildings: LeaseBuilding[],
  workArea: ContractWorkArea,
) {
  return buildings.filter((building) =>
    workArea === "cimac" ? building.project?.code === "CIMAC" : building.project?.code !== "CIMAC",
  );
}

export async function assertContractWorkspaceBoundary(
  client: Pick<SupabaseClient, "from">,
  query: WorkspaceQuery,
  workArea: ContractWorkArea,
) {
  // An unscoped read could silently mix the two businesses. Every UI request has
  // an explicit project or building, including selected-row and print reads.
  if (!query.projectId && !query.buildingId) throw new WorkspaceReadError(403);
  const result = await client
    .from("buildings")
    .select("id,code,display_name,project_id,project:projects!inner(id,code,display_name)")
    .eq("is_active", true)
    .eq("project.is_active", true)
    .order("code");
  if (result.error || !result.data) throw new WorkspaceReadError();
  const buildings = result.data.map((building) => ({
    ...building,
    project: Array.isArray(building.project) ? building.project[0] : building.project,
  })) as unknown as LeaseBuilding[];
  const allowed = contractBuildingsForWorkArea(buildings, workArea);
  const projectIds = new Set(allowed.map((building) => building.project_id));
  if (
    (workArea === "cimac" && projectIds.size !== 1) ||
    (query.projectId && !projectIds.has(query.projectId)) ||
    (query.buildingId &&
      !allowed.some(
        (building) =>
          building.id === query.buildingId &&
          (!query.projectId || building.project_id === query.projectId),
      ))
  )
    throw new WorkspaceReadError(403);
  return allowed;
}
