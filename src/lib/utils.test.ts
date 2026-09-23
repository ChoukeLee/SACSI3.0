import { describe, expect, it } from "vitest";
import { floorSortValue, normalizeFloorLabel, sortUnitsForBuilding } from "./utils";

const units = [
  { unit_no: "A101", floor_label: "A座1F" },
  { unit_no: "B101", floor_label: "B座1F" },
  { unit_no: "A102", floor_label: "A座1F" },
  { unit_no: "B102", floor_label: "B座1F" },
  { unit_no: "B103", floor_label: "B座1F" },
];

describe("sortUnitsForBuilding", () => {
  it("groups SACSI3 units by wing within each floor", () => {
    expect(sortUnitsForBuilding(units, "SACSI3").map((unit) => unit.unit_no)).toEqual([
      "A101",
      "A102",
      "B101",
      "B102",
      "B103",
    ]);
  });

  it("keeps the shared numeric unit ordering for other buildings", () => {
    expect(sortUnitsForBuilding(units, "SACSI5").map((unit) => unit.unit_no)).toEqual([
      "A101",
      "B101",
      "A102",
      "B102",
      "B103",
    ]);
  });
});

describe("mezzanine floor labels", () => {
  it("keeps the mezzanine between G and 1F", () => {
    expect(normalizeFloorLabel("夹层", "01")).toBe("夹层");
    expect(floorSortValue("G")).toBeLessThan(floorSortValue("夹层"));
    expect(floorSortValue("夹层")).toBeLessThan(floorSortValue("1F"));
  });
});
