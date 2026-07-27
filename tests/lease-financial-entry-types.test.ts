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
      .toBe("WB-LEASE-SACSI11-103-20260307");
  });

  it("builds standardized business-specific financial references", () => {
    expect(buildLeaseFinancialReferencePrefix("SACSI11", "103", "WB-LEASE-SACSI11-103-20260307", "rent_income", "2026-06-08"))
      .toBe("WB11-LEASE-103-20260608-RENT");
    expect(buildLeaseFinancialReferencePrefix("SACSI11", "103", "WB-LEASE-SACSI11-103-20260307", "agency_expense", "2026-03-06"))
      .toBe("WB11-LEASE-103-20260306-AGE");
  });

  it("preserves a standardized special-asset reference from the contract number", () => {
    expect(buildLeaseFinancialReferencePrefix("SACSI4", "大仓库", "WB-LEASE-SACSI4-WAREHOUSE-LARGE-20260501", "rent_income", "2026-07-01"))
      .toBe("WB4-LEASE-WAREHOUSE-LARGE-20260701-RENT");
  });

  it("keeps income, liabilities, and expenses semantically distinct", () => {
    expect(getLeaseFinancialConfig("deposit_income").ledgerDirection).toBe("liability_in");
    expect(isLeaseFinancialExpenseSourceType("lease_agency_expense")).toBe(true);
    expect(isLeaseFinancialExpenseSourceType("lease_deposit_refund")).toBe(true);
    expect(isLeaseFinancialExpenseSourceType("lease_rent")).toBe(false);
  });
});
