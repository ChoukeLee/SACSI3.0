import { describe, expect, it } from "vitest";
import { navigationGroupsForRole } from "./navigation-access";

const groups = [
  { key: "home", items: [{ key: "management" }, { key: "units" }] },
  { key: "business", items: [{ key: "dailyRentals" }, { key: "leases" }, { key: "sales" }, { key: "customers" }] },
  { key: "financeCenter", items: [{ key: "finance" }] },
  { key: "operations", items: [{ key: "assistant" }, { key: "auditLogs" }] },
  { key: "systemTools", items: [{ key: "settings" }] },
];

describe("rental sales navigation", () => {
  it("shows only home and rental/sales business groups", () => {
    const visible = navigationGroupsForRole(groups, "rental_sales");

    expect(visible.map((group) => group.key)).toEqual(["home", "business", "operations"]);
    expect(visible.flatMap((group) => group.items.map((item) => item.key))).toEqual([
      "management",
      "units",
      "dailyRentals",
      "leases",
      "sales",
      "customers",
      "auditLogs",
    ]);
  });
});
