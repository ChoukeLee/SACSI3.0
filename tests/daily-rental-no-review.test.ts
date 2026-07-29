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

  it("enforces admin-only creation in both the server action and database", () => {
    expect(actions).toMatch(/export async function createBooking[\s\S]*requireRole\("admin"\)/);
    expect(migration).toMatch(/has_app_role\('admin'\)/i);
    expect(calendar).toMatch(/const canCreateBooking = userRole === "admin"/);
  });

  it("does not render an order-confirmation action", () => {
    expect(panel).not.toMatch(/handleConfirmBooking/);
    expect(panel).not.toMatch(/confirmBooking\(/);
  });

  it("keeps a separate occupancy overview route", () => {
    expect(calendar).toMatch(/daily-rentals\/overview/);
  });
});
