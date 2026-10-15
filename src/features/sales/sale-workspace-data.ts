import "server-only";
import { initialWorkspace } from "@/features/contracts/workspace-service";
import type { SaleContractRow } from "@/types/database";
export async function loadSaleWorkspace(locale: "zh" | "fr", project?: string) {
  const workspace = await initialWorkspace("sale", locale, project);
  return { ...workspace, contracts: workspace.contracts as SaleContractRow[], workspace };
}
