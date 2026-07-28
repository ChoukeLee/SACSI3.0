import { describe, expect, it } from "vitest";
import {
  getSacsi5OfficeFloorTag,
  isSacsi5CompanyOwnedOffice,
  isSacsi5FrontOfficeUnit,
} from "../src/lib/sacsi5-unit-display";

function unit(overrides: Partial<{ code: string; floor_label: string; kind: "apartment" | "office"; unit_no: string }> = {}) {
  return {
    code: "SACSI5-104",
    floor_label: "1F",
    kind: "apartment" as const,
    unit_no: "104",
    ...overrides,
  };
}

describe("SACSI5 management display", () => {
  it("recognizes explicit front-building office floor plates", () => {
    expect(isSacsi5FrontOfficeUnit("SACSI5", unit({ code: "SACSI5-1F-FRONT", unit_no: "1F前楼" }))).toBe(true);
    expect(isSacsi5FrontOfficeUnit("SACSI5", unit({ code: "SACSI5-8F-FRONT", kind: "office", unit_no: "8F前楼" }))).toBe(true);
  });

  it("separates the sixth-floor office partitions from rear apartments", () => {
    expect(isSacsi5FrontOfficeUnit("SACSI5", unit({ code: "SACSI5-601", floor_label: "6F", unit_no: "601" }))).toBe(true);
    expect(isSacsi5FrontOfficeUnit("SACSI5", unit({ code: "SACSI5-603", floor_label: "6F", unit_no: "603" }))).toBe(true);
    expect(isSacsi5FrontOfficeUnit("SACSI5", unit({ code: "SACSI5-604", floor_label: "6F", unit_no: "604" }))).toBe(false);
  });

  it("does not apply SACSI5 partition rules to another building", () => {
    expect(isSacsi5FrontOfficeUnit("SACSI4", unit({ code: "SACSI4-601", floor_label: "6F", unit_no: "601" }))).toBe(false);
  });

  it("labels the special office-floor cases without introducing statuses", () => {
    const companyOffice = unit({ code: "SACSI5-8F-FRONT", floor_label: "8F", kind: "office", unit_no: "8F前楼" });
    expect(isSacsi5CompanyOwnedOffice("SACSI5", companyOffice)).toBe(true);
    expect(getSacsi5OfficeFloorTag("SACSI5", "6", true, false, "zh")).toBe("半层出租");
    expect(getSacsi5OfficeFloorTag("SACSI5", "8", false, true, "zh")).toBe("公司自购 · 自用");
  });
});
