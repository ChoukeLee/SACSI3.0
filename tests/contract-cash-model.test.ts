import { describe, expect, it } from "vitest";
import type { PaymentRow } from "@/types/database";
import {
  classifyContractCashPayment,
  summarizeContractCash,
} from "@/features/contracts/contract-cash-model";

const payment = (values: Partial<PaymentRow> = {}) =>
  ({
    id: "p",
    source_type: "lease_rent",
    amount: 100,
    currency: "XOF",
    exchange_rate_to_xof: 1,
    payment_method: "cash",
    ...values,
  }) as PaymentRow;
describe("contract cash semantics", () => {
  it("separates operating cash from refundable deposits and does not count deposit deduction as cash", () => {
    expect(
      summarizeContractCash([
        payment(),
        payment({ source_type: "lease_deposit", amount: 300 }),
        payment({ source_type: "lease_deposit_refund", amount: 50 }),
        payment({ source_type: "lease_rent_refund", amount: 20 }),
        payment({ source_type: "lease_deposit_deduction", amount: 30 }),
      ]),
    ).toEqual({
      income: 100,
      expense: 20,
      net: 80,
      depositIn: 300,
      depositOut: 50,
      excludedCount: 1,
      nonCashCount: 0,
    });
  });
  it("requires historical FX, rejects negative and unverifiable reversal rows, and excludes offsets", () => {
    expect(
      summarizeContractCash([
        payment({ amount: 10, currency: "CNY", exchange_rate_to_xof: 80 }),
        payment({ currency: "CNY", exchange_rate_to_xof: 0 }),
        payment({ amount: -100 }),
        payment({ request_kind: "daily_reversal", reversal_of_payment_id: "original" }),
        payment({ payment_method: "offset" }),
      ]),
    ).toEqual({
      income: 800,
      expense: 0,
      net: 800,
      depositIn: 0,
      depositOut: 0,
      excludedCount: 3,
      nonCashCount: 1,
    });
  });
  it("never derives a refund from notes and does not classify daily cash without the strict receipt model", () => {
    expect(
      classifyContractCashPayment(payment({ notes: "退款 REFUND", receipt_no: "REFUND" })),
    ).toEqual({ kind: "income", amountXof: 100 });
    expect(classifyContractCashPayment(payment({ source_type: "daily_booking" })).kind).toBe(
      "excluded",
    );
    expect(classifyContractCashPayment(payment({ exchange_rate_to_xof: 2 })).reason).toBe(
      "currency_rate_mismatch",
    );
  });
  it("uses each payment's historical rate and rounds each converted XOF line before adding", () => {
    expect(
      summarizeContractCash([
        payment({ currency: "CNY", amount: 100, exchange_rate_to_xof: 80 }),
        payment({ currency: "CNY", amount: 100, exchange_rate_to_xof: 85 }),
        payment({ currency: "USD", amount: 1.1, exchange_rate_to_xof: 600.4 }),
        payment({ currency: "USD", amount: 1.1, exchange_rate_to_xof: 600.4 }),
      ]).income,
    ).toBe(17820.88);
  });
  it("retains valid fractional XOF from the two-decimal contract RPC instead of rounding to integers", () => {
    const line = payment({ currency: "CNY", amount: 2, exchange_rate_to_xof: 90.7 });
    expect(classifyContractCashPayment(line)).toEqual({ kind: "income", amountXof: 181.4 });
    expect(summarizeContractCash([line, { ...line, id: "p2" }]).income).toBe(362.8);
  });
});
