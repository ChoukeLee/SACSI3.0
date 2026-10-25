import "server-only";
import { readWorkspace } from "@/features/contracts/workspace-service";
import {
  parseWorkspaceQuery,
  WorkspaceReadError,
  type WorkspaceData,
} from "@/features/contracts/workspace-model";
import { resolveContractProjectLink } from "@/features/contracts/project-link";
import { createClient } from "@/lib/supabase/server";
import type { LeaseBuilding } from "@/features/leases/project-scope";
import { SALE_UUID } from "./sale-workbench-model";
import type { SaleContractRow } from "@/types/database";
export type SaleSearchParams = Record<string, string | string[] | undefined>;

export async function loadSaleWorkspace(
  locale: "zh" | "fr",
  input: SaleSearchParams | string = {},
) {
  const raw = typeof input === "string" ? { project: input } : input;
  for (const key of [
    "project",
    "building",
    "q",
    "status",
    "page",
    "sort",
    "direction",
    "contract",
    "returnTo",
  ]) {
    if (Array.isArray(raw[key])) throw new WorkspaceReadError(400);
  }
  const params = raw as Record<string, string | undefined>;
  if (params.contract && !SALE_UUID.test(params.contract)) throw new WorkspaceReadError(400);
  const client = await createClient();
  const { data, error } = await client
    .from("buildings")
    .select(
      "id,code,display_name,project_id,project:projects!inner(id,code,display_name,allows_sale,is_active)",
    )
    .eq("is_active", true)
    .eq("project.is_active", true)
    .order("code");
  if (error || !data) throw new WorkspaceReadError();
  const buildings = data.map((building) => ({
    ...building,
    project: Array.isArray(building.project) ? building.project[0] : building.project,
  })) as unknown as (LeaseBuilding & {
    project: NonNullable<LeaseBuilding["project"]> & { allows_sale: boolean };
  })[];
  const sacsiBuildings = buildings.filter((building) => building.project?.code !== "CIMAC");
  let projectId = resolveContractProjectLink(sacsiBuildings, params.project);
  let linkedBuilding: string | undefined;
  if (params.contract && !projectId && !params.building) {
    // A legacy bare contract bookmark must resolve its real unit, not broaden
    // to every project or silently fall back to the first SACSI building.
    const contract = await client
      .from("sale_contracts")
      .select("unit_id")
      .eq("id", params.contract)
      .maybeSingle();
    if (contract.error || !contract.data?.unit_id)
      throw new WorkspaceReadError(contract.error ? 503 : 403);
    const unit = await client
      .from("units")
      .select("building_id")
      .eq("id", contract.data.unit_id)
      .maybeSingle();
    if (unit.error || !unit.data?.building_id) throw new WorkspaceReadError(unit.error ? 503 : 403);
    const actualBuildingId = unit.data.building_id;
    const actualBuilding = sacsiBuildings.find((building) => building.id === actualBuildingId);
    if (!actualBuilding?.project_id) throw new WorkspaceReadError(403);
    projectId = actualBuilding.project_id;
    linkedBuilding = actualBuilding.id;
  }
  const scopedBuildings = sacsiBuildings.filter(
    (building) => !projectId || building.project_id === projectId,
  );
  if (params.building && !scopedBuildings.some((building) => building.id === params.building))
    throw new WorkspaceReadError(403);
  const noSaleProject =
    !!projectId &&
    scopedBuildings.length > 0 &&
    scopedBuildings.every((building) => !building.project.allows_sale);
  const first =
    sacsiBuildings.find(
      (building) => building.project.allows_sale && building.code === "SACSI11",
    ) ?? sacsiBuildings.find((building) => building.project.allows_sale);
  if (!projectId && !params.building && !first) throw new WorkspaceReadError(403);
  const query = parseWorkspaceQuery({
    projectId: projectId ?? "",
    buildingId: params.building ?? linkedBuilding ?? (projectId ? "" : (first?.id ?? "")),
    search: params.q ?? "",
    status: params.status ?? "current",
    page: params.page ?? "1",
    sort: params.sort ?? "unit",
    direction: params.direction ?? "asc",
    locale,
  });
  if (
    params.building &&
    !sacsiBuildings.find((building) => building.id === params.building)?.project.allows_sale &&
    !noSaleProject
  )
    throw new WorkspaceReadError(403);
  const workspace: WorkspaceData | undefined = noSaleProject
    ? undefined
    : await readWorkspace(client, "sale", query);
  return {
    contracts: (workspace?.contracts ?? []) as SaleContractRow[],
    schedules: workspace?.schedules ?? [],
    units: workspace?.units ?? [],
    customers: workspace?.customers ?? [],
    payments: workspace?.payments ?? [],
    receivables: workspace?.receivables ?? [],
    buildings: sacsiBuildings,
    workspace: workspace ? { ...workspace, buildings: sacsiBuildings } : undefined,
    initialProject: projectId,
    initialContract: params.contract,
    returnTo: params.returnTo,
    noSaleProject,
  };
}
