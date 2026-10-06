"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth";
import type { UnitStatus } from "@/types/domain";

const manualStatuses: UnitStatus[] = ["available", "maintenance", "locked"];

export interface UnitAuditLogEntry {
  id: string;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export async function getUnitAuditLogs(unitId: string): Promise<UnitAuditLogEntry[]> {
  const user = await getCurrentUser();
  if (!user || !["admin", "finance", "boss", "rental_sales"].includes(user.role)) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, action, metadata, created_at")
    .eq("entity_type", "unit")
    .eq("entity_id", unitId)
    .eq("action", "status_change")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Failed to load unit audit logs:", error);
    return [];
  }

  return (data ?? []).map((log) => ({
    id: log.id,
    action: log.action,
    metadata: (log.metadata ?? {}) as Record<string, unknown>,
    created_at: log.created_at,
  }));
}

export async function updateUnitStatus(
  unitId: string,
  status: UnitStatus,
  expectedUpdatedAt: string,
): Promise<{ success: boolean; error?: string }> {
  requirePermission(await getCurrentUser(), "units:write");
  if (!manualStatuses.includes(status)) return { success: false, error: "请使用对应业务流程修改入住、保洁或合同状态。" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_unit_condition_rpc", {
    p_unit_id: unitId,
    p_condition: status === "available" ? "normal" : status,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) {
    const messages: Record<string,string> = {
      unitRecordChanged: "房源已变化，请刷新后重试。",
      occupiedUnitRequiresBusinessWorkflow: "正在入住或出租，请通过业务流程处理。",
      unitReadinessRequiresVerification: "建设或入住条件尚未核验，解除维修不能直接证明可出租。",
    };
    return { success: false, error: messages[error.message] ?? "修改未完成，请核对权限与房源状态。" };
  }
  revalidatePath("/units"); revalidatePath("/fr/units");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath(`/units/${unitId}`); revalidatePath(`/fr/units/${unitId}`);
  return { success: true };
}
