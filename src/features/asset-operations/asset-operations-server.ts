import "server-only";

import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import type { AssetOperationsData } from "./asset-operations-model";

export async function fetchAssetOperations(
  input: { projectId?: string } = {},
): Promise<AssetOperationsData> {
  await requireRole("admin", "boss", "finance");
  const supabase = await createClient();
  let projectId = input.projectId;
  if (!projectId) {
    const project = await supabase.from("projects").select("id").eq("code", "SACSI").single();
    if (project.error || !project.data?.id) throw new Error("AssetOperationsProjectUnavailable");
    projectId = project.data.id as string;
  }
  const result = await supabase.rpc("asset_operations_read_rpc", { p_project_id: projectId });
  if (result.error) {
    if (result.error.code === "PGRST202" || result.error.code === "42883")
      throw new Error("AssetOperationsMigrationRequired");
    throw new Error("AssetOperationsReadUnavailable");
  }
  if (
    !result.data ||
    result.data.projectId !== projectId ||
    !Array.isArray(result.data.assets) ||
    !Array.isArray(result.data.entries) ||
    typeof result.data.canWrite !== "boolean"
  )
    throw new Error("AssetOperationsReadUnavailable");
  const sourceKeys = await fetchAllPages<{ id: string; source_key: string }>(
    (from, to) =>
      supabase
        .from("asset_operation_assets")
        .select("id,source_key", { count: "exact" })
        .eq("project_id", projectId)
        .order("id")
        .range(from, to),
    "asset operation source identities",
  );
  const keys = new Map(sourceKeys.map((row) => [row.id, row.source_key]));
  const data = result.data as AssetOperationsData;
  if (data.assets.some((asset) => !keys.has(asset.id)))
    throw new Error("AssetOperationsReadUnavailable");
  return {
    ...data,
    assets: data.assets.map((asset) => ({ ...asset, sourceKey: keys.get(asset.id)! })),
  };
}
