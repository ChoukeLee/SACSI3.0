import { hasPermission, type CurrentUser } from "@/lib/auth";
import { createBooking } from "@/features/daily-rentals/actions";
import {
  createDraftId,
  extractAmountXof,
  extractCheckoutModeHint,
  extractCustomerNameHint,
  extractDateHints,
  extractRoomNumbers,
  findCustomersByName,
  findUnitsByRoomNumbers,
  nowIso,
  todayIso,
} from "../utils";
import type { AssistantOperationDraft, AssistantOperationDraftInput, AssistantOperationExecutionResult, AssistantOperationHandler, AssistantOperationValidation } from "../types";

const CHECKIN_TERMS = /入住|补录|开房|预订|预约|订房|check.?in|arriv|reservation|réservation|reserve/i;

function getDefaultDailyPrice(unit: Awaited<ReturnType<typeof findUnitsByRoomNumbers>>[number]) {
  const flags = unit.unit_business_flags ?? [];
  return flags.find((flag) => flag.business_type === "daily_rental" && flag.is_enabled)?.default_price_xof ?? undefined;
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const dailyCheckInBackfillOperation: AssistantOperationHandler = {
  action: "daily_check_in_backfill",
  match(input) {
    return CHECKIN_TERMS.test(input.message) && extractRoomNumbers(input.message).length > 0;
  },
  async buildDraft(input: AssistantOperationDraftInput): Promise<AssistantOperationDraft> {
    const roomNumbers = extractRoomNumbers(input.message);
    const dateHints = extractDateHints(input.message);
    const checkInDate = dateHints[0] ?? todayIso();
    const checkoutMode = extractCheckoutModeHint(input.message);
    const checkOutDate = checkoutMode === "fixed"
      ? (dateHints[1] ?? (/一晚|1晚|one night|une nuit/i.test(input.message) ? addDays(checkInDate, 1) : undefined))
      : undefined;
    const amountXof = extractAmountXof(input.message);
    const customerName = extractCustomerNameHint(input.message);
    const customers = await findCustomersByName(customerName);
    const resolvedCustomer = customers.length === 1 ? customers[0] : undefined;
    const units = await findUnitsByRoomNumbers(roomNumbers);
    const unitMap = new Map(units.map((unit) => [unit.unit_no, unit]));
    const missing: string[] = [];
    if (!resolvedCustomer) missing.push(customerName ? "customer_id_confirm" : "customer_name_or_id");
    if (!checkoutMode || (checkoutMode === "fixed" && !checkOutDate)) missing.push("check_out_or_open_mode");
    const warnings: string[] = [];
    if (customers.length > 1) warnings.push(`客户“${customerName}”匹配到多条记录，需要确认客户。`);
    if (resolvedCustomer?.is_blacklisted) warnings.push(`客户“${resolvedCustomer.name}”在黑名单中，不能直接创建预订。`);
    const changes = roomNumbers.flatMap((roomNo) => {
      const unit = unitMap.get(roomNo);
      if (!unit) {
        warnings.push(`${roomNo}: unit not found`);
        return [];
      }
      const nightlyPriceXof = amountXof ?? getDefaultDailyPrice(unit);
      if (!nightlyPriceXof) missing.push(`nightly_price_xof:${roomNo}`);
      return [{
        table: "daily_bookings",
        type: "insert" as const,
        entityId: null,
        label: `房间 ${roomNo}`,
        before: null,
        after: {
          unit_id: unit.id,
          customer_id: resolvedCustomer?.id ?? null,
          check_in: checkInDate,
          check_out: checkoutMode === "fixed" ? (checkOutDate ?? null) : null,
          checkout_mode: checkoutMode ?? null,
          nightly_price_xof: nightlyPriceXof ?? null,
          prepaid_amount_xof: 0,
          billing_status: "need_top_up",
          status: "pending_review",
        },
      }];
    });
    if (roomNumbers.length === 0) missing.push("roomNumbers");
    const executable = missing.length === 0 && warnings.length === 0 && changes.length > 0;
    return {
      id: createDraftId(["daily_check_in_backfill", roomNumbers, checkInDate, checkOutDate, checkoutMode, amountXof, resolvedCustomer?.id]),
      action: "daily_check_in_backfill",
      summary: input.locale === "zh" ? `创建/补录 ${roomNumbers.join("、") || "-"} 日租预订草稿` : `Brouillon réservation ${roomNumbers.join(", ") || "-"}`,
      riskLevel: executable ? "medium" : "blocked",
      requiresConfirmation: true,
      executable,
      locale: input.locale,
      originalMessage: input.message,
      roomNumbers,
      changes,
      missing: [...new Set(missing)],
      warnings,
      permissions: ["daily_rentals:write"],
      metadata: { checkInDate, checkOutDate, checkoutMode, amountXof, customerName, customerId: resolvedCustomer?.id },
      createdAt: nowIso(),
    };
  },
  async validate(draft: AssistantOperationDraft, user: CurrentUser): Promise<AssistantOperationValidation> {
    const missing = [...draft.missing];
    const warnings = [...draft.warnings];
    if (!hasPermission(user, "daily_rentals:write")) missing.push("permission:daily_rentals:write");
    for (const change of draft.changes) {
      const after = change.after ?? {};
      if (!after.unit_id) missing.push("unit_id");
      if (!after.customer_id) missing.push("customer_id");
      if (!after.check_in) missing.push("check_in");
      if (!after.checkout_mode || (after.checkout_mode === "fixed" && !after.check_out)) missing.push("check_out_or_open_mode");
      if (!Number(after.nightly_price_xof)) missing.push(`nightly_price_xof:${change.label ?? "room"}`);
    }
    const ok = missing.length === 0 && warnings.length === 0 && draft.changes.length > 0;
    return { ok, riskLevel: ok ? "medium" : "blocked", missing: [...new Set(missing)], warnings: [...new Set(warnings)], changes: draft.changes };
  },
  async execute(draft: AssistantOperationDraft, user: CurrentUser): Promise<AssistantOperationExecutionResult> {
    const validation = await this.validate(draft, user);
    if (!validation.ok) return { success: false, action: "daily_check_in_backfill", message: "Draft validation failed.", affectedRecords: [], metadata: { validation } };
    const affectedRecords = [];
    for (const change of draft.changes) {
      const after = change.after ?? {};
      const result = await createBooking({
        unitId: String(after.unit_id),
        customerId: String(after.customer_id),
        checkIn: String(after.check_in),
        checkOut: after.checkout_mode === "fixed" ? String(after.check_out) : undefined,
        checkoutMode: after.checkout_mode === "open" ? "open" : "fixed",
        nightlyPriceXof: Number(after.nightly_price_xof),
        notes: `AI assistant: ${draft.originalMessage}`,
        requestId: crypto.randomUUID(),
      });
      if (!result.success) return { success: false, action: "daily_check_in_backfill", message: result.error ?? "bookingFailed", affectedRecords, metadata: { failedRoom: change.label } };
      affectedRecords.push({ ...change, entityId: result.data?.booking?.id ?? change.entityId });
    }
    return { success: true, action: "daily_check_in_backfill", message: draft.locale === "zh" ? "日租预订已创建，并同步应收款。" : "Réservation créée avec créance synchronisée.", auditAction: "create_daily_booking", affectedRecords };
  },
};
