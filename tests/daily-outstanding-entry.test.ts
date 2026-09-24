import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const calendar = readFileSync(resolve(__dirname, "../src/features/daily-rentals/calendar.tsx"), "utf8");
const finance = readFileSync(resolve(__dirname, "../src/features/daily-rentals/calendar-finance-panel.tsx"), "utf8");
const panel = readFileSync(resolve(__dirname, "../src/features/daily-rentals/booking-panel.tsx"), "utf8");

describe("outstanding booking entry", () => {
  it("opens the exact unpaid booking independently of the cleaning calendar", () => {
    const table = finance.slice(finance.indexOf('{financeDetail === "outstanding" && (', finance.indexOf("<table")), finance.indexOf('{financeDetail === "settled" && (', finance.indexOf("<table")));
    expect(table).toContain("未结订单");
    expect(table).toContain('type="button"');
    expect(table).toContain("onOpenBooking(b.id)");
    const handler = calendar.slice(calendar.indexOf("onOpenBooking={(bookingId)"));
    expect(handler).toContain("setFinanceDetail(null)");
    expect(handler).toContain("setNewBookingUnitId(null)");
    expect(handler).toContain("setNewBookingDate(null)");
    expect(handler).toContain("setSelectedBookingId(bookingId)");
    expect(table).not.toContain("completeCleaning(");
    expect(table).not.toContain("recordSupplementaryPayment(");
  });

  it("keeps payment authorization and the existing checked-out balance flow", () => {
    expect(calendar).toContain("readOnly={!canOperateDaily}");
    expect(panel).toContain('booking?.status === "checked_out" && hasOutstandingBalance');
    expect(panel).toContain("recordSupplementaryPayment");
  });
});
