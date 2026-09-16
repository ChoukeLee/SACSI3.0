import { parseRecordDailyPaymentInput, type OperatorActionRequest } from "./operator-action-contract";

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function money(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+(?:\.0+)?$/.test(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= 999999999999 ? number : null;
}
function signedMoney(value: unknown): number | null {
  if (typeof value === "number" && value < 0) { const n = money(-value); return n === null ? null : -n; }
  if (typeof value === "string" && value.startsWith("-")) { const n = money(value.slice(1)); return n === null ? null : -n; }
  return money(value);
}

export function buildPaymentPreview(request: OperatorActionRequest, snapshot: unknown) {
  const fail = (code: string) => ({ success: false as const, code });
  if (request.actionName !== "record_daily_payment" || request.inputSource !== "excel_screenshot"
    || request.scope !== "business_data" || request.exceptionalBusinessCase) return fail("preview_scope_not_supported");
  const parsed = parseRecordDailyPaymentInput(request.input);
  if (!parsed.success) return parsed;
  const input = parsed.data;
  if (!record(snapshot) || !record(snapshot.booking) || !record(snapshot.unit)
    || !Array.isArray(snapshot.receivables) || !snapshot.receivables.every(record)
    || !Array.isArray(snapshot.payments) || !snapshot.payments.every(record)) return fail("preview_snapshot_invalid");
  const booking = snapshot.booking;
  const unit = snapshot.unit;
  if (booking.id !== input.bookingId || booking.unit_id !== unit.id) return fail("preview_snapshot_mismatch");
  if (!["confirmed", "checked_in"].includes(String(booking.status))) return fail("booking_not_payable");
  // Open stays require date-dependent accrual inside the future locked writer.
  if (!booking.check_out || booking.checkout_mode === "open") return fail("open_stay_preview_not_supported");
  if (snapshot.payments.some(payment => payment.request_id === request.requestId)) return fail("request_already_recorded_recheck_same_id");
  const receivables = snapshot.receivables.filter(row => row.status !== "cancelled");
  if (receivables.length !== 1) return fail("booking_finance_inconsistent");
  const receivable = receivables[0];
  const total = money(booking.final_amount_xof ?? booking.total_amount_xof);
  const paid = money(booking.prepaid_amount_xof);
  let paymentSum = 0;
  for (const payment of snapshot.payments) {
    const value = signedMoney(payment.amount);
    if (value === null || payment.source_type !== "daily_booking" || payment.source_id !== booking.id
      || payment.currency !== "XOF") return fail("booking_finance_inconsistent");
    paymentSum += value;
    if (!Number.isSafeInteger(paymentSum)) return fail("booking_finance_inconsistent");
  }
  if (total === null || paid === null || paid > total || money(input.amountXof) === null
    || paymentSum !== paid
    || money(receivable.amount_xof) !== total || money(receivable.paid_amount_xof) !== paid
    || receivable.source_type !== "daily_booking" || receivable.source_id !== booking.id
    || receivable.customer_id !== booking.customer_id || receivable.unit_id !== unit.id
    || receivable.building_id !== unit.building_id || receivable.currency !== "XOF"
    || receivable.category !== "daily_rental") return fail("booking_finance_inconsistent");
  if (input.amountXof > total - paid) return fail("payment_exceeds_outstanding");
  return { success: true as const, normalizedRequest: { ...request, input }, preview: {
    requestId: request.requestId, bookingId: input.bookingId,
    unitCode: typeof unit.code === "string" ? unit.code : "",
    unitNo: typeof unit.unit_no === "string" ? unit.unit_no : "",
    bookingAgentId: typeof booking.booking_agent_id === "string" ? booking.booking_agent_id : null,
    amountXof: input.amountXof, paymentDate: input.paymentDate, receiptNo: input.receiptNo,
    totalXof: total, paidBeforeXof: paid, paidAfterXof: paid + input.amountXof,
    outstandingBeforeXof: total - paid, outstandingAfterXof: total - paid - input.amountXof,
    originalInstruction: request.originalInstruction,
  } };
}
