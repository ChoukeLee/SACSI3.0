import { describe, expect, it } from "vitest";
import { navigationGroupsForRole } from "./navigation-access";

const groups = [
  {
    key: "core",
    items: [
      { key: "management" },
      { key: "dailyRentals" },
      { key: "leases" },
      { key: "sales" },
      { key: "units" },
      { key: "finance" },
      { key: "customers" },
      { key: "reports" },
    ],
  },
];

describe("role navigation", () => {
  it("shows operating modules but not management or finance pages to rental sales", () => {
    const visible = navigationGroupsForRole(groups, "rental_sales");
    expect(visible.flatMap((group) => group.items.map((item) => item.key))).toEqual([
      "dailyRentals",
      "leases",
      "sales",
      "units",
      "customers",
    ]);
  });

  it("surfaces finance and daily receipt entry to finance without changing front-desk access", () => {
    const visible = navigationGroupsForRole(groups, "finance").flatMap((group) =>
      group.items.map((item) => item.key),
    );
    expect(visible).toContain("finance");
    expect(visible).toContain("dailyRentals");
    expect(visible).toContain("reports");
  });

  it("limits front desk to daily operations and read-only lease entry", () => {
    const visible = navigationGroupsForRole(groups, "front_desk");
    expect(visible.flatMap((group) => group.items.map((item) => item.key))).toEqual([
      "dailyRentals",
      "leases",
    ]);
  });
});
