"use server";

import { hasPermission, requireAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { statusDisplayLabel } from "@/lib/display-labels";
import { completeCleaning } from "@/features/daily-rentals/actions";
import { parseWorkbenchAction } from "./action-parser";
import { buildCleaningCompletionDraft } from "./action-draft-service";
import { parseWorkbenchIntent } from "./intent-parser";
import { classifyWorkbenchIntentWithModel } from "./model-classifier";
import { executeWorkbenchQuery } from "./query-service";
import type { WorkbenchActionState, WorkbenchActionResult, WorkbenchIntent } from "./types";

function todayInAbidjan() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Abidjan",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function abidjanTimeText(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Africa/Abidjan",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function canRunIntent(user: Awaited<ReturnType<typeof requireAuth>>, intent: WorkbenchIntent) {
  if (intent.kind === "unsupported") return true;
  if (intent.kind === "daily_status" || intent.domain === "daily") return hasPermission(user, "daily_rentals:read");
  if (intent.domain === "lease") return hasPermission(user, "leases:read");
  if (intent.domain === "sale") return hasPermission(user, "sales:read");
  if (intent.kind === "unit_snapshot") return hasPermission(user, "units:read");
  return hasPermission(user, "finance:read");
}

export async function askWorkbench(
  _previousState: WorkbenchActionState,
  formData: FormData,
): Promise<WorkbenchActionState> {
  const query = String(formData.get("query") ?? "").trim();
  if (query.length < 2) return { status: "error", result: null, error: "请输入要查询的问题。" };
  if (query.length > 500) return { status: "error", result: null, error: "问题请控制在 500 个字符以内。" };

  try {
    const user = await requireAuth();
    const asOfDate = todayInAbidjan();
    const actionIntent = parseWorkbenchAction(query);
    if (actionIntent) {
      if (!hasPermission(user, "daily_rentals:write")) {
        return { status: "error", result: null, error: "当前账号没有修改日租业务的权限。" };
      }
      const draft = await buildCleaningCompletionDraft(actionIntent);
      return { status: "success", result: draft, error: null };
    }
    let intent = parseWorkbenchIntent(query, asOfDate);
    if (intent.kind === "unsupported" || intent.confidence < 0.75) {
      const classified = await classifyWorkbenchIntentWithModel({ query, asOfDate, userId: user.id }).catch(() => null);
      if (classified && classified.confidence >= 0.65) intent = classified;
    }
    if (!canRunIntent(user, intent)) {
      return { status: "error", result: null, error: "当前账号没有查看这类业务数据的权限。" };
    }
    const result = await executeWorkbenchQuery(query, intent);
    return { status: "success", result, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "查询失败，请稍后重试。";
    return { status: "error", result: null, error: message };
  }
}

/**
 * Human-confirmed execution of an L1 workbench draft.
 *
 * Contract (kept aligned with docs/ai-assistant-command-requirement.md):
 * - The draft only carries stable identity; every fact is re-checked here.
 * - Writes go through the same atomic daily-rental RPC as the manual page
 *   (completeCleaning -> daily_complete_cleaning_rpc) under the logged-in
 *   session; no service-role client and no direct table writes.
 * - After the write the effect is re-queried from the database and reported.
 */
export async function confirmWorkbenchAction(
  _previousState: WorkbenchActionState,
  formData: FormData,
): Promise<WorkbenchActionState> {
  const action = String(formData.get("execution_action") ?? "");
  const taskId = String(formData.get("task_id") ?? "").trim();
  const unitId = String(formData.get("unit_id") ?? "").trim();
  const buildingCode = String(formData.get("building_code") ?? "").trim();
  const unitNo = String(formData.get("unit_no") ?? "").trim();
  if (action !== "complete_daily_cleaning" || !taskId || !unitId || !buildingCode || !unitNo) {
    return { status: "error", result: null, error: "确认请求缺少必要信息，请重新提交查询生成草稿。" };
  }

  try {
    const user = await requireAuth();
    if (!hasPermission(user, "daily_rentals:write")) {
      return { status: "error", result: null, error: "当前账号没有执行日租写操作的权限。" };
    }

    const supabase = await createClient();

    // Re-verify the targeted task still exists, belongs to the draft unit and is pending.
    const { data: task, error: taskError } = await supabase
      .from("cleaning_tasks")
      .select("id, unit_id, is_completed, completed_at")
      .eq("id", taskId)
      .maybeSingle();
    if (taskError) throw new Error(`复查保洁任务失败：${taskError.message}`);
    if (!task || task.unit_id !== unitId) throw new Error("保洁任务已不存在或与草稿目标不一致，请重新提交查询。");
    if (task.is_completed) throw new Error("该保洁任务已经完成，草稿已过期；请重新查询当前房态。");

    const { data: unit, error: unitError } = await supabase
      .from("units")
      .select("id, unit_no, status")
      .eq("id", unitId)
      .maybeSingle();
    if (unitError) throw new Error(`复查房态失败：${unitError.message}`);
    if (!unit || unit.unit_no !== unitNo) throw new Error("房间信息与草稿不一致，请重新提交查询。");

    const { data: pendingTasks, error: pendingError } = await supabase
      .from("cleaning_tasks")
      .select("id")
      .eq("unit_id", unitId)
      .eq("is_completed", false)
      .limit(2);
    if (pendingError) throw new Error(`复查保洁任务失败：${pendingError.message}`);
    if (!pendingTasks?.length) throw new Error("该房间当前没有待完成的保洁任务，草稿已过期。");
    if (pendingTasks.length > 1) throw new Error("该房间存在多条待保洁任务，请先在数据质量页核对，AI 不会自行选择。");

    const result = await completeCleaning(taskId);
    if (!result.success) {
      return { status: "error", result: null, error: result.error || "执行保洁完成失败，请稍后重试。" };
    }

    // Re-query to verify the persisted effect from the database, not just the RPC reply.
    const { data: afterTask } = await supabase
      .from("cleaning_tasks")
      .select("id, is_completed, completed_at")
      .eq("id", taskId)
      .maybeSingle();
    const { data: afterUnit } = await supabase
      .from("units")
      .select("status")
      .eq("id", unitId)
      .maybeSingle();

    const verified = Boolean(afterTask?.is_completed);
    const outcome: WorkbenchActionResult = {
      kind: "action_result",
      action: "complete_daily_cleaning",
      risk: "L1",
      title: "保洁已完成并复查",
      summary: verified
        ? `${buildingCode} ${unitNo} 的保洁任务已标记为完成，系统已复查任务与房态。`
        : "执行返回成功，但复查未读到已完成状态，请到数据质量页人工核对。",
      executedAt: afterTask?.completed_at ?? new Date().toISOString(),
      target: [
        { label: "楼栋", value: buildingCode },
        { label: "房号", value: unitNo },
        { label: "保洁任务", value: taskId },
      ],
      verification: [
        { label: "任务状态", value: afterTask?.is_completed ? "已完成" : "未确认" },
        { label: "完成时间", value: afterTask?.completed_at ? `${abidjanTimeText(afterTask.completed_at)}（阿比让）` : "—" },
        { label: "当前房态", value: statusDisplayLabel(afterUnit?.status ?? unit.status, "zh") },
        { label: "操作方式", value: "当前登录身份 · 日租原子 RPC · 已写审计" },
      ],
      warnings: verified ? [] : ["执行结果未通过复查，请勿重复确认；请先核对任务与房态。"],
    };
    return { status: "success", result: outcome, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "确认执行失败，请稍后重试。";
    return { status: "error", result: null, error: message };
  }
}
