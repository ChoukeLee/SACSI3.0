import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const migration = readFileSync(
  resolve(root, "supabase/migrations/202608220001_allow_daily_booking_prepayments.sql"),
  "utf8",
);
const panel = readFileSync(
  resolve(root, "src/features/daily-rentals/booking-panel.tsx"),
  "utf8",
);

describe("daily rental reservation payments", () => {
  it("allows payments before check-in without weakening cancellation rules", () => {
    expect(migration).toMatch(
      /status not in \('pending_review', 'confirmed', 'checked_in', 'checked_out'\)/i,
    );
    expect(migration).toMatch(/raise exception 'bookingNotPayable'/i);
  });

  it("keeps pre-arrival payment separate from the primary check-in command", () => {
    expect(panel).toContain('booking.status === "pending_review" || booking.status === "confirmed"');
    expect(panel).toContain("登记收款，暂不入住");
    expect(panel).toMatch(/handleReservationPayment[\s\S]*recordSupplementaryPayment/);
    expect(panel).toMatch(/handleCheckIn[\s\S]*checkIn\(booking!\.id/);
  });
});
