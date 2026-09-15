import { describe, expect, it } from "vitest";
import {
  parseOperatorActionRequest,
  parseQueryDailyBookingInput,
  parseRecordDailyPaymentInput,
  parseRenewLeaseInput,
  validateOperatorCompatibility,
} from "./operator-action-contract";

const requestId = "123e4567-e89b-42d3-a456-426614174000";

describe("operator action contract", () => {
  it("accepts a bounded, versioned action envelope", () => {
    const result = parseOperatorActionRequest({
      protocolVersion: "1.0",
      connectorVersion: "0.1.0",
      requestId,
      actionName: "record_daily_payment",
      inputSource: "natural_language",
      originalInstruction: "登记 11#503 今日收款 4 万",
      input: { bookingId: requestId, amountXof: 40_000, paymentDate: "2026-09-14" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects mismatched protocol and old connector versions", () => {
    expect(validateOperatorCompatibility({ protocolVersion: "2.0", connectorVersion: "0.1.0" })).toMatchObject({ success: false, code: "protocol_version_mismatch" });
    expect(validateOperatorCompatibility({ protocolVersion: "1.0", connectorVersion: "0.0.9" })).toMatchObject({ success: false, code: "connector_upgrade_required" });
  });

  it("requires an unambiguous booking selector", () => {
    expect(parseQueryDailyBookingInput({ buildingCode: "SACSI11" })).toMatchObject({ success: false, code: "selector_required" });
    expect(parseQueryDailyBookingInput({ bookingId: requestId, buildingCode: "SACSI11", unitNo: "503" })).toMatchObject({ success: false, code: "selector_conflict" });
    expect(parseQueryDailyBookingInput({ buildingCode: "SACSI11", unitNo: "503" })).toMatchObject({
      success: true,
      data: { bookingId: null, buildingCode: "SACSI11", unitNo: "503" },
    });
  });

  it("accepts integer XOF and rejects fractional or invalid dates", () => {
    expect(parseRecordDailyPaymentInput({ bookingId: requestId, amountXof: 40_000, paymentDate: "2026-09-14" })).toMatchObject({ success: true });
    expect(parseRecordDailyPaymentInput({ bookingId: requestId, amountXof: 1.5, paymentDate: "2026-09-14" })).toMatchObject({ success: false, code: "invalid_payment_amount" });
    expect(parseRecordDailyPaymentInput({ bookingId: requestId, amountXof: 40_000, paymentDate: "2026-02-30" })).toMatchObject({ success: false, code: "invalid_payment_date" });
    expect(parseRecordDailyPaymentInput({ bookingId: requestId, amountXof: 40_000, paymentDate: "2026-99-99" })).toMatchObject({ success: false, code: "invalid_payment_date" });
  });

  it("requires a valid contract and extension date for lease renewal", () => {
    expect(parseRenewLeaseInput({ contractId: requestId, newEndDate: "2026-10-09" })).toMatchObject({
      success: true,
      data: { contractId: requestId, newEndDate: "2026-10-09" },
    });
    expect(parseRenewLeaseInput({ contractId: requestId, newEndDate: "2026-02-30" })).toMatchObject({ success: false, code: "invalid_end_date" });
    expect(parseRenewLeaseInput({ contractId: "not-a-uuid", newEndDate: "2026-10-09" })).toMatchObject({ success: false, code: "invalid_contract_id" });
  });
});
