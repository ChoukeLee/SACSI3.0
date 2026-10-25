import "server-only";
import { createClient } from "@/lib/supabase/server";
import { readWorkspace } from "@/features/contracts/workspace-service";
import { parseWorkspaceQuery, WorkspaceReadError } from "@/features/contracts/workspace-model";
import type { LeaseContractRow } from "@/types/database";
import { validLeaseCollectionId } from "./lease-collection-links";

/** Reuse the complete, RLS-scoped detail read; never collect from a list snapshot. */
export async function readLeaseCollectionContext(
  contractId: string,
  locale: "zh" | "fr",
  workArea?: "sacsi" | "cimac",
) {
  if (!validLeaseCollectionId(contractId)) throw new WorkspaceReadError(400);
  const client = await createClient();
  // Both collection endpoints are installed in the same atomic migration. A
  // random, nonexistent receipt is a read-only capability check, never a write.
  const readiness = (async () => {
    try {
      const probe = await client.rpc("lease_collection_receipt_read_rpc", {
        p_request_id: crypto.randomUUID(),
      });
      return probe.error?.code === "P0001" && probe.error.message === "leaseCollectionNotFound";
    } catch {
      return false;
    }
  })();
  const [data, writeReady] = await Promise.all([
    readWorkspace(
      client,
      "lease",
      parseWorkspaceQuery({ locale, status: "all" }),
      "detail",
      contractId,
    ),
    readiness,
  ]);
  const contract = data.contracts.find((row) => row.id === contractId) as
    LeaseContractRow | undefined;
  const unit = data.units.find((row) => row.id === contract?.unit_id);
  const customer = data.customers.find((row) => row.id === contract?.customer_id);
  const building = data.buildings.find((row) => row.id === unit?.building_id);
  if (!contract || !unit || !customer || !building) throw new WorkspaceReadError(403);
  if (workArea && (building.project?.code === "CIMAC") !== (workArea === "cimac"))
    throw new WorkspaceReadError(403);
  if (
    data.receivableCount !== data.receivables.length ||
    data.receivables.some(
      (row) => row.source_type !== "lease_contract" || row.source_id !== contract.id,
    )
  )
    throw new WorkspaceReadError();
  return {
    contract,
    unit,
    customer,
    building,
    receivables: data.receivables,
    today: data.today,
    writeReady,
  };
}
