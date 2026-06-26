import { hasPermission, type CurrentUser } from "@/lib/auth";
import { checkOut } from "@/features/daily-rentals/actions";
import { allowCheckOut } from "@/features/daily-rentals/daily-rental-policy";
import { createDraftId, extractDateHint, extractRoomNumbers, findDailyBookingsForRooms, nowIso, todayIso } from "../utils";
import type {
  AssistantOperationDraft,
  AssistantOperationDraftInput,
  AssistantOperationExecutionResult,
  AssistantOperationHandler,
  AssistantOperationValidation,
} from "../types";

const CHECKOUT_TERMS = /退房|离店|check.?out|checkout|départ|depart/i;

async function buildRoomCheckoutChanges(roomNumbers: string[], actualCheckOut: string) {
  const bookings = await findDailyBookingsForRooms(roomNumbers);
  const latestByRoom = new Map<string, (typeof bookings)[number]>();
  for (const booking of bookings) {
    const roomNo = booking.units.unit_no;
    if (!latestByRoom.has(roomNo) && booking.status === "checked_in") latestByRoom.set(roomNo, booking);
  }
  return roomNumbers.flatMap((roomNo) => {
    const booking = latestByRoom.get(roomNo);
    if (!booking) return [];
    return [{
      table: "daily_bookings",
      type: "update" as const,
      entityId: booking.id,
      label: `Room ${roomNo}`,
      before: { status: booking.status, actual_check_out: booking.actual_check_out },
      after: { status: "checked_out", actual_check_out: actualCheckOut },
    }, {
      table: "cleaning_tasks",
      type: "insert" as const,
      entityId: null,
      label: `Room ${roomNo}`,
      before: null,
      after: { is_completed: false },
    }];
  });
}

export const dailyCheckOutOperation: AssistantOperationHandler = {
  action: "daily_check_out",
  match(input) {
    return CHECKOUT_TERMS.test(input.message);
  },
  async buildDraft(input: AssistantOperationDraftInput): Promise<AssistantOperationDraft> {
    const roomNumbers = extractRoomNumbers(input.message);
    const actualCheckOut = extractDateHint(input.message) ?? todayIso();
    const changes = await buildRoomCheckoutChanges(roomNumbers, actualCheckOut);
    const missing = roomNumbers.length === 0 ? ["roomNumbers"] : [];
    const warnings: string[] = [];
    if (roomNumbers.length > 0 && changes.length === 0) missing.push("checked_in_booking");
    for (const roomNo of roomNumbers) {
      if (!changes.some((change) => change.label === `Room ${roomNo}` && change.table === "daily_bookings")) {
        warnings.push(`${roomNo}: no checked-in booking found`);
      }
    }
    return {
      id: createDraftId(["daily_check_out", roomNumbers, actualCheckOut, changes.map((change) => change.entityId)]),
      action: "daily_check_out",
      summary: input.locale === "zh" ? `办理 ${roomNumbers.join("、") || "-"} 日租退房` : `Départ journalier ${roomNumbers.join(", ") || "-"}`,
      riskLevel: missing.length > 0 ? "blocked" : "medium",
      requiresConfirmation: true,
      executable: missing.length === 0 && warnings.length === 0,
      locale: input.locale,
      originalMessage: input.message,
      roomNumbers,
      changes,
      missing,
      warnings,
      permissions: ["daily_rentals:write"],
      metadata: { actualCheckOut },
      createdAt: nowIso(),
    };
  },
  async validate(draft: AssistantOperationDraft, user: CurrentUser): Promise<AssistantOperationValidation> {
    const missing = [...draft.missing];
    const warnings = [...draft.warnings];
    if (!hasPermission(user, "daily_rentals:write")) missing.push("permission:daily_rentals:write");
    const bookingIds = draft.changes.filter((change) => change.table === "daily_bookings").map((change) => change.entityId).filter(Boolean) as string[];
    if (bookingIds.length === 0) missing.push("checked_in_booking");
    const bookings = await findDailyBookingsForRooms(draft.roomNumbers);
    const bookingMap = new Map(bookings.map((booking) => [booking.id, booking]));
    for (const bookingId of bookingIds) {
      const booking = bookingMap.get(bookingId);
      const policy = allowCheckOut(booking ?? { status: "" });
      if (!policy.allowed) warnings.push(`${bookingId}: ${policy.reason}`);
    }
    const ok = missing.length === 0 && warnings.length === 0;
    return { ok, riskLevel: ok ? "medium" : "blocked", missing: [...new Set(missing)], warnings: [...new Set(warnings)], changes: draft.changes };
  },
  async execute(draft: AssistantOperationDraft, user: CurrentUser): Promise<AssistantOperationExecutionResult> {
    const validation = await this.validate(draft, user);
    if (!validation.ok) return { success: false, action: "daily_check_out", message: "Draft validation failed.", affectedRecords: [], metadata: { validation } };
    const affectedRecords = [];
    const actualCheckOut = String(draft.metadata.actualCheckOut ?? todayIso());
    for (const change of draft.changes.filter((item) => item.table === "daily_bookings")) {
      if (!change.entityId) continue;
      const result = await checkOut(change.entityId, { actualCheckOut });
      if (!result.success) return { success: false, action: "daily_check_out", message: result.error ?? "checkOutFailed", affectedRecords, metadata: { failedBookingId: change.entityId } };
      affectedRecords.push(change);
    }
    return { success: true, action: "daily_check_out", message: draft.locale === "zh" ? "退房已完成，并按规则生成清洁任务。" : "Départ effectué, tâche de ménage créée selon les règles.", auditAction: "check_out", affectedRecords, metadata: { actualCheckOut } };
  },
};
