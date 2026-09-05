import { describe, expect, it } from "vitest";
import { planLeaseFinancialAllocation } from "./financial-draft";

describe("planLeaseFinancialAllocation", () => {
  it("splits only an exact rent plus property transfer", () => {
    expect(planLeaseFinancialAllocation({
      totalAmountXof: 400_000,
      rentOutstandingXof: 350_000,
      propertyOutstandingXof: 50_000,
    })).toMatchObject({ kind: "combined", rentAmountXof: 350_000, propertyAmountXof: 50_000, confidence: 0.99 });
  });

  it("matches a single exact rent balance", () => {
    expect(planLeaseFinancialAllocation({
      totalAmountXof: 350_000,
      rentOutstandingXof: 350_000,
      propertyOutstandingXof: 50_000,
    })).toMatchObject({ kind: "rent", rentAmountXof: 350_000, propertyAmountXof: 0 });
  });

  it("matches a single exact property balance", () => {
    expect(planLeaseFinancialAllocation({
      totalAmountXof: 50_000,
      rentOutstandingXof: 350_000,
      propertyOutstandingXof: 50_000,
    })).toMatchObject({ kind: "property_fee", rentAmountXof: 0, propertyAmountXof: 50_000 });
  });

  it("does not invent a split for an unexplained difference", () => {
    const result = planLeaseFinancialAllocation({
      totalAmountXof: 450_000,
      rentOutstandingXof: 350_000,
      propertyOutstandingXof: 50_000,
    });
    expect(result.kind).toBe("needs_review");
    expect(result.rentAmountXof).toBe(0);
    expect(result.warnings[0]).toContain("不会自动拆分");
  });

  it("keeps equal rent and property balances ambiguous without a hint", () => {
    expect(planLeaseFinancialAllocation({
      totalAmountXof: 100_000,
      rentOutstandingXof: 100_000,
      propertyOutstandingXof: 100_000,
    }).kind).toBe("needs_review");
  });
});
