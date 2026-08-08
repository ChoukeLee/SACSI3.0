import { describe, expect, it } from "vitest";
import {
  appendSaleFinancialSequence,
  buildSaleFinancialReferencePrefix,
  getNextSaleFinancialSequence,
} from "@/features/sales/sale-financial-reference";

describe("sale financial references", () => {
  it("uses the same building, unit, date and business structure for every sale payment", () => {
    const prefix = buildSaleFinancialReferencePrefix("SACSI5", "1301", "2026-08-06");
    expect(prefix).toBe("WB5-SALE-1301-20260806-HOUSE");
    expect(appendSaleFinancialSequence(prefix, 2)).toBe("WB5-SALE-1301-20260806-HOUSE-02");
  });

  it("continues the contract-wide sequence", () => {
    expect(getNextSaleFinancialSequence([
      "WB5-SALE-1301-20260711-REGISTRATION-01",
      "WB5-SALE-1301-20260806-HOUSE-02",
      "EXTERNAL-RECEIPT-99",
    ])).toBe(3);
  });
});
