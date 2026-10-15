import "server-only";
import { initialWorkspace } from "@/features/contracts/workspace-service";
import type { LeaseContractRow } from "@/types/database";
export async function loadLeaseWorkspace(locale: "zh" | "fr", project?: string) {
  const workspace = await initialWorkspace("lease", locale, project);
  return { ...workspace, contracts: workspace.contracts as LeaseContractRow[], workspace };
}
