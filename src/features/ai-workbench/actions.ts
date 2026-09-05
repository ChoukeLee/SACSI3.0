"use server";

import { hasPermission, requireAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { statusDisplayLabel } from "@/lib/display-labels";
import { completeCleaning } from "@/features/daily-rentals/actions";
import type { Locale } from "@/lib/i18n";
import { parseWorkbenchAction } from "./action-parser";
import { buildCleaningCompletionDraft } from "./action-draft-service";
import { parseWorkbenchIntent } from "./intent-parser";
import { classifyWorkbenchIntentWithModel } from "./model-classifier";
import { executeWorkbenchQuery } from "./query-service";
import type { WorkbenchActionState, WorkbenchActionResult, WorkbenchIntent } from "./types";

function tr(locale: Locale, zh: string, fr: string) {
  return locale === "fr" ? fr : zh;
}

function readLocale(formData: FormData): Locale {
  return String(formData.get("locale") ?? "") === "fr" ? "fr" : "zh";
}

function todayInAbidjan() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Abidjan",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function abidjanTimeText(locale: Locale, iso: string) {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "zh-CN", {
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
  const locale = readLocale(formData);
  if (query.length < 2) return { status: "error", result: null, error: tr(locale, "请输入要查询的问题。", "Saisissez votre question.") };
  if (query.length > 500) return { status: "error", result: null, error: tr(locale, "问题请控制在 500 个字符以内。", "Question limitée à 500 caractères.") };

  try {
    const user = await requireAuth();
    const asOfDate = todayInAbidjan();
    const actionIntent = parseWorkbenchAction(query);
    if (actionIntent) {
      if (!hasPermission(user, "daily_rentals:write")) {
        return { status: "error", result: null, error: tr(locale, "当前账号没有修改日租业务的权限。", "Votre profil n'a pas le droit de modifier les opérations journalières.") };
      }
      const draft = await buildCleaningCompletionDraft(actionIntent, locale);
      return { status: "success", result: draft, error: null };
    }
    let intent = parseWorkbenchIntent(query, asOfDate);
    if (intent.kind === "unsupported" || intent.confidence < 0.75) {
      const classified = await classifyWorkbenchIntentWithModel({ query, asOfDate, userId: user.id }).catch(() => null);
      if (classified && classified.confidence >= 0.65) intent = classified;
    }
    if (!canRunIntent(user, intent)) {
      return { status: "error", result: null, error: tr(locale, "当前账号没有查看这类业务数据的权限。", "Votre profil n'a pas le droit de consulter ces données.") };
    }
    const result = await executeWorkbenchQuery(query, intent, locale);
    return { status: "success", result, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : tr(locale, "查询失败，请稍后重试。", "Échec de la requête, réessayez plus tard.");
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
  const locale = readLocale(formData);
  if (action !== "complete_daily_cleaning" || !taskId || !unitId || !buildingCode || !unitNo) {
    return { status: "error", result: null, error: tr(locale, "确认请求缺少必要信息，请重新提交查询生成草稿。", "Demande de confirmation incomplète ; relancez une question pour générer le brouillon.") };
  }

  try {
    const user = await requireAuth();
    if (!hasPermission(user, "daily_rentals:write")) {
      return { status: "error", result: null, error: tr(locale, "当前账号没有执行日租写操作的权限。", "Votre profil n'a pas le droit d'exécuter des écritures journalières.") };
    }

    const supabase = await createClient();

    // Re-verify the targeted task still exists, belongs to the draft unit and is pending.
    const { data: task, error: taskError } = await supabase
      .from("cleaning_tasks")
      .select("id, unit_id, is_completed, completed_at")
      .eq("id", taskId)
      .maybeSingle();
    if (taskError) throw new Error(tr(locale, `复查保洁任务失败：${taskError.message}`, `Revérification du ménage impossible : ${taskError.message}`));
    if (!task || task.unit_id !== unitId) throw new Error(tr(locale, "保洁任务已不存在或与草稿目标不一致，请重新提交查询。", "La tâche n'existe plus ou ne correspond plus au brouillon ; relancez une question."));
    if (task.is_completed) throw new Error(tr(locale, "该保洁任务已经完成，草稿已过期；请重新查询当前房态。", "Cette tâche est déjà terminée ; le brouillon est périmé, reconsultez l'état."));

    const { data: unit, error: unitError } = await supabase
      .from("units")
      .select("id, unit_no, status")
      .eq("id", unitId)
      .maybeSingle();
    if (unitError) throw new Error(tr(locale, `复查房态失败：${unitError.message}`, `Revérification de l'état impossible : ${unitError.message}`));
    if (!unit || unit.unit_no !== unitNo) throw new Error(tr(locale, "房间信息与草稿不一致，请重新提交查询。", "La chambre ne correspond plus au brouillon ; relancez une question."));

    const { data: pendingTasks, error: pendingError } = await supabase
      .from("cleaning_tasks")
      .select("id")
      .eq("unit_id", unitId)
      .eq("is_completed", false)
      .limit(2);
    if (pendingError) throw new Error(tr(locale, `复查保洁任务失败：${pendingError.message}`, `Revérification du ménage impossible : ${pendingError.message}`));
    if (!pendingTasks?.length) throw new Error(tr(locale, "该房间当前没有待完成的保洁任务，草稿已过期。", "Aucune tâche de ménage en attente ; le brouillon est périmé."));
    if (pendingTasks.length > 1) throw new Error(tr(locale, "该房间存在多条待保洁任务，请先在数据质量页核对，AI 不会自行选择。", "Plusieurs tâches en attente pour cette chambre ; vérifiez d'abord la qualité des données."));

    const result = await completeCleaning(taskId);
    if (!result.success) {
      return { status: "error", result: null, error: result.error || tr(locale, "执行保洁完成失败，请稍后重试。", "Échec de l'exécution, réessayez plus tard.") };
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
      title: tr(locale, "保洁已完成并复查", "Ménage terminé et vérifié"),
      summary: verified
        ? tr(locale, `${buildingCode} ${unitNo} 的保洁任务已标记为完成，系统已复查任务与房态。`, `Ménage de ${buildingCode} ${unitNo} marqué terminé ; état revérifié.`)
        : tr(locale, "执行返回成功，但复查未读到已完成状态，请到数据质量页人工核对。", "Exécution réussie mais la vérification ne confirme pas l'état ; vérifiez manuellement la qualité des données."),
      executedAt: afterTask?.completed_at ?? new Date().toISOString(),
      target: [
        { label: tr(locale, "楼栋", "Bâtiment"), value: buildingCode },
        { label: tr(locale, "房号", "Chambre"), value: unitNo },
        { label: tr(locale, "保洁任务", "Tâche de ménage"), value: taskId },
      ],
      verification: [
        { label: tr(locale, "任务状态", "Statut de la tâche"), value: afterTask?.is_completed ? tr(locale, "已完成", "Terminée") : tr(locale, "未确认", "Non confirmé") },
        { label: tr(locale, "完成时间", "Terminée le"), value: afterTask?.completed_at ? `${abidjanTimeText(locale, afterTask.completed_at)}${locale === "fr" ? " (Abidjan)" : "（阿比让）"}` : "—" },
        { label: tr(locale, "当前房态", "État actuel"), value: statusDisplayLabel(afterUnit?.status ?? unit.status, locale) },
        { label: tr(locale, "操作方式", "Mode d'exécution"), value: tr(locale, "当前登录身份 · 日租原子 RPC · 已写审计", "Session connectée · RPC atomique journalier · audit écrit") },
      ],
      warnings: verified ? [] : [tr(locale, "执行结果未通过复查，请勿重复确认；请先核对任务与房态。", "Vérification non concluante ; ne reconfirmez pas, contrôlez d'abord la tâche et l'état.")],
    };
    return { status: "success", result: outcome, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : tr(locale, "确认执行失败，请稍后重试。", "Échec de la confirmation, réessayez plus tard.");
    return { status: "error", result: null, error: message };
  }
}
