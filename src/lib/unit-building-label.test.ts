import { describe, expect, it } from "vitest";
import { qualifiedUnitNo, unitBuildingLabel } from "./unit-building-label";

describe("unit building labels", () => {
  it("supports the legacy SACSI11 unit code", () => {
    expect(unitBuildingLabel({ code: "SACSI-1101" })).toBe("11#");
    expect(qualifiedUnitNo({ code: "SACSI-505", unit_no: "505" })).toBe("11#505");
  });

  it("supports numbered building unit codes", () => {
    expect(qualifiedUnitNo({ code: "SACSI5-1101", unit_no: "1101" })).toBe("5#1101");
  });
});
