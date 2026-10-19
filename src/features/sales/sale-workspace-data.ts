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
  const projectId = resolveContractProjectLink(buildings, params.project);
  const scopedBuildings = buildings.filter(
    (building) => !projectId || building.project_id === projectId,
  );
  if (params.building && !scopedBuildings.some((building) => building.id === params.building))
    throw new WorkspaceReadError(403);
  const noSaleProject =
    !!projectId &&
    scopedBuildings.length > 0 &&
    scopedBuildings.every((building) => !building.project.allows_sale);
  const first =
    buildings.find((building) => building.project.allows_sale && building.code === "SACSI11") ??
    buildings.find((building) => building.project.allows_sale);
  const query = parseWorkspaceQuery({
    projectId: projectId ?? "",
    buildingId: params.building ?? (projectId ? "" : params.contract ? "" : (first?.id ?? "")),
    search: params.q ?? "",
    status: params.status ?? "current",
    page: params.page ?? "1",
    sort: params.sort ?? "unit",
    direction: params.direction ?? "asc",
    locale,
  });
  if (
    params.building &&
    !buildings.find((building) => building.id === params.building)?.project.allows_sale &&
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
    buildings,
    workspace: workspace ? { ...workspace, buildings } : undefined,
    initialProject: projectId,
    initialContract: params.contract,
    returnTo: params.returnTo,
    noSaleProject,
  };
}
