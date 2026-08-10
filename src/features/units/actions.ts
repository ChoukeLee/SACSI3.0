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
  status: UnitStatus
): Promise<{ success: boolean; error?: string }> {
  requirePermission(await getCurrentUser(), "units:write");

  if (!manualStatuses.includes(status)) {
    return {
      success: false,
      error: `Status "${status}" is driven by business modules and cannot be set manually.`,
    };
  }

  const supabase = await createClient();

  const { data: unit, error: fetchError } = await supabase
    .from("units")
    .select("id, status")
    .eq("id", unitId)
    .single();

  if (fetchError || !unit) {
    return { success: false, error: "Unit not found." };
  }

  if (unit.status === status) {
    return { success: false, error: "Unit is already in this status." };
  }

  const previousStatus = unit.status;

  const { error: updateError } = await supabase
    .from("units")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", unitId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  const { error: auditError } = await supabase.from("audit_logs").insert({
    action: "status_change",
    entity_type: "unit",
    entity_id: unitId,
    metadata: {
      previous_status: previousStatus,
      new_status: status,
      changed_manually: true,
    },
  });

  if (auditError) {
    console.error("Failed to write audit log:", auditError);
  }

  revalidatePath("/units");
  revalidatePath("/fr/units");

  return { success: true };
}
