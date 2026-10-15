import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("core UI architecture", () => {
  it("uses an expandable icon-only brand when the desktop sidebar is collapsed", () => {
    const sidebar = read("src/components/app-sidebar.tsx");
    const shell = read("src/components/app-shell.tsx");
    expect(sidebar).toContain('state === "collapsed" && !isMobile');
    expect(sidebar).toContain('<Logo variant="icon" size={32} />');
    expect(sidebar).toContain("onClick={toggleSidebar}");
    expect(sidebar).toContain('"展开侧栏"');
    expect(sidebar).toContain("relative overflow-hidden");
    expect(shell).toContain('if (state === "collapsed") return null;');
    expect(shell).toContain("<DesktopSidebarTrigger />");
  });

  it("exposes operating workspaces in company order without putting maintenance in primary navigation", () => {
    const sidebar = read("src/components/app-sidebar.tsx");
    for (const route of [
      "/management",
      "/leases",
      "/sales",
      "/finance",
      "/units",
      "/daily-rentals",
      "/customers",
      "/reports",
    ]) {
      expect(sidebar).toContain(`href: "${route}"`);
    }
    expect(sidebar).not.toContain('href: "/data-quality"');
    expect(sidebar.indexOf('key: "leases"')).toBeLessThan(sidebar.indexOf('key: "dailyRentals"'));
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
    expect(units).toContain("data-unit-asset-table");
    expect(units).not.toContain("<RoomBoard");
    expect(dailyPanel).toContain("<RightDrawer");
  });

  it("mounts shared drawers at the document root so page gutters cannot offset them", () => {
    const operational = read("src/components/ui/operational.tsx");
    expect(operational).toContain("<Dialog.Portal>");
    expect(operational).toContain("<Dialog.Content");
    expect(operational).toContain("onCloseAutoFocus");
    expect(operational).toContain("top-12");
  });

  it("has one active long-lease implementation and no independent occupancy page", () => {
    expect(existsSync(resolve(root, "src/features/leases/lease-ledger.tsx"))).toBe(false);
    expect(existsSync(resolve(root, "src/app/daily-rentals/overview/page.tsx"))).toBe(false);
    expect(existsSync(resolve(root, "src/app/fr/daily-rentals/overview/page.tsx"))).toBe(false);
  });

  it("shows real customer and lease expiry information in the unit asset ledger", () => {
    const units = read("src/features/units/unit-list.tsx");
    const partySummary = read("src/features/units/unit-party-summary.ts");
    expect(units).toContain("party?.dailyCustomerName");
    expect(units).toContain("party?.leaseCustomerName");
    expect(units).toContain("party?.saleCustomerName");
    expect(units).toContain("party?.leaseEndDate");
    expect(partySummary).not.toContain('from("customers")');
    expect(read("src/features/units/unit-page-data.ts")).toContain(
      "customers!daily_bookings_guest_customer_id_fkey",
    );
  });

  it("uses the same operating homepage for both locales, with daily below core business", () => {
    const management = read("src/features/management/operating-dashboard.tsx");
    const units = read("src/features/units/unit-list.tsx");

    expect(read("src/app/management/page.tsx")).toContain("ManagementPageContent");
    expect(read("src/app/fr/management/page.tsx")).toContain("ManagementPageContent");
    expect(management).not.toContain("入住率");
    expect(management.indexOf('key: "lease"')).toBeLessThan(management.indexOf('key: "daily"'));
    expect(units).toContain("data-unit-asset-table");
    expect(units).toContain("<UnitDetailPanel");
    expect(units).not.toContain("非住宿资产");
    expect(units).not.toContain("<RoomCard");
  });

  it("keeps the normal page gutter below the topbar", () => {
    const shell = read("src/components/app-shell.tsx");
    const mainTag = shell.match(/<main\b[^>]*\bdata-app-main\b[^>]*\bclassName="([^"]+)"/);

    expect(mainTag?.[1]).toContain("p-4");
    expect(mainTag?.[1]).toContain("sm:p-5");
    expect(mainTag?.[1]).toContain("lg:p-6");
  });

  it("keeps the daily finance detail flush below the topbar without moving the page", () => {
    const daily =
      read("src/features/daily-rentals/calendar.tsx") +
      read("src/features/daily-rentals/calendar-finance-panel.tsx");

    expect(daily).toContain('data-daily-calendar-root className="isolate space-y-5"');
    expect(daily).toContain('className="absolute inset-0 z-panel !mt-0 flex flex-col');
    expect(daily).toContain('className="absolute inset-0 z-overlay !mt-0');
    expect(daily).not.toContain('aria-hidden className="h-12 shrink-0"');
    expect(daily).not.toContain('className="fixed inset-0 z-panel');
    expect(daily).not.toContain("top-[var(--app-topbar-offset)]");
  });
});
