import "server-only";
import { initialWorkspace } from "@/features/contracts/workspace-service";
import type { LeaseContractRow } from "@/types/database";
import type { ContractWorkArea } from "@/features/contracts/workspace-boundary";
export async function loadLeaseWorkspace(
  locale: "zh" | "fr",
  project?: string,
  viewerId?: string,
  building?: string,
  workArea: ContractWorkArea = "sacsi",
) {
  const workspace = await initialWorkspace("lease", locale, project, viewerId, building, workArea);
  return { ...workspace, contracts: workspace.contracts as LeaseContractRow[], workspace };
}
