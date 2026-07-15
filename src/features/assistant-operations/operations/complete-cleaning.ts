import { createClient } from "@/lib/supabase/server";
import { hasPermission, type CurrentUser } from "@/lib/auth";
import { completeCleaning } from "@/features/daily-rentals/actions";
import { allowCompleteCleaning } from "@/features/daily-rentals/daily-rental-policy";
import { createDraftId, extractRoomNumbers, findUnitsByRoomNumbers, nowIso } from "../utils";
import type {
  AssistantOperationDraft,
  AssistantOperationDraftInput,
  AssistantOperationExecutionResult,
  AssistantOperationHandler,
  AssistantOperationValidation,
} from "../types";

const CLEANING_TERMS = /清洁|保洁|打扫|menage|ménage|clean/i;
const COMPLETION_TERMS = /完成|完毕|好了|done|fait|termin/i;

async function findPendingCleaningTasks(roomNumbers: string[]) {
  if (roomNumbers.length === 0) return [];
  const supabase = await createClient();
  const units = await findUnitsByRoomNumbers(roomNumbers);
  const unitIds = units.map((unit) => unit.id);
  if (unitIds.length === 0) return [];
  const { data, error } = await supabase
    .from("cleaning_tasks")
    .select("id, unit_id, daily_booking_id, is_completed, completed_at, created_at, units!inner(id, unit_no, status)")
    .in("unit_id", unitIds)
    .order("created_at", { ascending: false });

  if (error) throw error;
  type RawTask = {
    id: string;
    unit_id: string;
    daily_booking_id: string | null;
    is_completed: boolean;
    completed_at: string | null;
    created_at: string;
    units: { id: string; unit_no: string; status: string } | { id: string; unit_no: string; status: string }[];
  };

  return ((data ?? []) as RawTask[]).map((task) => ({
    ...task,
    units: Array.isArray(task.units) ? task.units[0] : task.units,
  })).filter((task) => task.units) as Array<{
    id: string;
    unit_id: string;
    daily_booking_id: string | null;
    is_completed: boolean;
    completed_at: string | null;
    created_at: string;
    units: { id: string; unit_no: string; status: string };
  }>;
}

export const completeCleaningOperation: AssistantOperationHandler = {
  action: "complete_cleaning",

  match(input) {
    return CLEANING_TERMS.test(input.message) && COMPLETION_TERMS.test(input.message);
  },

  async buildDraft(input: AssistantOperationDraftInput): Promise<AssistantOperationDraft> {
    const roomNumbers = extractRoomNumbers(input.message);
    const tasks = await findPendingCleaningTasks(roomNumbers);
    const latestByRoom = new Map<string, (typeof tasks)[number]>();
    for (const task of tasks) {
      const roomNo = task.units.unit_no;
      if (!latestByRoom.has(roomNo)) latestByRoom.set(roomNo, task);
    }

    const missing = roomNumbers.length === 0 ? ["roomNumbers"] : [];
    const warnings: string[] = [];
    const changes = roomNumbers.flatMap((roomNo) => {
      const task = latestByRoom.get(roomNo);
      if (!task) {
        warnings.push(`${roomNo}: no pending cleaning task found`);
        return [];
      }
      const policy = allowCompleteCleaning(task);
      if (!policy.allowed) warnings.push(`${roomNo}: ${policy.reason}`);
      return [{
        table: "cleaning_tasks",
        type: "update" as const,
        entityId: task.id,
        label: `房间 ${roomNo}`,
        before: { is_completed: task.is_completed, completed_at: task.completed_at },
        after: { is_completed: true },
      }];
    });

    if (roomNumbers.length > 0 && changes.length === 0) missing.push("cleaning_task_id");

    return {
      id: createDraftId(["complete_cleaning", roomNumbers, changes.map((change) => change.entityId)]),
      action: "complete_cleaning",
      summary: input.locale === "zh"
        ? `标记 ${roomNumbers.join("、") || "-"} 清洁完成`
        : `Marquer le ménage terminé pour ${roomNumbers.join(", ") || "-"}`,
      riskLevel: missing.length > 0 ? "blocked" : "low",
      requiresConfirmation: true,
      executable: missing.length === 0 && warnings.length === 0,
      locale: input.locale,
      originalMessage: input.message,
      roomNumbers,
      changes,
      missing,
      warnings,
      permissions: ["daily_rentals:write"],
      metadata: {
        operation: "complete_cleaning",
        taskIds: changes.map((change) => change.entityId).filter(Boolean),
      },
      createdAt: nowIso(),
    };
  },

  async validate(draft: AssistantOperationDraft, user: CurrentUser): Promise<AssistantOperationValidation> {
    const missing = [...draft.missing];
    const warnings = [...draft.warnings];

    if (!hasPermission(user, "daily_rentals:write")) {
      missing.push("permission:daily_rentals:write");
    }

    const taskIds = draft.changes.map((change) => change.entityId).filter(Boolean) as string[];
    if (taskIds.length === 0) missing.push("cleaning_task_id");

    const tasks = await findPendingCleaningTasks(draft.roomNumbers);
    const taskMap = new Map(tasks.map((task) => [task.id, task]));
    for (const taskId of taskIds) {
      const task = taskMap.get(taskId);
      const policy = allowCompleteCleaning(task ?? null);
      if (!policy.allowed) warnings.push(`${taskId}: ${policy.reason}`);
    }

    const ok = missing.length === 0 && warnings.length === 0;
    return {
      ok,
      riskLevel: ok ? "low" : "blocked",
      missing: [...new Set(missing)],
      warnings: [...new Set(warnings)],
      changes: draft.changes,
    };
  },

  async execute(draft: AssistantOperationDraft, user: CurrentUser): Promise<AssistantOperationExecutionResult> {
    const validation = await this.validate(draft, user);
    if (!validation.ok) {
      return {
        success: false,
        action: "complete_cleaning",
        message: draft.locale === "zh" ? "草稿未通过校验，不能执行。" : "Le brouillon n'est pas valide.",
        affectedRecords: [],
        metadata: { validation },
      };
    }

    const affectedRecords = [];
    for (const change of draft.changes) {
      if (!change.entityId) continue;
      const result = await completeCleaning(change.entityId);
      if (!result.success) {
        return {
          success: false,
          action: "complete_cleaning",
          message: result.error ?? "completeCleaningFailed",
          affectedRecords,
          metadata: { failedTaskId: change.entityId },
        };
      }
      affectedRecords.push({
        ...change,
        after: { ...change.after, unit_status: result.unitStatus },
      });
    }

    return {
      success: true,
      action: "complete_cleaning",
      message: draft.locale === "zh" ? "清洁状态已更新。" : "Ménage mis à jour.",
      auditAction: "complete_cleaning",
      affectedRecords,
      metadata: {
        originalMessage: draft.originalMessage,
        roomNumbers: draft.roomNumbers,
      },
    };
  },
};
