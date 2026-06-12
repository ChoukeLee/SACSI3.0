"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { getSetting } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import type { UnitStatus } from "@/types/domain";
import { syncBookingFinance } from "@/features/daily-rentals/daily-rental-finance";

export type BusinessRepairAction =
  | "sync_daily_finance"
  | "set_unit_status"
  | "create_cleaning_task"
  | "undo_check_in";

export interface BusinessRepairInput {
  action: BusinessRepairAction;
  unitNo: string;
  targetStatus?: UnitStatus;
  note?: string;
}

export interface BusinessRepairResult {
  success: boolean;
  message: string;
}

const statusLabels: Record<UnitStatus, string> = {
  available: "可预订",
  reserved: "预订",
  daily_occupied: "日租中",
  cleaning_pending: "待保洁",
  leased: "长租中",
  sold: "已售",
  maintenance: "维修",
  locked: "锁定",
};

export async function runBusinessRepair(input: BusinessRepairInput): Promise<BusinessRepairResult> {
  await requireRole("admin");
  const supabase = await createClient();
  const unitNo = input.unitNo.trim();

  if (!unitNo) return { success: false, message: "请输入房号。" };

  const { data: unit, error: unitError } = await supabase
    .from("units")
    .select("id, unit_no, status")
    .eq("unit_no", unitNo)
    .maybeSingle();

  if (unitError) return { success: false, message: unitError.message };
  if (!unit) return { success: false, message: `没有找到房间 ${unitNo}。` };

  if (input.action === "sync_daily_finance") {
    const booking = await findLatestDailyBooking(unit.id);
    if (!booking) return { success: false, message: `房间 ${unitNo} 没有可同步的日租订单。` };

    await syncBookingFinance(supabase, booking.id);
    await writeAuditLog({
      action: "business_repair_sync_daily_finance",
      entityType: "daily_booking",
      entityId: booking.id,
      entityLabel: `房间 ${unitNo}`,
      metadata: { unit_id: unit.id, unit_no: unitNo, note: input.note ?? null },
    });
    revalidateAll();
    return { success: true, message: `已同步房间 ${unitNo} 最近日租订单的应收、已收和结算状态。` };
  }

  if (input.action === "set_unit_status") {
    if (!input.targetStatus) return { success: false, message: "请选择目标房态。" };
    const before = { status: unit.status };
    const after = { status: input.targetStatus };
    const { error } = await supabase.from("units").update(after).eq("id", unit.id);
    if (error) return { success: false, message: error.message };

    await writeAuditLog({
      action: "business_repair_set_unit_status",
      entityType: "unit",
      entityId: unit.id,
      entityLabel: `房间 ${unitNo}`,
      beforeData: before,
      afterData: after,
      metadata: { unit_no: unitNo, note: input.note ?? null },
    });
    revalidateAll();
    return { success: true, message: `已将房间 ${unitNo} 改为${statusLabels[input.targetStatus]}。` };
  }

  if (input.action === "create_cleaning_task") {
    const { data: existing } = await supabase
      .from("cleaning_tasks")
      .select("id")
      .eq("unit_id", unit.id)
      .eq("is_completed", false)
      .limit(1);

    if ((existing ?? []).length > 0) {
      return { success: false, message: `房间 ${unitNo} 已经有未完成清洁任务。` };
    }

    const booking = await findLatestDailyBooking(unit.id);
    const { data: task, error } = await supabase
      .from("cleaning_tasks")
      .insert({ unit_id: unit.id, daily_booking_id: booking?.id ?? null, is_completed: false })
      .select("id")
      .single();
    if (error) return { success: false, message: error.message };

    await supabase.from("units").update({ status: "cleaning_pending" }).eq("id", unit.id);
    await writeAuditLog({
      action: "business_repair_create_cleaning_task",
      entityType: "unit",
      entityId: unit.id,
      entityLabel: `房间 ${unitNo}`,
      metadata: { unit_no: unitNo, cleaning_task_id: task?.id ?? null, booking_id: booking?.id ?? null, note: input.note ?? null },
    });
    revalidateAll();
    return { success: true, message: `已为房间 ${unitNo} 创建清洁任务，并改为待保洁。` };
  }

  if (input.action === "undo_check_in") {
    const configuredStatus = await getSetting<UnitStatus>("undo_checkin_target_status", "reserved");
    const { data: booking, error } = await supabase
      .from("daily_bookings")
      .select("id, unit_id, status, check_in, check_out")
      .eq("unit_id", unit.id)
      .eq("status", "checked_in")
      .order("check_in", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return { success: false, message: error.message };
    if (!booking) return { success: false, message: `房间 ${unitNo} 当前没有入住中的日租订单。` };

    const beforeBooking = { status: booking.status };
    await supabase.from("daily_bookings").update({ status: "confirmed" }).eq("id", booking.id);
    await supabase.from("units").update({ status: configuredStatus }).eq("id", unit.id);
    await syncBookingFinance(supabase, booking.id);

    await writeAuditLog({
      action: "business_repair_undo_check_in",
      entityType: "daily_booking",
      entityId: booking.id,
      entityLabel: `房间 ${unitNo}`,
      beforeData: beforeBooking,
      afterData: { status: "confirmed", unit_status: configuredStatus },
      metadata: { unit_id: unit.id, unit_no: unitNo, note: input.note ?? null },
    });
    revalidateAll();
    return { success: true, message: `已撤销房间 ${unitNo} 的误入住，订单回到已确认，房态改为${statusLabels[configuredStatus]}。` };
  }

  return { success: false, message: "暂不支持该修正动作。" };

  async function findLatestDailyBooking(unitId: string) {
    const { data, error } = await supabase
      .from("daily_bookings")
      .select("id, status, check_in, check_out")
      .eq("unit_id", unitId)
      .neq("status", "cancelled")
      .order("check_in", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }
}

function revalidateAll() {
  revalidatePath("/");
  revalidatePath("/fr");
  revalidatePath("/daily-rentals");
  revalidatePath("/fr/daily-rentals");
  revalidatePath("/data-quality");
  revalidatePath("/fr/data-quality");
  revalidatePath("/finance");
  revalidatePath("/fr/finance");
  revalidatePath("/settings/audit-logs");
  revalidatePath("/fr/settings/audit-logs");
}
