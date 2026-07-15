import { hasPermission, type CurrentUser } from "@/lib/auth";
import { cancelBooking } from "@/features/daily-rentals/actions";
import { allowCancelBooking } from "@/features/daily-rentals/daily-rental-policy";
import { createDraftId, extractRoomNumbers, findDailyBookingsForRooms, nowIso } from "../utils";
import type {
  AssistantOperationDraft,
  AssistantOperationDraftInput,
  AssistantOperationExecutionResult,
  AssistantOperationHandler,
  AssistantOperationValidation,
} from "../types";

const CANCEL_TERMS = /取消.*(预订|预约|订单|入住)|撤销.*(预订|预约|订单)|cancel|annuler/i;

function pickCancelableBookings(bookings: Awaited<ReturnType<typeof findDailyBookingsForRooms>>) {
  const map = new Map<string, (typeof bookings)[number]>();
  for (const booking of bookings) {
    const roomNo = booking.units.unit_no;
    if (!map.has(roomNo) && (booking.status === "pending_review" || booking.status === "confirmed")) {
      map.set(roomNo, booking);
    }
  }
  return map;
}

export const dailyCancelBookingOperation: AssistantOperationHandler = {
  action: "daily_cancel_booking",
  match(input) {
    return CANCEL_TERMS.test(input.message) && extractRoomNumbers(input.message).length > 0;
  },
  async buildDraft(input: AssistantOperationDraftInput): Promise<AssistantOperationDraft> {
    const roomNumbers = extractRoomNumbers(input.message);
    const bookings = await findDailyBookingsForRooms(roomNumbers);
    const cancelableByRoom = pickCancelableBookings(bookings);
    const missing = roomNumbers.length === 0 ? ["roomNumbers"] : [];
    const warnings: string[] = [];
    const changes = roomNumbers.flatMap((roomNo) => {
      const booking = cancelableByRoom.get(roomNo);
      if (!booking) {
        warnings.push(`${roomNo}: no pending/confirmed booking found`);
        return [];
      }
      return [{
        table: "daily_bookings",
        type: "update" as const,
        entityId: booking.id,
        label: `房间 ${roomNo}`,
        before: { status: booking.status, check_in: booking.check_in, check_out: booking.check_out },
        after: { status: "cancelled" },
      }, {
        table: "receivables",
        type: "update" as const,
        entityId: null,
        label: `房间 ${roomNo}`,
        before: { source_id: booking.id },
        after: { status: "cancelled" },
      }];
    });
    if (roomNumbers.length > 0 && changes.length === 0) missing.push("cancelable_booking");
    const executable = missing.length === 0 && warnings.length === 0;
    return {
      id: createDraftId(["daily_cancel_booking", roomNumbers, changes.map((change) => change.entityId)]),
      action: "daily_cancel_booking",
      summary: input.locale === "zh" ? `取消 ${roomNumbers.join("、") || "-"} 日租预订草稿` : `Annulation réservation ${roomNumbers.join(", ") || "-"}`,
      riskLevel: executable ? "high" : "blocked",
      requiresConfirmation: true,
      executable,
      locale: input.locale,
      originalMessage: input.message,
      roomNumbers,
      changes,
      missing,
      warnings,
      permissions: ["daily_rentals:delete"],
      metadata: { reversesPayments: true, cancelsReceivables: true },
      createdAt: nowIso(),
    };
  },
  async validate(draft: AssistantOperationDraft, user: CurrentUser): Promise<AssistantOperationValidation> {
    const missing = [...draft.missing];
    const warnings = [...draft.warnings];
    if (!hasPermission(user, "daily_rentals:delete")) missing.push("permission:daily_rentals:delete");
    const bookingIds = draft.changes.filter((change) => change.table === "daily_bookings").map((change) => change.entityId).filter(Boolean) as string[];
    if (bookingIds.length === 0) missing.push("cancelable_booking");
    const bookings = await findDailyBookingsForRooms(draft.roomNumbers);
    const bookingMap = new Map(bookings.map((booking) => [booking.id, booking]));
    for (const bookingId of bookingIds) {
      const booking = bookingMap.get(bookingId);
      const policy = allowCancelBooking(booking ?? { status: "" });
      if (!policy.allowed) warnings.push(`${bookingId}: ${policy.reason}`);
    }
    const ok = missing.length === 0 && warnings.length === 0;
    return { ok, riskLevel: ok ? "high" : "blocked", missing: [...new Set(missing)], warnings: [...new Set(warnings)], changes: draft.changes };
  },
  async execute(draft: AssistantOperationDraft, user: CurrentUser): Promise<AssistantOperationExecutionResult> {
    const validation = await this.validate(draft, user);
    if (!validation.ok) return { success: false, action: "daily_cancel_booking", message: "Draft validation failed.", affectedRecords: [], metadata: { validation } };
    const affectedRecords = [];
    for (const change of draft.changes.filter((item) => item.table === "daily_bookings")) {
      if (!change.entityId) continue;
      const result = await cancelBooking(change.entityId);
      if (!result.success) return { success: false, action: "daily_cancel_booking", message: result.error ?? "cancelFailed", affectedRecords, metadata: { failedBookingId: change.entityId } };
      affectedRecords.push(change);
    }
    return {
      success: true,
      action: "daily_cancel_booking",
      message: draft.locale === "zh" ? "日租预订已取消，相关收款和应收按原规则处理。" : "Réservation annulée, paiements et créances traités selon les règles.",
      auditAction: "cancel",
      affectedRecords,
    };
  },
};
