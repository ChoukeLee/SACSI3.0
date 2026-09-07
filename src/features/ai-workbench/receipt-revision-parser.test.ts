import { describe, expect, it } from "vitest";
import { parseReceiptRevisionInstruction } from "./receipt-revision-parser";

describe("receipt revision parser", () => {
  it("parses concise Chinese corrections with scaled amounts", () => {
    expect(parseReceiptRevisionInstruction("房号改成 503，金额改为 25 万，这笔是物业费")).toEqual({
      roomNo: "503",
      amountXof: 250_000,
      businessHint: "property_fee",
    });
  });

  it("parses dates and payment methods", () => {
    expect(parseReceiptRevisionInstruction("付款日期改为 2026-09-06，已缴至 2026-12-31，银行转账")).toEqual({
      receiptDate: "2026-09-06",
      paidThroughDate: "2026-12-31",
      paymentMethod: "bank_transfer",
    });
  });

  it("supports basic French corrections", () => {
    expect(parseReceiptRevisionInstruction("logement 905, montant 150000 XOF, charges, virement")).toEqual({
      roomNo: "905",
      amountXof: 150_000,
      businessHint: "property_fee",
      paymentMethod: "bank_transfer",
    });
  });

  it("rejects instructions without a supported field", () => {
    expect(() => parseReceiptRevisionInstruction("帮我改一下")).toThrow(/无法确定/);
  });
});
