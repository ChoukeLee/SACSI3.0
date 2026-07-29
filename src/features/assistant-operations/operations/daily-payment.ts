import { hasPermission, type CurrentUser } from "@/lib/auth";
import { recordSupplementaryPayment } from "@/features/daily-rentals/actions";
import { createDraftId, extractAmountXof, extractDateHint, extractRoomNumbers, findDailyBookingsForRooms, nowIso, todayIso } from "../utils";
import type { AssistantOperationDraft, AssistantOperationDraftInput, AssistantOperationExecutionResult, AssistantOperationHandler, AssistantOperationValidation } from "../types";

const PAYMENT_TERMS = /收款|收了|收到|付款|补缴|租金|payment|paiement|loyer/i;
const UNPAID_TERMS = /未付|未付款|未收|欠款/i;

export const dailyPaymentOperation: AssistantOperationHandler = {
  action: "daily_payment",
  match(input) {
    return PAYMENT_TERMS.test(input.message) && !UNPAID_TERMS.test(input.message) && extractRoomNumbers(input.message).length > 0;
  },
  async buildDraft(input: AssistantOperationDraftInput): Promise<AssistantOperationDraft> {
    const roomNumbers = extractRoomNumbers(input.message);
    const amountXof = extractAmountXof(input.message);
    const paymentDate = extractDateHint(input.message) ?? todayIso();
    const bookings = await findDailyBookingsForRooms(roomNumbers);
    const checkedInByRoom = new Map<string, (typeof bookings)[number]>();
    for (const booking of bookings) {
      if (!checkedInByRoom.has(booking.units.unit_no) && booking.status === "checked_in") checkedInByRoom.set(booking.units.unit_no, booking);
    }
    const missing = roomNumbers.length === 0 ? ["roomNumbers"] : [];
    if (!amountXof) missing.push("amount_xof");
    const warnings: string[] = [];
    const changes = roomNumbers.flatMap((roomNo) => {
      const booking = checkedInByRoom.get(roomNo);
      if (!booking) {
        warnings.push(`${roomNo}: 未找到已入住的日租记录`);
        return [];
      }
      return [{
        table: "payments",
        type: "insert" as const,
        entityId: null,
        label: `房间 ${roomNo}`,
        before: null,
        after: { source_type: "daily_booking", source_id: booking.id, amount: amountXof ?? null, payment_date: paymentDate },
      }, {
        table: "ledger_entries",
        type: "insert" as const,
        entityId: null,
        label: `房间 ${roomNo}`,
        before: null,
        after: { direction: "income", amount: amountXof ?? null },
      }];
    });
    if (roomNumbers.length > 0 && changes.length === 0) missing.push("checked_in_booking");
    return {
      id: createDraftId(["daily_payment", roomNumbers, amountXof, paymentDate, changes.map((change) => change.after?.source_id)]),
      action: "daily_payment",
      summary: input.locale === "zh" ? `记录 ${roomNumbers.join("、") || "-"} 日租收款` : `Paiement journalier ${roomNumbers.join(", ") || "-"}`,
      riskLevel: missing.length > 0 ? "blocked" : "high",
      requiresConfirmation: true,
      executable: missing.length === 0 && warnings.length === 0,
      locale: input.locale,
      originalMessage: input.message,
      roomNumbers,
      changes,
      missing,
      warnings,
      permissions: ["finance:write"],
      metadata: { amountXof, paymentDate },
      createdAt: nowIso(),
    };
  },
  async validate(draft: AssistantOperationDraft, user: CurrentUser): Promise<AssistantOperationValidation> {
    const missing = [...draft.missing];
    const warnings = [...draft.warnings];
    if (!hasPermission(user, "finance:write")) missing.push("permission:finance:write");
    if (!Number(draft.metadata.amountXof)) missing.push("amount_xof");
    const paymentChanges = draft.changes.filter((change) => change.table === "payments");
    if (paymentChanges.length === 0) missing.push("checked_in_booking");
    const ok = missing.length === 0 && warnings.length === 0;
    return { ok, riskLevel: ok ? "high" : "blocked", missing: [...new Set(missing)], warnings: [...new Set(warnings)], changes: draft.changes };
  },
  async execute(draft: AssistantOperationDraft, user: CurrentUser): Promise<AssistantOperationExecutionResult> {
    const validation = await this.validate(draft, user);
    if (!validation.ok) return { success: false, action: "daily_payment", message: "草稿校验失败。", affectedRecords: [], metadata: { validation } };
    const amount = Number(draft.metadata.amountXof);
    const paymentDate = String(draft.metadata.paymentDate ?? todayIso());
    const affectedRecords = [];
    for (const change of draft.changes.filter((item) => item.table === "payments")) {
      const bookingId = String(change.after?.source_id ?? "");
      if (!bookingId) continue;
      const result = await recordSupplementaryPayment({
        bookingId,
        amount,
        paymentDate,
        requestId: crypto.randomUUID(),
      });
      if (!result.success) return { success: false, action: "daily_payment", message: result.error ?? "收款失败", affectedRecords, metadata: { failedBookingId: bookingId } };
      affectedRecords.push(change);
    }
    return { success: true, action: "daily_payment", message: draft.locale === "zh" ? "收款已记录，并同步财务。" : "Paiement enregistré et finance synchronisée.", auditAction: "supplementary_payment", affectedRecords, metadata: { amount, paymentDate } };
  },
};
