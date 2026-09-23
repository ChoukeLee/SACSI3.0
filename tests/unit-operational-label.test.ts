import { describe, expect, it } from "vitest";
import { getUnitOperationalLabel } from "../src/lib/unit-display";

describe("unit operational label", () => {
  it("trims holder names and preserves French self-use labels", () => {
    expect(getUnitOperationalLabel({ status: "locked", notes: null, reservation_holder_name: "  骆总  " }, "fr")).toBe("骆总");
    expect(getUnitOperationalLabel({ status: "locked", notes: "self-use", reservation_holder_name: "骆总" }, "fr")).toBe("Usage interne");
  });

  it("does not label available rooms from a stale holder field", () => {
    expect(getUnitOperationalLabel({ status: "available", notes: null, reservation_holder_name: "骆总" }, "zh")).toBeNull();
    expect(getUnitOperationalLabel({ status: "locked", notes: null, reservation_holder_name: "  " }, "zh")).toBeNull();
  });
  it("shows the assigned holder for a locked unit", () => {
    expect(getUnitOperationalLabel({
      status: "locked",
      notes: "房间不可开放",
      reservation_holder_name: "骆总",
    }, "zh")).toBe("骆总");
  });

  it("keeps the generic locked label path when no holder is assigned", () => {
    expect(getUnitOperationalLabel({
      status: "locked",
      notes: "房间不可开放",
      reservation_holder_name: null,
    }, "zh")).toBeNull();
  });

  it("keeps owner-occupied units labelled as self-use", () => {
    expect(getUnitOperationalLabel({
      status: "locked",
      notes: "公司自用",
      reservation_holder_name: "骆总",
    }, "zh")).toBe("自用");
  });
});
