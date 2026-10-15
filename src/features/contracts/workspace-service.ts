import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  decodeWorkspace,
  parseWorkspaceQuery,
  WorkspaceReadError,
  type WorkspaceKind,
  type WorkspaceMode,
  type WorkspaceQuery,
} from "./workspace-model";
import { resolveContractProjectLink } from "./project-link";
import type { LeaseBuilding } from "@/features/leases/project-scope";
import { projectLeaseWorkspaceUnit } from "@/features/leases/lease-unit-projection";
export async function readWorkspace(
  client: Pick<SupabaseClient, "rpc">,
  kind: WorkspaceKind,
  query: WorkspaceQuery,
  mode: WorkspaceMode = "list",
  contractId?: string,
) {
  const { data, error } = await client.rpc("contract_workspace_read_rpc", {
    p_kind: kind,
    p_input: query,
    p_mode: mode,
    p_contract_id: contractId ?? null,
  });
  if (error)
    throw new WorkspaceReadError(error.code === "42501" ? 403 : error.code === "22023" ? 400 : 503);
  const decoded = decodeWorkspace(data, kind, query, mode, contractId);
  return kind === "lease"
    ? { ...decoded, units: decoded.units.map(projectLeaseWorkspaceUnit) }
    : decoded;
}
export async function initialWorkspace(
  kind: WorkspaceKind,
  locale: "zh" | "fr",
  requestedProject?: string,
) {
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
  const buildings = data
    .map((b) => ({ ...b, project: Array.isArray(b.project) ? b.project[0] : b.project }))
    .filter((b) => kind === "lease" || b.project?.allows_sale) as unknown as LeaseBuilding[];
  const projectId = resolveContractProjectLink(buildings, requestedProject);
  const first = buildings.find((b) => b.code === "SACSI11") ?? buildings[0];
  const query = parseWorkspaceQuery({
    projectId: projectId ?? (kind === "lease" ? (first?.project_id ?? "") : ""),
    buildingId: projectId ? "" : (first?.id ?? ""),
    locale,
  });
  const result = await readWorkspace(client, kind, query);
  return { ...result, buildings };
}
