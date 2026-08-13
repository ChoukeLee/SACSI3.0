import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const migration = readFileSync(
  resolve(root, "supabase/migrations/202607290002_confirm_daily_bookings_on_create.sql"),
  "utf8",
);
const actions = readFileSync(resolve(root, "src/features/daily-rentals/actions.ts"), "utf8");
const calendar = readFileSync(resolve(root, "src/features/daily-rentals/calendar.tsx"), "utf8");
const panel = readFileSync(resolve(root, "src/features/daily-rentals/booking-panel.tsx"), "utf8");

describe("daily rental no-review flow", () => {
  it("commits new bookings directly as confirmed", () => {
    expect(migration).toMatch(/set status = 'confirmed'/i);
    expect(migration).toMatch(/where status = 'pending_review'/i);
  });

  it("allows administrators and rental-sales operators to create bookings", () => {
    expect(actions).toMatch(/export async function createBooking[\s\S]*requireRole\("admin", "rental_sales"\)/);
    expect(calendar).toMatch(/const canCreateBooking = userRole === "admin" \|\| userRole === "rental_sales"/);
  });

  it("auto-confirms any pending row returned by the create RPC", () => {
    expect(actions).toMatch(/snapshot\.booking\?\.status === "pending_review"/);
    expect(actions).toMatch(/daily_confirm_booking_rpc/);
    expect(panel).toMatch(/handleConfirmBooking/);
  });

  it("keeps occupancy information in the main calendar without a separate overview route", () => {
    expect(calendar).not.toMatch(/daily-rentals\/overview/);
    expect(calendar).toContain('"日租概览"');
    expect(calendar).toContain("shareRows.map");
  });
});
