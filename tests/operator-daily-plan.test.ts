import { it, expect } from "vitest";
import { buildDailyChangePlan, parseDailyChangeRequest, type DailyChangeRequest } from "@/features/business-actions/operator-daily-plan";
import { previewBooking, previewSnapshot } from "./fixtures/operator-preview";

const request = (changes: Partial<DailyChangeRequest> = {}): DailyChangeRequest => ({ bookingId: previewBooking, operation: "extend_and_collect",
  originalInstruction: "合成订单续住22晚并收款88万", effectiveCheckOut: "2026-10-11", amountXof: 880000, paymentDate: "2026-09-22", paymentMethod: "cash", ...changes });
const snapshot = () => {
  const value = previewSnapshot();
  Object.assign(value.booking, { check_in: "2026-09-19", check_out: "2026-09-29", nightly_price_xof: 40000, total_amount_xof: 400000, final_amount_xof: 400000, prepaid_amount_xof: 0 });
  Object.assign(value.receivables[0], { amount_xof: 400000, paid_amount_xof: 0 }); value.payments = [];
  return value;
};
it("previews all extension and payment effects without producing a write token", () => {
  const result = buildDailyChangePlan(request(), snapshot(), "2026-09-22");
  expect(result).toMatchObject({ status: "proposal_only", executionAllowed: false, confirmationAvailable: false, historicalDebtIncluded: false,
    changes: { checkOut: { before: "2026-09-29", after: "2026-10-11" }, totalXof: { before: 400000, after: 880000 }, paidXof: { before: 0, after: 880000 }, outstandingXof: { after: 0 } } });
  expect(result).not.toHaveProperty("confirmationPath"); expect(result).not.toHaveProperty("previewProof");
});
it("previews checkout and cleaning while leaving unrelated history untouched", () => {
  const result = buildDailyChangePlan(request({ operation: "checkout_and_collect", effectiveCheckOut: "2026-09-22", amountXof: 120000 }), snapshot(), "2026-09-22");
  expect(result).toMatchObject({ status: "proposal_only", cleaningRequired: true, historicalDebtIncluded: false,
    changes: { bookingStatus: { after: "checked_out" }, actualCheckOut: { after: "2026-09-22" }, totalXof: { after: 120000 } } });
});
it("never defaults payment date, amount, method or checkout date", () => {
  const result = buildDailyChangePlan(request({ amountXof: undefined, paymentDate: undefined, paymentMethod: undefined, effectiveCheckOut: undefined }), snapshot(), "2026-09-22");
  expect(result).toMatchObject({ status: "clarification_required", missing: ["effectiveCheckOut", "amountXof", "paymentDate", "paymentMethod"] });
});
it("requires assistance for an additional discount instead of silently recalculating it", () => {
  const s = snapshot(); Object.assign(s.booking, { manual_discount_amount_xof: 10000 });
  expect(buildDailyChangePlan(request(), s, "2026-09-22")).toMatchObject({ code: "special_pricing" });
});
it("retains a stored whole-stay discounted nightly rate", () => {
  const s = snapshot(); Object.assign(s.booking, { nightly_price_xof: 90000, total_amount_xof: 900000, final_amount_xof: 900000 });
  s.receivables[0].amount_xof = 900000;
  expect(buildDailyChangePlan(request({ amountXof: 900000 }), s, "2026-09-22")).toMatchObject({ status: "proposal_only", pricingBasis: { nightlyRateXof: 90000 } });
});
it.each([
  { paymentDate: "2026-09-23" }, { effectiveCheckOut: "2026-09-28" }, { amountXof: 900000 },
  { operation: "checkout_and_collect" as const, effectiveCheckOut: "2026-09-23" },
])("blocks invalid date/overpayment %j", change => {
  expect(buildDailyChangePlan(request(change), snapshot(), "2026-09-22").status).toBe("assistance_required");
});
it("stops on mismatched receivables or payment evidence", () => {
  const s = snapshot(); s.receivables[0].amount_xof = 1;
  expect(buildDailyChangePlan(request(), s, "2026-09-22")).toMatchObject({ code: "inconsistent_receivable" });
  const p = snapshot(); p.payments = previewSnapshot().payments;
  expect(buildDailyChangePlan(request(), p, "2026-09-22")).toMatchObject({ code: "inconsistent_payments" });
});
it.each([{ paymentDate: "2026-02-30" }, { paymentMethod: "unknown" }, { actorId: previewBooking }, { amountXof: null }, { amountXof: -1 }])("rejects malformed plan %j", change => {
  expect(() => parseDailyChangeRequest({ ...request(), ...change })).toThrow();
});
