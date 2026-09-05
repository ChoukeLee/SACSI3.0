import "server-only";

import { createClient } from "@/lib/supabase/server";
import { statusDisplayLabel } from "@/lib/display-labels";
import type { Locale } from "@/lib/i18n";
import type { WorkbenchDraftPreview } from "./types";
import type { WorkbenchActionIntent } from "./action-parser";

function tr(locale: Locale, zh: string, fr: string) {
  return locale === "fr" ? fr : zh;
}

function generatedAtText(locale: Locale, iso: string) {
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

export async function buildCleaningCompletionDraft(intent: WorkbenchActionIntent, locale: Locale = "zh"): Promise<WorkbenchDraftPreview> {
  const supabase = await createClient();
  const { data: building, error: buildingError } = await supabase
    .from("buildings")
    .select("id, code, display_name")
    .eq("code", intent.buildingCode)
    .eq("is_active", true)
    .maybeSingle();
  if (buildingError) throw new Error(tr(locale, `读取楼栋失败：${buildingError.message}`, `Erreur de lecture du bâtiment : ${buildingError.message}`));
  if (!building) throw new Error(tr(locale, `未找到楼栋 ${intent.buildingCode.replace("SACSI", "")}#。`, `Bâtiment ${intent.buildingCode.replace("SACSI", "")}# introuvable.`));

  const { data: unit, error: unitError } = await supabase
    .from("units")
    .select("id, unit_no, floor_label, status")
    .eq("building_id", building.id)
    .eq("unit_no", intent.unitNo)
    .maybeSingle();
  if (unitError) throw new Error(tr(locale, `读取房间失败：${unitError.message}`, `Erreur de lecture de la chambre : ${unitError.message}`));
  if (!unit) throw new Error(tr(locale, `未找到 ${building.display_name || building.code} ${intent.unitNo}。`, `Chambre ${intent.unitNo} introuvable (${building.display_name || building.code}).`));

  const { data: tasks, error: taskError } = await supabase
    .from("cleaning_tasks")
    .select("id, daily_booking_id, is_completed, created_at")
    .eq("unit_id", unit.id)
    .eq("is_completed", false)
    .order("created_at", { ascending: false })
    .limit(2);
  if (taskError) throw new Error(tr(locale, `读取保洁任务失败：${taskError.message}`, `Erreur de lecture des tâches de ménage : ${taskError.message}`));
  if (!tasks?.length) throw new Error(tr(locale, `${building.display_name || building.code} ${unit.unit_no} 当前没有待完成的保洁任务。`, `Aucune tâche de ménage en attente pour ${building.display_name || building.code} ${unit.unit_no}.`));
  if (tasks.length > 1) throw new Error(tr(locale, `${building.display_name || building.code} ${unit.unit_no} 存在多条待保洁任务，请先在数据质量页核对，AI 不会自行选择。`, `Plusieurs tâches de ménage en attente pour ${building.display_name || building.code} ${unit.unit_no} ; vérifiez d'abord la qualité des données, l'IA ne choisit pas seule.`));

  const task = tasks[0];
  let bookingSummary = tr(locale, "未关联日租订单", "Aucune réservation liée");
  if (task.daily_booking_id) {
    const { data: booking, error: bookingError } = await supabase
      .from("daily_bookings")
      .select("id, status, check_in, check_out, actual_check_out")
      .eq("id", task.daily_booking_id)
      .maybeSingle();
    if (bookingError) throw new Error(tr(locale, `读取关联订单失败：${bookingError.message}`, `Erreur de lecture de la réservation : ${bookingError.message}`));
    if (!booking) throw new Error(tr(locale, "保洁任务关联的日租订单不存在或当前账号无权查看，请先核对数据。", "La réservation liée n'existe pas ou n'est pas visible par votre profil ; vérifiez les données."));
    bookingSummary = `${booking.check_in} ${tr(locale, "至", "→")} ${booking.actual_check_out || booking.check_out || tr(locale, "开放式", "ouverte")}（${statusDisplayLabel(booking.status, locale)}）`;
  }

  const generatedAt = new Date().toISOString();
  const place = `${building.display_name || building.code} ${unit.unit_no}`;
  return {
    kind: "action_draft",
    action: "complete_daily_cleaning",
    risk: "L1",
    title: tr(locale, "完成日租保洁", "Terminer le ménage"),
    summary: tr(locale, `拟将 ${place} 的当前保洁任务标记为已完成。`, `Marquer comme terminée la tâche de ménage en cours de ${place}.`),
    target: [
      { label: tr(locale, "楼栋", "Bâtiment"), value: building.display_name || building.code },
      { label: tr(locale, "房号", "Chambre"), value: unit.unit_no },
      { label: tr(locale, "关联订单", "Réservation"), value: bookingSummary },
    ],
    beforeState: [
      { label: tr(locale, "保洁任务", "Tâche de ménage"), value: tr(locale, "待完成", "En attente") },
      { label: tr(locale, "当前房态", "État actuel"), value: statusDisplayLabel(unit.status, locale) },
      { label: tr(locale, "核对时间", "Vérifié le"), value: `${generatedAtText(locale, generatedAt)}${locale === "fr" ? " (Abidjan)" : "（阿比让）"}` },
    ],
    expectedEffects: [
      tr(locale, "当前保洁任务变更为已完成，并记录实际完成时间。", "La tâche passe à « terminée » avec son heure réelle."),
      tr(locale, "数据库重新计算该房间房态；有后续预订时保留为已预订，否则恢复为可用。", "L'état de la chambre est recalculé : réservée si une réservation suit, sinon disponible."),
      tr(locale, "写入真实操作人的审计记录。", "Écriture dans l'audit avec l'opérateur réel."),
    ],
    warnings: [tr(locale, "这是 L1 可逆状态操作，正式执行前仍须人工确认。", "Opération d'état réversible de niveau L1 ; confirmation humaine requise avant exécution.")],
    generatedAt,
    confidence: intent.confidence,
    canConfirm: true,
    confirmationNote: tr(
      locale,
      "确认后将以你的登录身份执行该 L1 操作（走日租统一原子 RPC，确认前不修改任何数据），随后自动复查任务与房态。",
      "Après confirmation, cette opération L1 sera exécutée avec votre session (RPC atomique journalier ; aucune modification avant confirmation), puis l'état sera revérifié.",
    ),
    execution: {
      action: "complete_daily_cleaning",
      taskId: task.id,
      unitId: unit.id,
      buildingCode: intent.buildingCode,
      unitNo: unit.unit_no,
    },
  };
}
