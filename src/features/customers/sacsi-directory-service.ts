import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CustomerDirectoryError, type CustomerDirectoryQuery } from "./customer-directory-model";
import { readCustomerDirectory } from "./customer-directory-service";

/** SACSI's directory is not the company-wide directory or the CIMAC directory. */
export async function readSacsiCustomerDirectory(
  client: SupabaseClient,
  query: CustomerDirectoryQuery,
  mode: "list" | "detail" = "list",
  customerId?: string,
  relationshipPage = 1,
) {
  const { data: project, error } = await client
    .from("projects")
    .select("id,code")
    .eq("code", "SACSI")
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new CustomerDirectoryError(503);
  if (!project || project.code !== "SACSI") throw new CustomerDirectoryError(403);
  if (query.projectId && query.projectId !== "__unassigned__" && query.projectId !== project.id)
    throw new CustomerDirectoryError(403);
  const scoped = {
    ...query,
    projectId: query.projectId === "__unassigned__" ? query.projectId : project.id,
  };
  const result = await readCustomerDirectory(client, scoped, mode, customerId, relationshipPage);
  if (result.relationships.some((relation) => relation.projectId !== project.id))
    throw new CustomerDirectoryError(503);
  return {
    ...result,
    buildings: result.buildings.filter((building) => building.project?.id === project.id),
  };
}
