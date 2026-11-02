import { describe, expect, it } from "vitest";
import {
  cimacApartmentPlan,
  cimacApartmentFees,
  parseCimacApartmentQuery,
} from "@/features/cimac/cimac-apartment-model";

describe("confirmed CIMAC apartment catalogue", () => {
  it("has 64 unique rooms, 52 one-bedroom and 12 two-bedroom units, not commercial 1701–1704", () => {
    const rooms = cimacApartmentPlan();
    expect(rooms).toHaveLength(64);
    expect(new Set(rooms.map((r) => r.unitNo)).size).toBe(64);
    expect(rooms.filter((r) => r.bedrooms === 1)).toHaveLength(52);
    expect(rooms.filter((r) => r.bedrooms === 2)).toHaveLength(12);
    expect(rooms.filter((r) => r.facing === "east")).toHaveLength(36);
    expect(rooms.filter((r) => r.facing === "west")).toHaveLength(28);
    expect(rooms.some((r) => r.unitNo.startsWith("17"))).toBe(false);
  });
  it.each([2, 3, 4, 5])(
    "retains the corrected x14/x16 types and non-parity facing on floor %s",
    (floor) => {
      const rooms = cimacApartmentPlan().filter((r) => r.floor === floor);
      expect(rooms).toHaveLength(16);
      expect(rooms.find((r) => r.suffix === 14)?.bedrooms).toBe(1);
      expect(rooms.find((r) => r.suffix === 16)?.bedrooms).toBe(2);
      expect(rooms.find((r) => r.suffix === 10)?.facing).toBe("east");
      expect(rooms.find((r) => r.suffix === 11)?.facing).toBe("west");
      expect(rooms.filter((r) => r.bedrooms === 2).map((r) => r.suffix)).toEqual([11, 15, 16]);
    },
  );
  it("calculates standard full-year quotes, not actual receivables or payments", () => {
    const rooms = cimacApartmentPlan();
    expect(cimacApartmentFees(rooms[0])).toEqual({
      depositXof: 700000,
      prepaidRentXof: 2100000,
      annualPropertyFeeXof: 360000,
      standardInitialTotalXof: 3160000,
    });
    expect(cimacApartmentFees(rooms[10])).toEqual({
      depositXof: 1200000,
      prepaidRentXof: 3600000,
      annualPropertyFeeXof: 480000,
      standardInitialTotalXof: 5280000,
    });
    expect(rooms[0]).not.toHaveProperty("occupant");
    expect(rooms[0]).not.toHaveProperty("startDate");
    expect(rooms[0]).not.toHaveProperty("paidAmount");
  });
  it("does not share mutable catalogue rows across calls", () => {
    const a = cimacApartmentPlan();
    a[0].monthlyRentXof = 1;
    expect(cimacApartmentPlan()[0].monthlyRentXof).toBe(350000);
  });
  it("parses only an explicit floor/room/detail tab", () => {
    expect(parseCimacApartmentQuery({})).toEqual({ floor: 2, suffix: 1, tab: "fees" });
    expect(parseCimacApartmentQuery({ floor: "5", room: "516", tab: "room" })).toEqual({
      floor: 5,
      suffix: 16,
      tab: "room",
    });
    expect(parseCimacApartmentQuery({ floor: "3" })).toEqual({ floor: 3, suffix: 1, tab: "fees" });
  });
  it.each([
    { floor: "1" },
    { floor: "6" },
    { floor: "2", room: "301" },
    { floor: "3", room: "317" },
    { room: "1703" },
    { floor: ["2", "3"] },
    { floor: 2 },
    { tab: "receipts" },
    { project: "OTHER" },
    { room: "201\n" },
    { floor: "02" },
  ])("rejects a malformed or cross-floor selection %j", (query) => {
    expect(() => parseCimacApartmentQuery(query)).toThrow("CimacApartmentInvalidQuery");
  });
});
