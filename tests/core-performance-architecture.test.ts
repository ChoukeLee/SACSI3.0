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
    expect(source).toContain("customers!daily_bookings_guest_customer_id_fkey");
    expect(source).toContain("guest_name");
    expect(source).not.toContain("legacy_customer:customers!daily_bookings_customer_id_fkey");
    expect(source).not.toContain('.from("audit_logs")');
  });

  it("loads unit status history only after opening a unit", () => {
    const list = read("src/features/units/unit-list.tsx");
    const panel = read("src/features/units/unit-detail-panel.tsx");
    const actions = read("src/features/units/actions.ts");

    expect(list).not.toContain("auditLogsMap");
    expect(panel).toContain("getUnitAuditLogs(unit.id)");
    expect(actions).toContain("export async function getUnitAuditLogs");
  });

  it("shares one responsive daily workbench and loads operation forms only on demand", () => {
    const workbench = read("src/features/daily-rentals/daily-workbench.tsx");
    const operations = read("src/features/daily-rentals/daily-workbench-actions.tsx");
    const loader = read("src/app/daily-rentals/daily-rental-data.tsx");

    expect(loader).toContain("<DailyWorkbench");
    expect(workbench).toContain('matchMedia("(max-width: 600px)")');
    expect(workbench).not.toMatch(/import\("\.\/calendar"\)|calendar\/cash|CalendarFinancePanel/);
    expect(operations).toMatch(/dynamic\(\(\) => import\("\.\/booking-panel"\)/);
    expect(workbench).toMatch(/\{action\s*&&\s*data\s*&&/);
    expect(loader).toContain("readCalendarWindow");
    const windowRead = read("supabase/migrations/20261015212832_daily_calendar_window_reads.sql");
    expect(windowRead).toMatch(
      /from public\.cleaning_tasks t where t\.unit_id=any\(unit_ids\) and not t\.is_completed/,
    );
    expect(windowRead).toContain("cleaning_booking_ids");
  });
  it("keeps default contract pages on bounded workspaces rather than all-history loaders", () => {
    for (const path of [
      "src/app/leases/page.tsx",
      "src/app/fr/leases/page.tsx",
      "src/app/sales/page.tsx",
      "src/app/fr/sales/page.tsx",
    ]) {
      const source = read(path);
      expect(source).toMatch(/load(?:Lease|Sale)Workspace/);
      expect(source).not.toMatch(/loadLeasePageData|getSalePageData/);
    }
    expect(read("src/features/contracts/workspace-service.ts")).toContain(
      '"contract_workspace_read_rpc"',
    );
  });
  it("does not bundle month cash or the complete customer catalogue into a calendar window", () => {
    const windowService = read("src/features/daily-rentals/calendar-window-service.ts");
    expect(windowService).toContain('"daily_calendar_context_rpc"');
    expect(windowService).not.toMatch(/daily_receipts_read_rpc|readReceiptAnalysis|fetchAllPages/);
    const initial = read("src/app/daily-rentals/daily-rental-data.tsx");
    expect(initial).not.toMatch(/fetchAllPages|\.from\("customers"\)|readCalendarCash/);
    expect(read("src/features/daily-rentals/calendar-context-service.ts")).toContain(
      '"daily_calendar_cash_summary_rpc"',
    );
  });
  it("keeps a single app compute region aligned to the verified database region", () => {
    const configuration = JSON.parse(read("vercel.json"));
    expect(configuration.regions).toEqual(["dub1"]);
  });
});
