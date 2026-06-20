import { describe, it, expect } from "vitest";
import { calculateBilling } from "../src/features/daily-rentals/billing";
import type { DailyBookingRow } from "../src/types/database";

function booking(overrides: Partial<DailyBookingRow> = {}): DailyBookingRow {
  return {
    id: "b1", unit_id: "u1", customer_id: "c1",
    check_in: "2026-06-01", check_out: "2026-06-05",
    checkout_mode: "fixed", actual_check_out: null,
    nightly_price_xof: 40000, total_amount_xof: 160000,
    prepaid_amount_xof: 0, billing_status: "prepaid",
    manual_discount_amount_xof: 0, manual_discount_reason: null,
    final_amount_xof: null, status: "checked_in",
    ota_source: null, notes: null,
    created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

describe("calculateBilling", () => {
  describe("fixed check-out", () => {
    it("calculates 4 nights for Jun 1 - Jun 5", () => {
      const b = booking({ check_in: "2026-06-01", check_out: "2026-06-05", nightly_price_xof: 40000 });
      const result = calculateBilling(b, "2026-06-03");
      expect(result.nights).toBe(4);
      expect(result.grossAmount).toBe(160000); // 4 × 40000
    });

    it("minimum 1 night even if same day", () => {
      const b = booking({ check_in: "2026-06-01", check_out: "2026-06-01" });
      const result = calculateBilling(b, "2026-06-01");
      expect(result.nights).toBe(1);
      expect(result.grossAmount).toBe(40000);
    });

    it("handles manual discount", () => {
      const b = booking({ nightly_price_xof: 40000, manual_discount_amount_xof: 30000 });
      const result = calculateBilling(b, "2026-06-03");
      expect(result.discount).toBe(30000);
      expect(result.finalAmount).toBe(130000);
    });

    it("does not recalculate finalAmount for checked_out fixed bookings", () => {
      const b = booking({
        status: "checked_out", final_amount_xof: 100000,
        nightly_price_xof: 40000, manual_discount_amount_xof: 0,
      });
      const result = calculateBilling(b, "2026-06-10");
      expect(result.finalAmount).toBe(100000); // uses stored value
    });
  });

  describe("open check-out", () => {
    it("open checked_in recalculates through reference date", () => {
      const b = booking({
        checkout_mode: "open", check_out: null, status: "checked_in",
        check_in: "2026-06-01", nightly_price_xof: 40000,
      });
      // reference "2026-06-08" = 7 nights
      const result = calculateBilling(b, "2026-06-08");
      expect(result.nights).toBe(7);
      expect(result.grossAmount).toBe(280000);
      expect(result.mode).toBe("open");
    });

    it("open with actual_check_out uses that date", () => {
      const b = booking({
        checkout_mode: "open", actual_check_out: "2026-06-03",
        check_in: "2026-06-01", nightly_price_xof: 40000,
      });
      const result = calculateBilling(b, "2026-06-10");
      expect(result.nights).toBe(2);
    });

    it("eligibleForMonthlyDiscount at 30+ nights", () => {
      const b = booking({
        checkout_mode: "open", check_out: null, status: "checked_in",
        check_in: "2026-01-01", nightly_price_xof: 40000,
      });
      const result = calculateBilling(b, "2026-02-01"); // 31 nights
      expect(result.nights).toBe(31);
      expect(result.eligibleForMonthlyDiscount).toBe(true);
    });

    it("not eligible for discount under 30 nights", () => {
      const b = booking({
        checkout_mode: "open", check_out: null, status: "checked_in",
        check_in: "2026-06-01", nightly_price_xof: 40000,
      });
      const result = calculateBilling(b, "2026-06-15"); // 14 nights
      expect(result.eligibleForMonthlyDiscount).toBe(false);
    });
  });

  describe("outstanding calculation", () => {
    it("full prepaid = zero outstanding", () => {
      const b = booking({ prepaid_amount_xof: 160000 });
      const result = calculateBilling(b, "2026-06-03");
      expect(result.outstanding).toBe(0);
    });

    it("partial prepaid = positive outstanding", () => {
      const b = booking({ prepaid_amount_xof: 50000 });
      const result = calculateBilling(b, "2026-06-03");
      expect(result.outstanding).toBe(110000);
    });

    it("outstanding never negative", () => {
      const b = booking({ prepaid_amount_xof: 999999 });
      const result = calculateBilling(b, "2026-06-03");
      expect(result.outstanding).toBe(0);
    });
  });
});
