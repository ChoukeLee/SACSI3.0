import { describe, expect, it } from "vitest";
import { buildLeaseContractNumber, buildSaleContractNumber } from "@/lib/contract-number";

describe("contract number generation", () => {
  it("uses one stable structure for lease and sale contracts", () => {
    expect(buildLeaseContractNumber("SACSI11", "503", "2026-07-03"))
      .toBe("WB-LEASE-SACSI11-503-20260703");
    expect(buildSaleContractNumber("SACSI3", "A201", "2019-12-16"))
      .toBe("WB-SALE-SACSI3-A201-20191216");
  });

  it("uses stable ASCII references for special units", () => {
    expect(buildLeaseContractNumber("SACSI3", "大门面房", "2026-03-01"))
      .toBe("WB-LEASE-SACSI3-STOREFRONT-L-20260301");
    expect(buildSaleContractNumber("SACSI5", "6F前楼", "2026-06-01"))
      .toBe("WB-SALE-SACSI5-6F-FRONT-20260601");
  });
});
