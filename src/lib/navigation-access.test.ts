import { describe, expect, it } from "vitest";
import { navigationGroupsForRole } from "./navigation-access";

const groups = [
  { key: "core", items: [
    { key: "management" },
    { key: "dailyRentals" },
    { key: "leases" },
    { key: "sales" },
    { key: "units" },
  ] },
];

describe("role navigation", () => {
  it("shows all five core modules to rental sales", () => {
    const visible = navigationGroupsForRole(groups, "rental_sales");
    expect(visible.flatMap((group) => group.items.map((item) => item.key))).toEqual([
      "management",
      "dailyRentals",
      "leases",
      "sales",
      "units",
    ]);
  });

  it("limits front desk to daily operations and read-only lease entry", () => {
    const visible = navigationGroupsForRole(groups, "front_desk");
    expect(visible.flatMap((group) => group.items.map((item) => item.key))).toEqual([
      "dailyRentals",
      "leases",
    ]);
  });
});
