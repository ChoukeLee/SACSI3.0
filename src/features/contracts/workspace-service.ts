import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import type { PaymentRow, ReceivableRow, SalePaymentScheduleRow } from "@/types/database";
import { SALE_ROOM_PAYMENT_TYPES } from "@/features/sales/sale-room-overview-model";
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
  assertContractWorkspaceBoundary,
  contractBuildingsForWorkArea,
  type ContractWorkArea,
} from "./workspace-boundary";
import {
  defaultLeaseScope,
  leaseScopeCookieName,
  validatedLeaseScope,
} from "./lease-scope-preference";
export async function readWorkspace(
  client: Pick<SupabaseClient, "rpc"> & Partial<Pick<SupabaseClient, "from">>,
  kind: WorkspaceKind,
  query: WorkspaceQuery,
  mode: WorkspaceMode = "list",
  contractId?: string,
  workArea?: ContractWorkArea,
  roomOverview = false,
) {
  if (
    roomOverview &&
    (mode !== "context" || query.status !== "all" || query.search !== "" || query.page !== 1)
  )
    throw new WorkspaceReadError(400);
  const allowedBuildings = workArea
    ? await assertContractWorkspaceBoundary(client as Pick<SupabaseClient, "from">, query, workArea)
    : undefined;
  const { data, error } = await client.rpc("contract_workspace_read_rpc", {
    p_kind: kind,
    p_input: query,
    p_mode: mode,
    p_contract_id: contractId ?? null,
  });
  if (error)
    throw new WorkspaceReadError(error.code === "42501" ? 403 : error.code === "22023" ? 400 : 503);
  let decoded = decodeWorkspace(data, kind, query, mode, contractId);
  if (allowedBuildings) {
    const allowed = new Set(allowedBuildings.map((building) => building.id));
    if (decoded.units.some((unit) => !allowed.has(unit.building_id)))
      throw new WorkspaceReadError(403);
    decoded = {
      ...decoded,
      buildings: decoded.buildings.filter((building) => allowed.has(building.id)),
    };
  }
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
  if (roomOverview) {
    if (!client.from && decoded.contracts.length) throw new WorkspaceReadError();
    const ids = decoded.contracts.map((record) => record.id);
    const batches: string[][] = [];
    for (let index = 0; index < ids.length; index += 100)
      batches.push(ids.slice(index, index + 100));
    try {
      const bills = (
        await Promise.all(
          batches.map((batch) =>
            fetchAllPages<ReceivableRow>(
              (from, to) =>
                client.from!("receivables")
                  .select(
                    "id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,amount_native,paid_amount_native,currency,status,management_status,service_period_start,service_period_end,service_period_source,created_at,updated_at",
                    { count: "exact" },
                  )
                  .eq("source_type", `${kind}_contract`)
                  .in("source_id", batch)
                  .order("due_date")
                  .order("id")
                  .range(from, to),
              "lease room bills",
            ),
          ),
        )
      ).flat();
      const payments =
        kind === "sale"
          ? (
              await Promise.all(
                batches.map((batch) =>
                  fetchAllPages<PaymentRow>(
                    (from, to) =>
                      client.from!("payments")
                        .select("*", { count: "exact" })
                        .in("source_type", SALE_ROOM_PAYMENT_TYPES)
                        .in("source_id", batch)
                        .order("payment_date")
                        .order("id")
                        .range(from, to),
                    "sale room payments",
                  ),
                ),
              )
            ).flat()
          : undefined;
      const schedules =
        kind === "sale"
          ? (
              await Promise.all(
                batches.map((batch) =>
                  fetchAllPages<SalePaymentScheduleRow>(
                    (from, to) =>
                      client.from!("sale_payment_schedule")
                        .select("*", { count: "exact" })
                        .in("sale_contract_id", batch)
                        .order("installment_no")
                        .order("id")
                        .range(from, to),
                    "sale room schedules",
                  ),
                ),
              )
            ).flat()
          : undefined;
      decoded = decodeWorkspace(
        {
          ...decoded,
          roomReceivables: bills,
          ...(kind === "sale"
            ? {
                roomPayments: payments,
                roomSchedules: schedules,
                roomFinanceCounts: {
                  payments: payments!.length,
                  receivables: bills.length,
                  schedules: schedules!.length,
                },
              }
            : {}),
        },
        kind,
        query,
        mode,
        undefined,
        true,
      );
    } catch {
      throw new WorkspaceReadError();
    }
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
  workArea: ContractWorkArea = "sacsi",
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
  const buildings = contractBuildingsForWorkArea(
    data
      .map((b) => ({ ...b, project: Array.isArray(b.project) ? b.project[0] : b.project }))
      .filter((b) => kind === "lease" || b.project?.allows_sale) as unknown as LeaseBuilding[],
    workArea,
  );
  const cimacProjects = new Set(buildings.map((building) => building.project_id));
  if (!buildings.length) throw new WorkspaceReadError(403);
  if (workArea === "cimac" && cimacProjects.size !== 1) throw new WorkspaceReadError(403);
  let projectId: string | undefined;
  try {
    projectId = resolveContractProjectLink(
      buildings,
      requestedProject ?? (workArea === "cimac" ? "CIMAC" : undefined),
    );
  } catch {
    throw new WorkspaceReadError(403);
  }
  const linkedBuilding = requestedBuilding
    ? buildings.find(
        (b) => b.id === requestedBuilding && (!projectId || b.project_id === projectId),
      )
    : undefined;
  if (requestedBuilding && !linkedBuilding) throw new WorkspaceReadError(403);
  const first = buildings.find((b) => b.code === "SACSI11") ?? buildings[0];
  const cookieName = kind === "lease" ? leaseScopeCookieName(viewerId, workArea) : undefined;
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
