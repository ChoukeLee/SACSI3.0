import { describe, expect, it } from "vitest";
import { verifyOperatorPaymentEvidence } from "./operator-payment-verification";

const expected = { bookingId: "booking", requestId: "request", actorId: "ying", amountXof: 10000, paymentDate: "2026-09-15", receiptNo: null };
function evidence() {
  return {
    verified: true,
    evidenceVersion: 2,
    checks: { payment: true, bookingFinance: true, receivables: true, ledger: true, audit: true },
    payment: { id: "payment", source_type: "daily_booking", source_id: "booking", request_kind: "daily_payment", request_id: "request", amount: 10000, payment_date: "2026-09-15", receipt_no: null, currency: "XOF", exchange_rate_to_xof: 1 },
    booking: { id: "booking", prepaidAmountXof: 20000, finalAmountXof: 30000 },
    audit: { id: "audit", actorId: "ying", action: "supplementary_payment" },
    receivables: [{ id: "receivable", amountXof: 30000, paidAmountXof: 20000, status: "partial" }],
  };
}

describe("operator payment evidence", () => {
  it("rejects old database evidence even when its existence-only flag is true", () => {
    const value = evidence();
    value.evidenceVersion = 1;
    expect(verifyOperatorPaymentEvidence(value, expected).issues).toContain("database_evidence_version_mismatch");
  });
  it("rejects a failed database ledger check even when the summary flag is true", () => {
    const value = evidence();
    value.checks.ledger = false;
    expect(verifyOperatorPaymentEvidence(value, expected).issues).toContain("database_ledger_check_failed");
  });
  it("accepts matching persisted payment and current financial evidence", () => {
    expect(verifyOperatorPaymentEvidence(evidence(), expected)).toEqual({ verified: true, issues: [] });
  });
  it.each([
    { amountXof: 20000 }, { paymentDate: "2026-09-14" }, { receiptNo: "R2" },
    { requestId: "another" }, { bookingId: "another" }, { actorId: "admin" },
  ])("does not report success when a retry changes %j", (change) => {
    expect(verifyOperatorPaymentEvidence(evidence(), { ...expected, ...change }).verified).toBe(false);
  });
  it.each([null, {}, { verified: true }, [], { verified: "true" }])("rejects incomplete evidence %j", (value) => {
    expect(verifyOperatorPaymentEvidence(value, expected).verified).toBe(false);
  });
  it("rejects missing or duplicate active receivables", () => {
    const value = evidence();
    value.receivables.push({ ...value.receivables[0] });
    expect(verifyOperatorPaymentEvidence(value, expected).issues).toContain("receivable_count_mismatch");
    value.receivables = [];
    expect(verifyOperatorPaymentEvidence(value, expected).verified).toBe(false);
  });
  it.each(["amountXof", "paidAmountXof", "status"] as const)("rejects inconsistent receivable %s", (field) => {
    const value = evidence();
    Object.assign(value.receivables[0], { [field]: field === "status" ? "paid" : 999 });
    expect(verifyOperatorPaymentEvidence(value, expected).issues).toContain("receivable_finance_mismatch");
  });
  it("allows a later valid payment without comparing to an outdated write snapshot", () => {
    const value = evidence();
    value.booking.prepaidAmountXof = 30000;
    value.receivables[0].paidAmountXof = 30000;
    value.receivables[0].status = "paid";
    expect(verifyOperatorPaymentEvidence(value, expected).verified).toBe(true);
  });
  it("accepts exact Postgres numeric strings but rejects coercion and unsafe values", () => {
    const value = evidence();
    Object.assign(value.payment, { amount: "10000.00", exchange_rate_to_xof: "1" });
    expect(verifyOperatorPaymentEvidence(value, expected).verified).toBe(true);
    for (const amount of [true, "", "1e4", Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      Object.assign(value.payment, { amount });
      expect(verifyOperatorPaymentEvidence(value, expected).verified).toBe(false);
    }
  });
});
