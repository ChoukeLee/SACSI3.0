import { describe, expect, it } from "vitest";
import type { CalendarWindowData } from "@/features/daily-rentals/calendar-window-model";
import { dailyRecordedXofNet } from "@/features/daily-rentals/daily-workbench-payment-model";

function row(amount: number, overrides: Partial<CalendarWindowData["payments"][number]> = {}) {
  return {
    id: "receipt",
    source_id: "booking",
    amount,
    currency: "XOF",
    exchange_rate_to_xof: 1,
    payment_date: "2026-10-20",
    reversal_of_payment_id: null,
    request_kind: null,
    ...overrides,
  };
}
describe("daily workbench recorded payment evidence", () => {
  it("nets only explicit one-to-one XOF evidence including refunds and reversals", () => {
    expect(
      dailyRecordedXofNet([
        row(40000),
        row(-10000, { request_kind: "daily_refund" }),
        row(-5000, { reversal_of_payment_id: "prior" }),
      ]),
    ).toBe(25000);
  });
  it("keeps no recorded lines distinct from missing currency evidence", () => {
    expect(dailyRecordedXofNet([])).toBe(0);
    expect(dailyRecordedXofNet([row(100, { currency: undefined })])).toBeNull();
  });
  it.each(["CNY", "USD", "EUR"])(
    "never sums %s original amounts as XOF even when an exchange rate is present",
    (currency) => {
      expect(
        dailyRecordedXofNet([row(40000), row(100, { currency, exchange_rate_to_xof: 90 })]),
      ).toBeNull();
    },
  );
  it.each([undefined, null, 0, 1.5, NaN])(
    "requires explicit XOF exchange evidence (%s)",
    (exchange_rate_to_xof) => {
      expect(dailyRecordedXofNet([row(100, { exchange_rate_to_xof })])).toBeNull();
    },
  );
  it.each([NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid or noninteger daily amounts (%s)",
    (amount) => {
      expect(dailyRecordedXofNet([row(amount)])).toBeNull();
    },
  );
  it("rejects integer overflow rather than displaying a rounded net amount", () => {
    expect(dailyRecordedXofNet([row(Number.MAX_SAFE_INTEGER), row(1)])).toBeNull();
  });
});
