import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { shouldShowAdvanceReservationPayment } from "../src/features/daily-rentals/daily-rental-policy";

const root = resolve(__dirname, "..");
const migration = readFileSync(
  resolve(root, "supabase/migrations/202608220001_allow_daily_booking_prepayments.sql"),
  "utf8",
);
const panel = readFileSync(resolve(root, "src/features/daily-rentals/booking-panel.tsx"), "utf8");

describe("daily rental reservation payments", () => {
  it("allows payments before check-in without weakening cancellation rules", () => {
    expect(migration).toMatch(
      /status not in \('pending_review', 'confirmed', 'checked_in', 'checked_out'\)/i,
    );
    expect(migration).toMatch(/raise exception 'bookingNotPayable'/i);
  });

  it("keeps pre-arrival payment separate from the primary check-in command", () => {
    expect(panel).toContain("showAdvanceReservationPayment");
    expect(panel).toContain("登记收款，暂不入住");
    expect(panel).toMatch(/handleReservationPayment[\s\S]*recordSupplementaryPayment/);
    expect(panel).toMatch(/handleCheckIn[\s\S]*checkIn\(booking!\.id/);
  });

  it("shows advance payment only for reservations arriving after today", () => {
    expect(
      shouldShowAdvanceReservationPayment({
        bookingStatus: "confirmed",
        checkIn: "2026-08-23",
        todayStr: "2026-08-22",
      }),
    ).toBe(true);
    expect(
      shouldShowAdvanceReservationPayment({
        bookingStatus: "confirmed",
        checkIn: "2026-08-22",
        todayStr: "2026-08-22",
      }),
    ).toBe(false);
    expect(
      shouldShowAdvanceReservationPayment({
        bookingStatus: "checked_in",
        checkIn: "2026-08-23",
        todayStr: "2026-08-22",
      }),
    ).toBe(false);
  });

  it("keeps installment history visible outside advanced payment actions", () => {
    expect(panel).toContain("收款记录 ·");
    expect(panel).toMatch(/showPaymentHistory\s*&&\s*\(?\s*<ul\b/);
    expect(panel).toMatch(/positiveBookingPayments\s*\.\s*map\s*\(/);
    expect(panel).not.toMatch(/positiveBookingPayments\s*\.\s*slice\s*\(/);
    expect(panel).toMatch(
      /right\.payment_date\s*\.\s*localeCompare\s*\(\s*left\.payment_date\s*\)/,
    );
    expect(panel.indexOf("收款记录 ·")).toBeLessThan(panel.indexOf("更多业务操作"));
  });

  it("loads payment reversal links so reversed receipts are not shown as valid", () => {
    const loader = readFileSync(
      resolve(root, "src/app/daily-rentals/daily-rental-data.tsx"),
      "utf8",
    );
    // The workbench receives the complete verified window, including reversal
    // evidence, rather than splitting the same payment rows into separate props.
    expect(loader).toContain("initialWindow={window}");
    const operations = readFileSync(
      resolve(root, "src/features/daily-rentals/daily-workbench-actions.tsx"),
      "utf8",
    );
    expect(operations).toContain("payments={context.payments}");
    const model = readFileSync(
      resolve(root, "src/features/daily-rentals/calendar-window-model.ts"),
      "utf8",
    );
    expect(model).toContain("reversal_of_payment_id");
    expect(model).toContain("request_kind");
    const windowRead = readFileSync(
      resolve(root, "supabase/migrations/20261015212832_daily_calendar_window_reads.sql"),
      "utf8",
    );
    expect(windowRead).toContain("jsonb_agg(to_jsonb(p)");
    expect(windowRead).toContain("p.source_id=any(selected_ids)");
  });

  it("keeps daily payment forms limited to amount and payment date", () => {
    expect(panel).not.toContain("suppReceiptNo");
    expect(panel).not.toContain("收据号/备注");
    expect(panel).toContain("费用与收款");
    expect(panel).toContain("下一步操作");
  });

  it("uses one vertical divider rhythm across booking, finance, and actions", () => {
    expect(panel).not.toContain("rounded-xl border border-border bg-card p-4 shadow-xs");
    expect(panel).not.toContain("border-y border-border py-3");
    expect(panel).toContain("border-b border-border pb-4");
    expect(panel).toContain("border-t border-border pt-3");
  });

  it("keeps the booking drawer free of repeated status and checkout totals", () => {
    expect(panel).not.toContain("getPrimaryActionLabel");
    expect(panel).not.toContain("t.fixedBadge");
    expect(panel).not.toContain("{t.booking.confirmCheckOut} — {formatXof(finalDue)}");
    expect(panel).toContain('booking.checkout_mode === "open" && (');
  });
});
