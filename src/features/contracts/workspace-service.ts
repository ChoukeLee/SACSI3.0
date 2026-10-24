import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
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
import { decodeCimacLeaseCollectionProjection } from "./cimac-contract-allocation";
import {
  defaultLeaseScope,
  leaseScopeCookieName,
  validatedLeaseScope,
} from "./lease-scope-preference";
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
  let decoded = decodeWorkspace(data, kind, query, mode, contractId);
  if (kind === "lease" && mode === "detail" && contractId) {
    const contract = decoded.contracts.find((row) => row.id === contractId);
    if (!contract) throw new WorkspaceReadError();
    const projection = await client.rpc("cimac_lease_collection_projection_rpc", {
      p_contract_id: contractId,
    });
    if (projection.error || !projection.data) throw new WorkspaceReadError();
    const attributed = decodeCimacLeaseCollectionProjection(
      projection.data,
      contractId,
      contract.customer_id,
    );
    const existing = new Set(decoded.payments.map((payment) => payment.id));
    if (attributed.some((payment) => existing.has(payment.id))) throw new WorkspaceReadError();
    decoded = decodeWorkspace(
      {
        ...decoded,
        payments: [...decoded.payments, ...attributed],
        paymentCount: decoded.paymentCount + attributed.length,
      },
      kind,
      query,
      mode,
      contractId,
    );
  }
  return kind === "lease"
    ? { ...decoded, units: decoded.units.map(projectLeaseWorkspaceUnit) }
    : decoded;
}
export async function initialWorkspace(
  kind: WorkspaceKind,
  locale: "zh" | "fr",
  requestedProject?: string,
  viewerId?: string,
  requestedBuilding?: string,
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
  const linkedBuilding = requestedBuilding
    ? buildings.find(
        (b) => b.id === requestedBuilding && (!projectId || b.project_id === projectId),
      )
    : undefined;
  if (requestedBuilding && !linkedBuilding) throw new WorkspaceReadError(403);
  const first = buildings.find((b) => b.code === "SACSI11") ?? buildings[0];
  const cookieName = kind === "lease" ? leaseScopeCookieName(viewerId) : undefined;
  const stored = cookieName ? (await cookies()).get(cookieName) : undefined;
  const preferred = validatedLeaseScope(buildings, stored?.value);
  const leaseScope = preferred ?? defaultLeaseScope(buildings);
  const query = parseWorkspaceQuery({
    projectId:
      projectId ?? linkedBuilding?.project_id ?? (kind === "lease" ? leaseScope.projectId : ""),
    buildingId:
      linkedBuilding?.id ??
      (projectId ? "" : kind === "lease" ? leaseScope.buildingId : (first?.id ?? "")),
    locale,
  });
  const result = await readWorkspace(client, kind, query);
  return {
    ...result,
    buildings,
    scopePreference: cookieName
      ? { cookieName, serverResolved: !!stored || !!projectId }
      : undefined,
  };
}
