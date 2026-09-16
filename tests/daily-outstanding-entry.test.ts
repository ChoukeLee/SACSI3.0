import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const calendar = readFileSync(resolve(__dirname, "../src/features/daily-rentals/calendar.tsx"), "utf8");
const panel = readFileSync(resolve(__dirname, "../src/features/daily-rentals/booking-panel.tsx"), "utf8");

describe("outstanding booking entry", () => {
  it("opens the exact unpaid booking independently of the cleaning calendar", () => {
    const table = calendar.slice(calendar.indexOf('{financeDetail === "outstanding" && (', calendar.indexOf("<table")), calendar.indexOf('{financeDetail === "settled" && (', calendar.indexOf("<table")));
    expect(table).toContain("未结订单");
    expect(table).toContain('type="button"');
    expect(table).toContain("setFinanceDetail(null)");
    expect(table).toContain("setNewBookingUnitId(null)");
    expect(table).toContain("setNewBookingDate(null)");
    expect(table).toContain("setSelectedBookingId(b.id)");
    expect(table).not.toContain("completeCleaning(");
    expect(table).not.toContain("recordSupplementaryPayment(");
  });

  it("keeps payment authorization and the existing checked-out balance flow", () => {
    expect(calendar).toContain("readOnly={!canOperateDaily}");
    expect(panel).toContain('booking?.status === "checked_out" && hasOutstandingBalance');
    expect(panel).toContain("recordSupplementaryPayment");
  });
});
