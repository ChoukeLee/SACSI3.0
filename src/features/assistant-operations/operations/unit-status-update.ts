import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { hasPermission, type CurrentUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { createDraftId, extractRoomNumbers, findDailyBookingsForRooms, findUnitsByRoomNumbers, nowIso } from "../utils";
import type {
  AssistantOperationDraft,
  AssistantOperationDraftInput,
  AssistantOperationExecutionResult,
  AssistantOperationHandler,
  AssistantOperationValidation,
} from "../types";

type TargetUnitStatus = "maintenance" | "locked" | "available";

const UNIT_STATUS_TERMS = /维修|锁房|锁定|封房|解锁|解除锁定|恢复空闲|恢复可用|maintenance|locked|lock|unlock|available|disponible/i;

function targetStatusFromMessage(message: string): TargetUnitStatus | undefined {
  if (/解锁|解除锁定|恢复空闲|恢复可用|available|disponible|unlock/i.test(message)) return "available";
  if (/锁房|锁定|封房|locked|lock/i.test(message)) return "locked";
  if (/维修|maintenance/i.test(message)) return "maintenance";
  return undefined;
}

export const unitStatusUpdateOperation: AssistantOperationHandler = {
  action: "unit_status_update",
  match(input) {
    return UNIT_STATUS_TERMS.test(input.message) && extractRoomNumbers(input.message).length > 0;
  },
  async buildDraft(input: AssistantOperationDraftInput): Promise<AssistantOperationDraft> {
    const roomNumbers = extractRoomNumbers(input.message);
    const targetStatus = targetStatusFromMessage(input.message);
    const units = await findUnitsByRoomNumbers(roomNumbers);
    const unitMap = new Map(units.map((unit) => [unit.unit_no, unit]));
    const bookings = await findDailyBookingsForRooms(roomNumbers);
    const activeByRoom = new Map<string, (typeof bookings)[number]>();
    for (const booking of bookings) {
      if (!activeByRoom.has(booking.units.unit_no) && ["pending_review", "confirmed", "checked_in"].includes(booking.status)) {
        activeByRoom.set(booking.units.unit_no, booking);
      }
    }
    const missing: string[] = [];
    if (roomNumbers.length === 0) missing.push("roomNumbers");
    if (!targetStatus) missing.push("target_unit_status");
    const warnings: string[] = [];
    const changes = roomNumbers.flatMap((roomNo) => {
      const unit = unitMap.get(roomNo);
      if (!unit) {
        warnings.push(`${roomNo}: unit not found`);
        return [];
      }
      const active = activeByRoom.get(roomNo);
      if (active && targetStatus !== "available") {
        warnings.push(`${roomNo}: active daily booking ${active.id} exists`);
      }
      return [{
        table: "units",
        type: "update" as const,
        entityId: unit.id,
        label: `Room ${roomNo}`,
        before: { status: unit.status },
        after: { status: targetStatus ?? null },
      }];
    });
    const executable = missing.length === 0 && warnings.length === 0 && changes.length > 0;
    const statusLabel = targetStatus ?? "-";
    return {
      id: createDraftId(["unit_status_update", roomNumbers, targetStatus]),
      action: "unit_status_update",
      summary: input.locale === "zh" ? `将 ${roomNumbers.join("、") || "-"} 房态更新为 ${statusLabel}` : `Mettre ${roomNumbers.join(", ") || "-"} en ${statusLabel}`,
      riskLevel: executable ? (targetStatus === "available" ? "medium" : "high") : "blocked",
      requiresConfirmation: true,
      executable,
      locale: input.locale,
      originalMessage: input.message,
      roomNumbers,
      changes,
      missing: [...new Set(missing)],
      warnings,
      permissions: ["units:write"],
      metadata: { targetStatus },
      createdAt: nowIso(),
    };
  },
  async validate(draft: AssistantOperationDraft, user: CurrentUser): Promise<AssistantOperationValidation> {
    const missing = [...draft.missing];
    const warnings = [...draft.warnings];
    if (!hasPermission(user, "units:write")) missing.push("permission:units:write");
    if (!draft.metadata.targetStatus) missing.push("target_unit_status");
    if (draft.changes.length === 0) missing.push("unit_id");
    const ok = missing.length === 0 && warnings.length === 0;
    return {
      ok,
      riskLevel: ok ? (draft.metadata.targetStatus === "available" ? "medium" : "high") : "blocked",
      missing: [...new Set(missing)],
      warnings: [...new Set(warnings)],
      changes: draft.changes,
    };
  },
  async execute(draft: AssistantOperationDraft, user: CurrentUser): Promise<AssistantOperationExecutionResult> {
    const validation = await this.validate(draft, user);
    if (!validation.ok) return { success: false, action: "unit_status_update", message: "Draft validation failed.", affectedRecords: [], metadata: { validation } };
    const supabase = await createClient();
    const affectedRecords = [];
    for (const change of draft.changes) {
      const targetStatus = String(change.after?.status ?? "");
      if (!change.entityId || !targetStatus) continue;
      const { error } = await supabase.from("units").update({ status: targetStatus }).eq("id", change.entityId);
      if (error) return { success: false, action: "unit_status_update", message: error.message, affectedRecords };
      await writeAuditLog({
        action: "unit_status_update",
        entityType: "unit",
        entityId: change.entityId,
        metadata: { original_message: draft.originalMessage, before: change.before, after: change.after },
      });
      affectedRecords.push(change);
    }
    revalidatePath("/"); revalidatePath("/fr");
    revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
    revalidatePath("/front-desk"); revalidatePath("/fr/front-desk");
    revalidatePath("/units"); revalidatePath("/fr/units");
    revalidatePath("/management"); revalidatePath("/fr/management");
    return {
      success: true,
      action: "unit_status_update",
      message: draft.locale === "zh" ? "房态已更新。" : "Statut de chambre mis à jour.",
      auditAction: "unit_status_update",
      affectedRecords,
    };
  },
};
