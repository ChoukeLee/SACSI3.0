"use server";

import { hasPermission, requireAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { statusDisplayLabel } from "@/lib/display-labels";
import { completeCleaning } from "@/features/daily-rentals/actions";
import {
  addAiTextInput,
  claimAiProposalExecution,
  completeAiProposalExecution,
  confirmAiProposal,
  createAiJob,
  createAiProposal,
} from "@/features/business-actions/ai-draft-service";
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

/** Maps ai_* transition RPC failures to human copy for both locales. */
function evidenceError(locale: Locale, phaseZh: string, phaseFr: string, error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const lower = raw.toLowerCase();
  if (lower.includes("proposalexpired") || lower.includes("proposal not confirmable") || /expired/.test(lower)) {
    return tr(locale, "操作草稿已过期，请重新提交查询生成新草稿。", "Le brouillon a expiré ; relancez une question pour en générer un nouveau.");
  }
  if (lower.includes("version")) {
    return tr(locale, "业务记录在确认前已发生变化，请重新提交查询。", "Les données ont changé avant confirmation ; relancez une question.");
  }
  if (lower.includes("permissiondenied") || lower.includes("authenticationrequired")) {
    return tr(locale, "当前账号无权执行该操作。", "Votre profil n'a pas le droit d'exécuter cette opération.");
  }
  if (lower.includes("notconfirmable") || lower.includes("notexecutable") || lower.includes("notfound")) {
    return tr(locale, "操作草稿状态已变化或不存在，请重新提交查询。", "Le brouillon n'est plus valide ; relancez une question.");
  }
  if (lower.includes("requestid") || lower.includes("conflict") || lower.includes("duplicate")) {
    return tr(locale, "检测到重复或冲突请求，请重新提交查询。", "Demande dupliquée ou conflictuelle ; relancez une question.");
  }
  return tr(locale, `${phaseZh}：${raw}`, `${phaseFr} : ${raw}`);
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
      try {
        // Persist the AI evidence ledger: job -> text input -> proposed action.
        // No business record is modified at this stage.
        const job = await createAiJob({ locale, inputMode: "text" });
        const jobId = String(job.id);
        await addAiTextInput(jobId, 1, query);
        const proposal = await createAiProposal(jobId, 1, {
          action: "complete_daily_cleaning",
          target: {
            unitId: draft.execution.unitId,
            buildingId: draft.machine.buildingId,
            bookingId: draft.machine.bookingId ?? undefined,
          },
          input: { taskId: draft.execution.taskId },
          beforeSnapshot: draft.machine.beforeSnapshot,
          beforeVersions: {},
          expectedEffects: draft.machine.expectedEffects,
          warnings: draft.warnings,
          confidence: draft.confidence,
        });
        draft.execution.jobId = String(job.id);
        draft.execution.proposalId = String(proposal.id);
        draft.execution.proposalVersion = Number(proposal.version);
        return { status: "success", result: draft, error: null };
      } catch (evidenceErrorValue) {
        return {
          status: "error",
          result: null,
          error: evidenceErrorValue instanceof Error
            ? evidenceErrorValue.message
            : tr(locale, "AI 会话记录失败，请稍后重试。", "Échec d'enregistrement de la session IA, réessayez plus tard."),
        };
      }
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
 * Human-confirmed execution of an L1 workbench draft, driven by the ai_*
 * evidence ledger and the same atomic daily-rental RPC as the manual page.
 *
 * Contract (kept aligned with docs/ai-assistant-command-requirement.md):
 * - The draft only carries stable identity; every fact is re-checked here.
 * - Lifecycle: confirm_ai_proposed_action -> claim_ai_action_execution ->
 *   completeCleaning (daily_complete_cleaning_rpc, logged-in session) ->
 *   re-query verify -> complete_ai_action_execution(success, verified).
 * - No service-role client and no direct table writes.
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
  const proposalId = String(formData.get("proposal_id") ?? "").trim();
  const rawProposalVersion = String(formData.get("proposal_version") ?? "").trim();
  const locale = readLocale(formData);
  if (action !== "complete_daily_cleaning" || !taskId || !unitId || !buildingCode || !unitNo) {
    return { status: "error", result: null, error: tr(locale, "确认请求缺少必要信息，请重新提交查询生成草稿。", "Demande de confirmation incomplète ; relancez une question pour générer le brouillon.") };
  }
  if (!proposalId || !/^\d+$/.test(rawProposalVersion)) {
    return { status: "error", result: null, error: tr(locale, "该草稿缺少 AI 会话记录，请重新提交查询生成新草稿。", "Ce brouillon n'a pas de trace IA ; relancez une question.") };
  }
  const expectedVersion = Number(rawProposalVersion);

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

    // Evidence ledger: human confirmation.
    const confirmed = await confirmAiProposal(proposalId, expectedVersion).catch((error: unknown) => {
      throw new Error(evidenceError(locale, "确认操作草稿失败", "Échec de la confirmation du brouillon", error));
    });
    const confirmedVersion = confirmed.version;
    if (typeof confirmedVersion !== "number" || !Number.isInteger(confirmedVersion)) {
      throw new Error(tr(locale, "确认结果缺少版本号，请重新提交查询。", "La confirmation n'a pas renvoyé de version ; relancez une question."));
    }

    // Evidence ledger: claim the execution slot (idempotency + version guard).
    const claimed = await claimAiProposalExecution(proposalId, confirmedVersion).catch((error: unknown) => {
      throw new Error(evidenceError(locale, "执行占用失败", "Échec de la réservation d'exécution", error));
    });

    const result = await completeCleaning(taskId);
    if (!result.success) {
      await completeAiProposalExecution({
        proposalId,
        requestId: claimed.requestId,
        success: false,
        verified: false,
        error: result.error || "complete_daily_cleaning_failed",
      }).catch(() => undefined);
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
    const evidenceOutcome = await completeAiProposalExecution({
      proposalId,
      requestId: claimed.requestId,
      success: verified,
      verified,
      result: {
        taskId,
        unitId,
        unitStatus: afterUnit?.status ?? unit.status,
        completedAt: afterTask?.completed_at ?? null,
      },
      error: verified ? undefined : "post_execution_verification_failed",
    }).catch(() => null);

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
        { label: tr(locale, "证据链", "Trace IA"), value: tr(locale, "ai_jobs / 提案 / 事件已写入", "ai_jobs / proposition / événements écrits") },
      ],
      warnings: verified
        ? []
        : [tr(locale, "执行结果未通过复查，请勿重复确认；请先核对任务与房态。", "Vérification non concluante ; ne reconfirmez pas, contrôlez d'abord la tâche et l'état.")],
    };
    if (evidenceOutcome === null && verified) {
      outcome.warnings = [
        ...outcome.warnings,
        tr(locale, "执行已完成，但证据链结果记录失败，请稍后到 AI 会话页核对。", "Exécution effectuée mais l'enregistrement de la trace IA a échoué ; vérifiez la session IA."),
      ];
    }
    return { status: "success", result: outcome, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : tr(locale, "确认执行失败，请稍后重试。", "Échec de la confirmation, réessayez plus tard.");
    return { status: "error", result: null, error: message };
  }
}
