import { describe, expect, it } from "vitest";
import { buildPaymentPreview } from "@/features/business-actions/operator-payment-preview";
import { previewRequest, previewSnapshot } from "./fixtures/operator-preview";

describe("single fixed-stay screenshot preview", () => {
  it("shows proposed financial effect without mutating the snapshot", () => {
    const snapshot = previewSnapshot(); const original = structuredClone(snapshot);
    expect(buildPaymentPreview(previewRequest(), snapshot)).toMatchObject({ success: true, preview: {
      amountXof: 10000, paidBeforeXof: 10000, paidAfterXof: 20000, outstandingBeforeXof: 20000, outstandingAfterXof: 10000 } });
    expect(snapshot).toEqual(original);
  });
  it.each(["natural_language", "structured_batch", "manual_form"] as const)("does not expand scope to %s", inputSource => {
    expect(buildPaymentPreview({ ...previewRequest(), inputSource }, previewSnapshot()).success).toBe(false);
  });
  it.each(["status", "open", "amount", "paid", "customer", "currency", "receivables", "request"])("rejects problematic %s", field => {
    const snapshot = previewSnapshot();
    if (field === "status") snapshot.booking.status = "cancelled";
    if (field === "open") snapshot.booking.checkout_mode = "open";
    if (field === "amount") snapshot.booking.final_amount_xof = 15000;
    if (field === "paid") snapshot.receivables[0].paid_amount_xof = 0;
    if (field === "customer") snapshot.receivables[0].customer_id = "other";
    if (field === "currency") snapshot.receivables[0].currency = "USD";
    if (field === "receivables") snapshot.receivables.push({ ...snapshot.receivables[0] });
    if (field === "request") snapshot.payments[0].request_id = previewRequest().requestId;
    expect(buildPaymentPreview(previewRequest(), snapshot).success).toBe(false);
  });
  it("rejects excessive payments", () => {
    const request = previewRequest(); request.input.amountXof = 30000;
    expect(buildPaymentPreview(request, previewSnapshot())).toMatchObject({ success: false, code: "payment_exceeds_outstanding" });
  });
  it.each([null, {}, { booking: {} }, { ...previewSnapshot(), receivables: [null] }])("rejects malformed snapshots", snapshot => {
    expect(buildPaymentPreview(previewRequest(), snapshot).success).toBe(false);
  });
});
