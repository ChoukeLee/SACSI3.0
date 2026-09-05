import "server-only";

import { createClient } from "@/lib/supabase/server";
import { statusDisplayLabel } from "@/lib/display-labels";
import type { WorkbenchDraftPreview } from "./types";
import type { WorkbenchActionIntent } from "./action-parser";

function generatedAtText(iso: string) {
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

export async function buildCleaningCompletionDraft(intent: WorkbenchActionIntent): Promise<WorkbenchDraftPreview> {
  const supabase = await createClient();
  const { data: building, error: buildingError } = await supabase
    .from("buildings")
    .select("id, code, display_name")
    .eq("code", intent.buildingCode)
    .eq("is_active", true)
    .maybeSingle();
  if (buildingError) throw new Error(`读取楼栋失败：${buildingError.message}`);
  if (!building) throw new Error(`未找到楼栋 ${intent.buildingCode.replace("SACSI", "")}#。`);

  const { data: unit, error: unitError } = await supabase
    .from("units")
    .select("id, unit_no, floor_label, status")
    .eq("building_id", building.id)
    .eq("unit_no", intent.unitNo)
    .maybeSingle();
  if (unitError) throw new Error(`读取房间失败：${unitError.message}`);
  if (!unit) throw new Error(`未找到 ${building.display_name || building.code} ${intent.unitNo}。`);

  const { data: tasks, error: taskError } = await supabase
    .from("cleaning_tasks")
    .select("id, daily_booking_id, is_completed, created_at")
    .eq("unit_id", unit.id)
    .eq("is_completed", false)
    .order("created_at", { ascending: false })
    .limit(2);
  if (taskError) throw new Error(`读取保洁任务失败：${taskError.message}`);
  if (!tasks?.length) throw new Error(`${building.display_name || building.code} ${unit.unit_no} 当前没有待完成的保洁任务。`);
  if (tasks.length > 1) throw new Error(`${building.display_name || building.code} ${unit.unit_no} 存在多条待保洁任务，请先在数据质量页核对，AI 不会自行选择。`);

  const task = tasks[0];
  let bookingSummary = "未关联日租订单";
  if (task.daily_booking_id) {
    const { data: booking, error: bookingError } = await supabase
      .from("daily_bookings")
      .select("id, status, check_in, check_out, actual_check_out")
      .eq("id", task.daily_booking_id)
      .maybeSingle();
    if (bookingError) throw new Error(`读取关联订单失败：${bookingError.message}`);
    if (!booking) throw new Error("保洁任务关联的日租订单不存在或当前账号无权查看，请先核对数据。");
    bookingSummary = `${booking.check_in} 至 ${booking.actual_check_out || booking.check_out || "开放式"}（${booking.status}）`;
  }

  const generatedAt = new Date().toISOString();
  return {
    kind: "action_draft",
    action: "complete_daily_cleaning",
    risk: "L1",
    title: "完成日租保洁",
    summary: `拟将 ${building.display_name || building.code} ${unit.unit_no} 的当前保洁任务标记为已完成。`,
    target: [
      { label: "楼栋", value: building.display_name || building.code },
      { label: "房号", value: unit.unit_no },
      { label: "关联订单", value: bookingSummary },
    ],
    beforeState: [
      { label: "保洁任务", value: "待完成" },
      { label: "当前房态", value: statusDisplayLabel(unit.status, "zh") },
      { label: "核对时间", value: `${generatedAtText(generatedAt)}（阿比让）` },
    ],
    expectedEffects: [
      "当前保洁任务变更为已完成，并记录实际完成时间。",
      "数据库重新计算该房间房态；有后续预订时保留为已预订，否则恢复为可用。",
      "写入真实操作人的审计记录。",
    ],
    warnings: ["这是 L1 可逆状态操作，正式执行前仍须人工确认。"],
    generatedAt,
    confidence: intent.confidence,
    canConfirm: true,
    confirmationNote: "确认后将以你的登录身份执行该 L1 操作（走日租统一原子 RPC，确认前不修改任何数据），随后自动复查任务与房态。",
    execution: {
      action: "complete_daily_cleaning",
      taskId: task.id,
      unitId: unit.id,
      buildingCode: intent.buildingCode,
      unitNo: unit.unit_no,
    },
  };
}
