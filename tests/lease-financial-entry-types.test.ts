import { describe, expect, it } from "vitest";
import {
  buildLeaseContractNumber,
  buildLeaseFinancialReferencePrefix,
  getLeaseFinancialConfig,
  isLeaseFinancialExpenseSourceType,
} from "@/features/leases/lease-financial-entry-types";

describe("lease financial business types", () => {
  it("builds a lease contract number from the selected long-lease business context", () => {
    expect(buildLeaseContractNumber("SACSI11", "103", "2026-03-07"))
      .toBe("LEASE-SACSI11-103-20260307");
  });

  it("builds business-specific financial references", () => {
    expect(buildLeaseFinancialReferencePrefix("LEASE-SACSI11-103-20260307", "rent_income", "2026-06-08"))
      .toBe("LEASE-SACSI11-103-20260307-RENT-20260608");
    expect(buildLeaseFinancialReferencePrefix("LEASE-SACSI11-103-20260307", "agency_expense", "2026-03-06"))
      .toBe("LEASE-SACSI11-103-20260307-AGE-20260306");
  });

  it("keeps income, liabilities, and expenses semantically distinct", () => {
    expect(getLeaseFinancialConfig("deposit_income").ledgerDirection).toBe("liability_in");
    expect(isLeaseFinancialExpenseSourceType("lease_agency_expense")).toBe(true);
    expect(isLeaseFinancialExpenseSourceType("lease_deposit_refund")).toBe(true);
    expect(isLeaseFinancialExpenseSourceType("lease_rent")).toBe(false);
  });
});
