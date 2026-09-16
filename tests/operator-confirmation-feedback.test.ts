import { expect, it } from "vitest";
import { confirmationFeedback } from "@/features/business-actions/operator-confirmation-feedback";
it.each(["browser_confirmation_required","confirmationExpired","confirmationSnapshotChanged","confirmationRequestConflict","confirmationForbidden","confirmationNotFound","confirmationResultInvalid","confirmation_result_unverified","bookingFinanceInconsistent","paymentExceedsOutstanding"])("stops automatic user retries for %s", code => {
  expect(confirmationFeedback(code).retry).toBe(false);
  expect(confirmationFeedback(code).message).not.toContain(code);
});
it("allows only original-confirmation recovery for uncertain outcomes", () => {
  const feedback = confirmationFeedback("confirmation_outcome_unknown");
  expect(feedback.retry).toBe(true); expect(feedback.message).toContain("不要换请求号");
  expect(confirmationFeedback({ private: "diagnostic" }).message).not.toContain("diagnostic");
});
