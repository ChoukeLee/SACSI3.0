import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("core UI architecture", () => {
  it("keeps the desktop navigation focused on the five daily work areas", () => {
    const sidebar = read("src/components/app-sidebar.tsx");
    for (const route of ["/management", "/daily-rentals", "/leases", "/sales", "/units"]) {
      expect(sidebar).toContain(`href: "${route}"`);
    }
    expect(sidebar).not.toContain('href: "/data-quality"');
    expect(sidebar).not.toContain('href: "/customers"');
    expect(sidebar).not.toContain('href: "/finance"');
  });

  it("uses shared page, metric and drawer components across core business pages", () => {
    const lease = read("src/features/leases/lease-list.tsx");
    const sale = read("src/features/sales/sale-list.tsx");
    const units = read("src/features/units/unit-list.tsx");
    const dailyPanel = read("src/features/daily-rentals/booking-panel.tsx");

    expect(lease).toContain("<OperationalPage");
    expect(lease).toContain("<MetricGrid");
    expect(sale).toContain("<OperationalPage");
    expect(sale).toContain("<MetricGrid");
    expect(units).toContain("<OperationalPage");
    expect(units).toContain("<RoomBoard");
    expect(dailyPanel).toContain("<RightDrawer");
  });

  it("has one active long-lease implementation and no independent occupancy page", () => {
    expect(existsSync(resolve(root, "src/features/leases/lease-ledger.tsx"))).toBe(false);
    expect(existsSync(resolve(root, "src/app/daily-rentals/overview/page.tsx"))).toBe(false);
    expect(existsSync(resolve(root, "src/app/fr/daily-rentals/overview/page.tsx"))).toBe(false);
  });

  it("shows real customer and lease expiry information on unit cards", () => {
    const units = read("src/features/units/unit-list.tsx");
    const partySummary = read("src/features/units/unit-party-summary.ts");
    expect(units).toContain("party?.dailyCustomerName");
    expect(units).toContain("party?.leaseCustomerName");
    expect(units).toContain("party?.saleCustomerName");
    expect(units).toContain("party?.leaseEndDate");
    expect(partySummary).toContain('from("customers").select("id, name")');
  });
});
