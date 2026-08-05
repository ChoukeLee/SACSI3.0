import { describe, expect, it } from "vitest";
import { isFinancialExpenseSourceType } from "@/lib/display-labels";

describe("financial display tones", () => {
  it.each([
    "agency_expense",
    "lease_agency_expense",
    "lease_other_expense",
    "sale_agency_expense",
    "sale_other_expense",
    "other_expense",
    "lease_deposit_refund",
    "lease_rent_refund",
    "sale_deposit_refund",
  ])("marks %s as an expense or cash outflow", (sourceType) => {
    expect(isFinancialExpenseSourceType(sourceType)).toBe(true);
  });

  it.each(["lease_rent", "lease_deposit", "lease_agency_income", "sale", "daily_rental"])(
    "does not mark %s as an expense",
    (sourceType) => {
      expect(isFinancialExpenseSourceType(sourceType)).toBe(false);
    },
  );
});
