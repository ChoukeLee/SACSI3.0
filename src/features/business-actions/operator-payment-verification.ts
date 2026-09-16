import type { RecordDailyPaymentInput } from "./operator-action-contract";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function money(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+(\.0+)?$/.test(value))) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

/** Validate the verification RPC's single-read evidence, not a stale write snapshot. */
export function verifyOperatorPaymentEvidence(
  value: unknown,
  expected: RecordDailyPaymentInput & { requestId: string; actorId: string },
): { verified: boolean; issues: string[] } {
  const evidence = record(value);
  const payment = record(evidence?.payment);
  const booking = record(evidence?.booking);
  const audit = record(evidence?.audit);
  const issues: string[] = [];
  if (evidence?.evidenceVersion !== 2) issues.push("database_evidence_version_mismatch");
  const checks = record(evidence?.checks);
  for (const name of ["payment", "bookingFinance", "receivables", "ledger", "audit"]) {
    if (checks?.[name] !== true) issues.push(`database_${name}_check_failed`);
  }
  if (evidence?.verified !== true) issues.push("database_verification_failed");
  if (!payment?.id || payment.source_type !== "daily_booking"
    || payment.source_id !== expected.bookingId || payment.request_kind !== "daily_payment"
    || payment.request_id !== expected.requestId || money(payment.amount) !== expected.amountXof
    || payment.payment_date !== expected.paymentDate || payment.receipt_no !== expected.receiptNo
    || payment.currency !== "XOF" || money(payment.exchange_rate_to_xof) !== 1) {
    issues.push("payment_request_mismatch");
  }
  if (!audit?.id || audit.actorId !== expected.actorId || audit.action !== "supplementary_payment") {
    issues.push("audit_actor_mismatch");
  }
  const paid = money(booking?.prepaidAmountXof);
  const total = money(booking?.finalAmountXof ?? booking?.totalAmountXof);
  if (booking?.id !== expected.bookingId || paid === null || total === null) {
    issues.push("booking_finance_invalid");
  }
  // The current daily model has one non-cancelled receivable for an order.
  const receivables = evidence?.receivables;
  if (!Array.isArray(receivables) || receivables.length !== 1) {
    issues.push("receivable_count_mismatch");
  } else {
    const receivable = record(receivables[0]);
    if (!receivable?.id || paid === null || total === null
      || money(receivable.amountXof) !== total
      || money(receivable.paidAmountXof) !== Math.min(total, paid)
      || (paid >= total ? receivable.status !== "paid"
        : paid > 0 ? receivable.status !== "partial"
        : !["pending", "overdue"].includes(String(receivable.status)))) {
      issues.push("receivable_finance_mismatch");
    }
  }
  return { verified: issues.length === 0, issues };
}
