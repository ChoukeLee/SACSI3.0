import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("core page performance architecture", () => {
  it("loads the unit catalogue and current business parties in one request", () => {
    const source = read("src/features/units/unit-page-data.ts");

    expect(source).toContain("building:buildings!inner");
    expect(source).toContain("lease_contracts(");
    expect(source).toContain("sale_contracts(");
    expect(source).toContain("daily_bookings(");
    expect(source).not.toContain('.from("audit_logs")');
  });

  it("loads unit status history only after opening a unit", () => {
    const list = read("src/features/units/unit-list.tsx");
    const panel = read("src/features/units/unit-detail-panel.tsx");
    const actions = read("src/features/units/actions.ts");

    expect(list).not.toContain("auditLogsMap");
    expect(panel).toContain("getUnitAuditLogs(unit.id)");
    expect(actions).toContain('export async function getUnitAuditLogs');
  });

  it("splits desktop and mobile daily-rental interfaces", () => {
    const responsive = read("src/features/daily-rentals/daily-rentals-responsive-view.tsx");
    const loader = read("src/app/daily-rentals/daily-rental-data.tsx");

    expect(responsive).toContain('dynamic(() => import("./calendar")');
    expect(responsive).toContain('dynamic(() => import("@/features/mobile/mobile-daily-cards")');
    expect(responsive).toContain("useState(initialIsDesktop)");
    expect(loader).toContain('.eq("is_completed", false)');
  });
});
