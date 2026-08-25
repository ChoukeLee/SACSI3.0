import { describe, expect, it } from "vitest";
import { CIMAC_SITE_GROUPS, CIMAC_SITE_ROWS, matchesCimacShopQuery, orderCimacShopsForPlan } from "@/app/management/cimac-site-layout";

const shops = (numbers: number[]) => numbers.map((unitNo) => ({ unitNo: String(unitNo) }));

describe("CIMAC site-plan ordering", () => {
  it("keeps even buildings north of the avenue and odd buildings south", () => {
    expect(CIMAC_SITE_ROWS.north).toEqual([10, 8, 6, 4, 2]);
    expect(CIMAC_SITE_ROWS.south).toEqual([9, 7, 5, 3, 1]);
  });

  it("groups the physically joined buildings without merging their identities", () => {
    expect(CIMAC_SITE_GROUPS.north).toEqual([[10], [8, 6], [4], [2]]);
    expect(CIMAC_SITE_GROUPS.south).toEqual([[9], [7, 5], [3], [1]]);
  });

  it("runs northern single-column shops toward the central avenue", () => {
    expect(orderCimacShopsForPlan(6, shops([601, 602, 603, 604])).map((shop) => shop.unitNo)).toEqual(["604", "603", "602", "601"]);
  });

  it("places even-numbered shops left and odd-numbered shops right in two-column buildings", () => {
    expect(orderCimacShopsForPlan(2, shops([201, 202, 203, 204])).map((shop) => shop.unitNo)).toEqual(["204", "203", "202", "201"]);
    expect(orderCimacShopsForPlan(3, shops([301, 302, 303, 304])).map((shop) => shop.unitNo)).toEqual(["302", "301", "304", "303"]);
  });

  it("finds a shop by room, merchant, business, or building", () => {
    const shop = { unitNo: "612", tenantName: "彭力松", mainBusiness: "家具" };
    const building = { code: "CIMAC-B06", displayName: "第六栋" };

    expect(matchesCimacShopQuery(shop, building, "612")).toBe(true);
    expect(matchesCimacShopQuery(shop, building, "彭力")).toBe(true);
    expect(matchesCimacShopQuery(shop, building, "家具")).toBe(true);
    expect(matchesCimacShopQuery(shop, building, "b06")).toBe(true);
    expect(matchesCimacShopQuery(shop, building, "服装")).toBe(false);
  });
});
