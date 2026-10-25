import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import type { ProfileAuditRow } from "@/features/customers/customer-profile-service";
import type { UnitRow } from "@/types/database";
import { assertCimacWorkspaceScope } from "./cimac-workspace-model";
import { cimacWorkspaceId } from "./cimac-workspace-query";
import { CimacWorkspaceReadError, type CimacWorkspaceScope } from "./cimac-workspace-types";
import { readCimacCustomer } from "./cimac-workspace-read";
import { parseCimacWorkspaceQuery } from "./cimac-workspace-query";

type Client = Pick<SupabaseClient, "from" | "rpc">;
export interface CimacProfileAttachment {
  id: string;
  storage_path: string;
  file_type: string;
  paper_archive_status: string;
  uploaded_at: string;
}
export interface CimacProfileRecords {
  auditLogs: ProfileAuditRow[];
  attachments: CimacProfileAttachment[];
}

/** The target is checked again at the write boundary, never trusted from a hidden form field. */
export async function readCimacOperationUnit(
  client: Client,
  scope: CimacWorkspaceScope,
  id: string,
): Promise<UnitRow> {
  assertCimacWorkspaceScope(scope);
  cimacWorkspaceId(id);
  if (!scope.buildings.length) throw new CimacWorkspaceReadError(404);
  const { data, error } = await client
    .from("units")
    .select("*")
    .eq("id", id)
    .in(
      "building_id",
      scope.buildings.map((b) => b.id),
    )
    .maybeSingle();
  if (error) throw new CimacWorkspaceReadError(error.code === "42501" ? 403 : 503);
  if (!data || data.id !== id || !scope.buildings.some((b) => b.id === data.building_id))
    throw new CimacWorkspaceReadError(404);
  return data as UnitRow;
}

/** Profile events concern the shared identity. Financial events remain in the scoped account. */
export async function readCimacProfileRecords(
  client: Client,
  scope: CimacWorkspaceScope,
  target: { type: "customer" | "unit"; id: string },
): Promise<CimacProfileRecords> {
  assertCimacWorkspaceScope(scope);
  cimacWorkspaceId(target.id);
  if (target.type === "unit") await readCimacOperationUnit(client, scope, target.id);
  else await readCimacCustomer(client, scope, target.id, parseCimacWorkspaceQuery({}, "customers"));
  const auditLogs = await fetchAllPages<Omit<ProfileAuditRow, "metadata">>(
    (from, to) =>
      client
        .from("audit_logs")
        .select("id,created_at,action,entity_type,entity_id,actor_id,actor_email", {
          count: "exact",
        })
        .eq("entity_type", target.type)
        .eq("entity_id", target.id)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    "CIMAC profile events",
  );
  // A global customer_id is not proof that an attachment belongs to CIMAC.
  // Only attachments with an explicit park unit are shown. Unattributed files stay untouched.
  const units =
    target.type === "unit"
      ? [{ id: target.id }]
      : scope.buildings.length
        ? await fetchAllPages<{ id: string }>(
            (from, to) =>
              client
                .from("units")
                .select("id", { count: "exact" })
                .in(
                  "building_id",
                  scope.buildings.map((b) => b.id),
                )
                .order("id")
                .range(from, to),
            "CIMAC document units",
          )
        : [];
  const attachments: CimacProfileAttachment[] = [];
  for (let offset = 0; offset < units.length; offset += 100) {
    const ids = units.slice(offset, offset + 100).map((unit) => unit.id);
    attachments.push(
      ...(await fetchAllPages<CimacProfileAttachment>((from, to) => {
        let read = client
          .from("attachments")
          .select("id,storage_path,file_type,paper_archive_status,uploaded_at", { count: "exact" })
          .in("unit_id", ids);
        if (target.type === "customer") read = read.eq("customer_id", target.id);
        return read.order("uploaded_at", { ascending: false }).order("id").range(from, to);
      }, "CIMAC explicitly attributed documents")),
    );
  }
  // Do not pass arbitrary audit metadata or whole customer records to client components.
  return {
    auditLogs: auditLogs.map((row) => ({
      id: row.id,
      created_at: row.created_at,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      actor_id: row.actor_id,
      actor_email: row.actor_email,
      metadata: null,
    })),
    attachments: attachments
      .map((row) => ({
        id: row.id,
        storage_path: row.storage_path,
        file_type: row.file_type,
        paper_archive_status: row.paper_archive_status,
        uploaded_at: row.uploaded_at,
      }))
      .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at) || a.id.localeCompare(b.id)),
  };
}
