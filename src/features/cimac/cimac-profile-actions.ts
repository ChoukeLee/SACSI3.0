"use server";

import { getCurrentUser, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  createCustomer,
  updateCustomer,
  type CustomerFormInput,
} from "@/features/customers/actions";
import { updateUnitStatus } from "@/features/units/actions";
import type { UnitStatus } from "@/types/domain";
import { readCimacCustomer, readCimacWorkspaceScope } from "./cimac-workspace-read";
import { parseCimacWorkspaceQuery } from "./cimac-workspace-query";
import { canAccessCimacWorkspace } from "./cimac-workspace-access";
import { readCimacOperationUnit } from "./cimac-profile-service";
import { revalidatePath } from "next/cache";
import { cimacWorkspaceId } from "./cimac-workspace-query";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import type { CimacCustomerLinkInput } from "./cimac-customer-management-model";
import { validCimacCustomerLink } from "./cimac-customer-management-model";

async function context(permission: string) {
  const user = await getCurrentUser();
  requirePermission(user, permission);
  if (!user || !canAccessCimacWorkspace(user.role)) throw new Error("CimacOperationUnavailable");
  const client = await createClient();
  const scope = await readCimacWorkspaceScope(client);
  return { client, scope, user };
}

/** A shared identity only. Park membership begins when an explicit business is saved. */
export async function createCimacCustomerIdentity(
  input: CustomerFormInput,
): Promise<{ success: boolean; data?: { id: string }; error?: string }> {
  await context("customers:write");
  const result = await createCustomer(input);
  return result.success && result.data
    ? { success: true, data: { id: result.data.id } }
    : { success: false, error: result.error };
}

export async function updateCimacCustomerProfile(
  id: string,
  expectedUpdatedAt: string,
  input: CustomerFormInput,
): Promise<{ success: boolean; data?: { id: string }; error?: string }> {
  const { client, scope } = await context("customers:write");
  const current = await readCimacCustomer(
    client,
    scope,
    id,
    parseCimacWorkspaceQuery({}, "customers"),
  );
  if (typeof expectedUpdatedAt !== "string" || current.profile.updated_at !== expectedUpdatedAt)
    return { success: false, error: "客户资料已变化，请刷新核对后重试。" };
  const result = await updateCustomer(id, input, expectedUpdatedAt);
  // The legacy action returns the storage row, including document numbers. Never forward it.
  return result.success && result.data
    ? { success: true, data: { id: result.data.id } }
    : { success: false, error: result.error };
}

export async function updateCimacAssetCondition(
  id: string,
  status: UnitStatus,
  expectedUpdatedAt: string,
): Promise<{ success: boolean; error?: string }> {
  const { client, scope } = await context("units:write");
  const current = await readCimacOperationUnit(client, scope, id);
  if (typeof expectedUpdatedAt !== "string" || current.updated_at !== expectedUpdatedAt)
    return { success: false, error: "资产资料已变化，请刷新核对后重试。" };
  // Existing RPC remains authoritative for condition, occupancy, audit and optimistic locking.
  return updateUnitStatus(id, status, expectedUpdatedAt);
}

/** These controls edit project membership/documentary links, never lease or payment facts. */
export async function manageCimacCustomer(
  requestId: string,
  id: string,
  expectedUpdatedAt: string,
  membershipStatus: "current" | "archived",
  link?: CimacCustomerLinkInput,
): Promise<{ success: boolean; error?: string }> {
  const { client, scope, user } = await context("customers:write");
  if (user.role !== "admin") return { success: false, error: "仅管理员可维护园区名册和铺位关联。" };
  cimacWorkspaceId(requestId);
  cimacWorkspaceId(id);
  if (
    !["current", "archived"].includes(membershipStatus) ||
    (link !== undefined && !validCimacCustomerLink(link))
  )
    return { success: false, error: "请核对关联铺位、资料来源、签署状态和真实签署日期。" };
  // Resolve a completed request before profile CAS. A lost response must remain safely replayable.
  const prior = await client
    .from("audit_logs")
    .select("actor_id,metadata")
    .eq("entity_type", "cimac_customer_profile_sync")
    .eq("entity_id", requestId)
    .maybeSingle();
  if (prior.error) return { success: false, error: "暂时无法核实保存状态，请保留当前操作并重试。" };
  let input: Record<string, unknown>;
  if (prior.data) {
    const metadata = prior.data.metadata;
    const row = metadata?.input?.rows?.[0];
    const linkFields = [
      "unitId",
      "brand",
      "relationshipKind",
      "signingState",
      "signedDate",
      "sourceReference",
    ];
    const linkValues = (rows: Record<string, unknown>[]) =>
      rows.map((r) => linkFields.map((key) => r[key]));
    if (
      prior.data.actor_id !== user.id ||
      metadata?.project_id !== scope.project.id ||
      metadata?.input?.rows?.length !== 1 ||
      row?.customerId !== id ||
      row?.rowKey !== id ||
      row?.expectedUpdatedAt !== expectedUpdatedAt ||
      row?.membershipStatus !== membershipStatus ||
      row?.sourceReference !== "CIMAC客户名册维护" ||
      !Array.isArray(row?.links) ||
      JSON.stringify(linkValues(row.links)) !==
        JSON.stringify(linkValues(link ? [{ ...link }] : []))
    )
      return { success: false, error: "操作编号已被其他请求使用，请刷新核对。" };
    input = metadata.input;
  } else {
    const current = await readCimacCustomer(
      client,
      scope,
      id,
      parseCimacWorkspaceQuery({}, "customers"),
    );
    if (current.profile.updated_at !== expectedUpdatedAt)
      return { success: false, error: "客户资料已变化，请刷新核对后重试。" };
    if (link) await readCimacOperationUnit(client, scope, link.unitId);
    input = {
      rows: [
        {
          rowKey: id,
          customerId: id,
          expectedUpdatedAt,
          name: current.profile.name,
          phone: current.profile.phone,
          notes: current.profile.notes,
          membershipStatus,
          sourceReference: "CIMAC客户名册维护",
          links: link ? [link] : [],
        },
      ],
    };
  }
  const { data, error } = await client.rpc("cimac_customer_profiles_sync_rpc", {
    p_request_id: requestId,
    p_input: input,
  });
  if (error)
    return {
      success: false,
      error: error.message?.includes("ArchiveActive")
        ? "客户仍有当前业务，不能归档。请先核对真实业务状态。"
        : error.code === "42501"
          ? "当前账号无权维护园区名册。"
          : "保存失败或资料已变化，请刷新核对后重试。",
    };
  if (
    !data ||
    data.success !== true ||
    data.requestId !== requestId ||
    data.projectId !== scope.project.id ||
    !Array.isArray(data.rows) ||
    data.rows.length !== 1 ||
    data.rows[0].customerId !== id ||
    data.rows[0].membershipStatus !== membershipStatus
  )
    return { success: false, error: "未能核实保存结果，请刷新核对。" };
  revalidatePath("/cimac", "layout");
  revalidatePath("/fr/cimac", "layout");
  return { success: true };
}

export async function readCimacCustomerLinkOptions(): Promise<{
  success: boolean;
  data?: { id: string; label: string }[];
  error?: string;
}> {
  const { client, scope, user } = await context("customers:write");
  if (user.role !== "admin") return { success: false, error: "仅管理员可维护铺位关联。" };
  if (!scope.buildings.length) return { success: true, data: [] };
  const rows = await fetchAllPages<{ id: string; unit_no: string; building_id: string }>(
    (from, to) =>
      client
        .from("units")
        .select("id,unit_no,building_id", { count: "exact" })
        .in(
          "building_id",
          scope.buildings.map((b) => b.id),
        )
        .order("unit_no")
        .order("id")
        .range(from, to),
    "CIMAC link options",
  );
  return {
    success: true,
    data: rows.map((row) => ({
      id: row.id,
      label: `${scope.buildings.find((b) => b.id === row.building_id)?.name ?? ""} · ${row.unit_no}`,
    })),
  };
}
