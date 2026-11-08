import { describe, expect, it } from "vitest";
import {
  formatPropertyMoney,
  formatPropertyXof,
  formatPropertyXofNumber,
  propertyLeaseRentLabel,
  propertyPaymentDisplay,
} from "@/lib/property-money";
import { formatMoney, paymentDisplay } from "@/lib/currency";
import type { LeaseContractRow, PaymentRow } from "@/types/database";

describe("property workspace money display", () => {
  it.each([
    [650000, "65 万西法"],
    [170000000, "17,000 万西法"],
    [88422093.12, "8,842.209312 万西法"],
    [0.01, "0.000001 万西法"],
    [-325000, "−32.5 万西法"],
    [0, "0 万西法"],
    ["6.5e5", "65 万西法"],
    ["9999999999999999.99", "999,999,999,999.999999 万西法"],
  ])("scales %s XOF without discarding XOF cents", (amount, expected) => {
    expect(formatPropertyXof(amount)).toBe(expected);
  });

  it.each([null, undefined, "", " ", "bad", NaN, Infinity])(
    "keeps an unknown or invalid amount %s distinct from zero",
    (amount) => expect(formatPropertyXof(amount)).toBe("—"),
  );

  it("shares the exact scale across separated card units, aliases and French labels", () => {
    expect(formatPropertyXofNumber("88422093.12")).toBe("8,842.209312");
    expect(formatPropertyMoney(650000, "FCFA")).toBe("65 万西法");
    expect(formatPropertyMoney(650000, "xof")).toBe("65 万西法");
    expect(formatPropertyXof(0.01, "fr")).toBe("0,000001 × 10 000 XOF");
  });

  it.each(["CNY", "USD", "EUR"])("preserves %s in its original currency", (currency) => {
    expect(formatPropertyMoney(720000.12, currency)).toBe(formatMoney(720000.12, currency));
    expect(formatPropertyMoney(null, currency)).toBe("—");
  });

  it("keeps rent and payment payloads in their original units", () => {
    const contract = { monthly_rent_xof: 650000, rent_currency: "XOF" } as LeaseContractRow;
    const payment = { amount: 1950000, currency: "XOF", exchange_rate_to_xof: 1 } as PaymentRow;
    const before = JSON.stringify({ contract, payment });
    expect(propertyLeaseRentLabel(contract)).toBe("65 万西法");
    expect(propertyPaymentDisplay(payment).primary).toBe("195 万西法");
    expect(JSON.stringify({ contract, payment })).toBe(before);
    expect(paymentDisplay(payment).primary).toBe("1,950,000 XOF");
  });

  it("preserves native settlement and only rescales an existing historical reference", () => {
    const payment = { amount: 100, currency: "USD", exchange_rate_to_xof: 600 } as PaymentRow;
    expect(propertyPaymentDisplay(payment)).toEqual({ primary: "$100", secondary: "6 万西法" });
    expect(propertyPaymentDisplay({ ...payment, native_settlement: true })).toEqual(
      paymentDisplay({ ...payment, native_settlement: true }),
    );
    expect(propertyPaymentDisplay({ ...payment, exchange_rate_to_xof: null }).secondary).toBe(
      "历史汇率未核验",
    );
    expect(
      propertyLeaseRentLabel({
        monthly_rent_xof: 0,
        monthly_rent_amount: 1200,
        rent_currency: "USD",
      } as LeaseContractRow),
    ).toBe("$1,200 USD");
  });
});
