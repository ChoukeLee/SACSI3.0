import { describe, it, expect } from "vitest";
import { formatMoney, paymentDisplay, convertToXof, convertFromXof } from "@/lib/currency";

describe("formatMoney", () => {
  it("formats XOF via formatXof (万 FCFA)", () => {
    expect(formatMoney(40000, "XOF")).toBe("4.00万 FCFA");
    expect(formatMoney(40000, "FCFA")).toBe("4.00万 FCFA");
  });
  it("formats CNY with ¥ symbol", () => {
    expect(formatMoney(1234.56, "CNY")).toBe("¥1,234.56");
  });
  it("formats USD and EUR with symbols", () => {
    expect(formatMoney(100, "USD")).toBe("$100");
    expect(formatMoney(100, "EUR")).toBe("€100");
  });
});

describe("paymentDisplay", () => {
  it("XOF payment has only primary", () => {
    const d = paymentDisplay({ amount: 40000, currency: "XOF", exchange_rate_to_xof: 1 });
    expect(d.primary).toBe("4.00万 FCFA");
    expect(d.secondary).toBeNull();
  });
  it("CNY payment has primary + XOF equivalent", () => {
    const d = paymentDisplay({ amount: 1000, currency: "CNY", exchange_rate_to_xof: 600 });
    expect(d.primary).toBe("¥1,000");
    expect(d.secondary).toBe("60.00万 FCFA");
  });
});

describe("convertToXof / convertFromXof", () => {
  it("converts using rate", () => {
    expect(convertToXof(1000, "CNY", 600)).toBe(600000);
    expect(convertFromXof(600000, "CNY", 600)).toBe(1000);
  });
  it("XOF passes through", () => {
    expect(convertToXof(40000, "XOF", 0)).toBe(40000);
  });
});