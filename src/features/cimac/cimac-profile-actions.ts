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

async function context(permission: string) {
  const user = await getCurrentUser();
  requirePermission(user, permission);
  if (!user || !canAccessCimacWorkspace(user.role)) throw new Error("CimacOperationUnavailable");
  const client = await createClient();
  const scope = await readCimacWorkspaceScope(client);
  return { client, scope };
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
