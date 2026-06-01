"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { syncBookingFinance } from "./daily-rental-finance";

export type RepairResult = { success: boolean; message: string };

export async function repairDailyRentalIssue(
  issueId: string,
  entityId: string,
): Promise<RepairResult> {
  await requireRole("admin");
  const supabase = await createClient();

  // ── Financial sync ──
  if (issueId.startsWith("dr_fin_prepaid_") || issueId.startsWith("dr_fin_rec_amt_") || issueId.startsWith("dr_fin_rec_paid_") || issueId.startsWith("dr_fin_billing_")) {
    const bookingId = entityId;
    try {
      await syncBookingFinance(supabase, bookingId);
      await supabase.from("audit_logs").insert({
        action: "repair_finance", entity_type: "daily_booking", entity_id: bookingId,
        metadata: { issue_id: issueId, repaired_at: new Date().toISOString() },
      });
      revalidate();
      return { success: true, message: `已同步财务数据` };
    } catch (e: unknown) {
      return { success: false, message: `修复失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // ── checked_in → daily_occupied ──
  if (issueId.startsWith("dr_ci_not_occupied_")) {
    try {
      await supabase.from("units").update({ status: "daily_occupied" }).eq("id", entityId);
      await supabase.from("audit_logs").insert({
        action: "repair_unit_status", entity_type: "unit", entity_id: entityId,
        metadata: { new_status: "daily_occupied", issue_id: issueId, repaired_at: new Date().toISOString() },
      });
      revalidate();
      return { success: true, message: "已将房间状态修正为 daily_occupied" };
    } catch (e: unknown) {
      return { success: false, message: `修复失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // ── Open cleaning → cleaning_pending ──
  if (issueId.startsWith("dr_clean_not_status_")) {
    try {
      await supabase.from("units").update({ status: "cleaning_pending" }).eq("id", entityId);
      await supabase.from("audit_logs").insert({
        action: "repair_unit_status", entity_type: "unit", entity_id: entityId,
        metadata: { new_status: "cleaning_pending", issue_id: issueId, repaired_at: new Date().toISOString() },
      });
      revalidate();
      return { success: true, message: "已将房间状态修正为 cleaning_pending" };
    } catch (e: unknown) {
      return { success: false, message: `修复失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // ── cleaning_pending without task → available ──
  if (issueId.startsWith("dr_clean_status_no_task_")) {
    try {
      const { data: activeBookings } = await supabase.from("daily_bookings")
        .select("id, status")
        .eq("unit_id", entityId)
        .in("status", ["pending_review", "confirmed", "checked_in"]);
      const hasCheckedIn = (activeBookings ?? []).some((booking) => booking.status === "checked_in");
      const hasReserved = (activeBookings ?? []).some((booking) => booking.status === "pending_review" || booking.status === "confirmed");
      const nextStatus = hasCheckedIn ? "daily_occupied" : hasReserved ? "reserved" : "available";
      await supabase.from("units").update({ status: nextStatus }).eq("id", entityId);
      await supabase.from("audit_logs").insert({
        action: "repair_unit_status", entity_type: "unit", entity_id: entityId,
        metadata: { new_status: nextStatus, issue_id: issueId, repaired_at: new Date().toISOString() },
      });
      revalidate();
      return { success: true, message: `已将房间状态修正为 ${nextStatus}` };
    } catch (e: unknown) {
      return { success: false, message: `修复失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // ── Backfill missing audit ──
  if (issueId.startsWith("dr_bf_no_audit_")) {
    try {
      const { data: booking } = await supabase.from("daily_bookings").select("*").eq("id", entityId).single();
      if (!booking) return { success: false, message: "订单不存在" };
      await supabase.from("audit_logs").insert({
        action: "daily_booking_backfill", entity_type: "daily_booking", entity_id: entityId,
        metadata: {
          reason: "repair: missing audit log",
          check_in: booking.check_in, check_out: booking.check_out,
          amount: Number(booking.total_amount_xof), paid_amount: Number(booking.prepaid_amount_xof),
          unit_id: booking.unit_id, customer_id: booking.customer_id,
        },
      });
      revalidate();
      return { success: true, message: "已补写审计日志" };
    } catch (e: unknown) {
      return { success: false, message: `修复失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // ── Backfill unit status fix ──
  if (issueId.startsWith("dr_bf_unit_status_")) {
    try {
      const { data: activeBookings } = await supabase.from("daily_bookings")
        .select("id, status").eq("unit_id", entityId).in("status", ["pending_review", "confirmed", "checked_in"]);
      const hasCheckedIn = (activeBookings ?? []).some((booking) => booking.status === "checked_in");
      const hasReserved = (activeBookings ?? []).some((booking) => booking.status === "pending_review" || booking.status === "confirmed");
      const nextStatus = hasCheckedIn ? "daily_occupied" : hasReserved ? "reserved" : "available";
      await supabase.from("units").update({ status: nextStatus }).eq("id", entityId);
      await supabase.from("audit_logs").insert({
        action: "repair_unit_status", entity_type: "unit", entity_id: entityId,
        metadata: { new_status: nextStatus, issue_id: issueId, repaired_at: new Date().toISOString() },
      });
      revalidate();
      return { success: true, message: `已将房间状态修正为 ${nextStatus}` };
    } catch (e: unknown) {
      return { success: false, message: `修复失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  return { success: false, message: `未知或不支持自动修复: ${issueId}` };
}

function revalidate() {
  revalidatePath("/"); revalidatePath("/fr");
  revalidatePath("/daily-rentals"); revalidatePath("/fr/daily-rentals");
  revalidatePath("/management"); revalidatePath("/fr/management");
  revalidatePath("/finance"); revalidatePath("/fr/finance");
  revalidatePath("/data-quality"); revalidatePath("/fr/data-quality");
}
