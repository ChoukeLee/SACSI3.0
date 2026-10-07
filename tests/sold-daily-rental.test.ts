import { describe, expect, it } from "vitest";
import { allowCreateBooking, allowCheckIn, getPrimaryDailyAction } from "../src/features/daily-rentals/daily-rental-policy";

describe("sold units explicitly enabled for daily management", () => {
  it("fails closed without the capability, but allows enabled sold rooms", () => {
    for (const enabled of [undefined, false, true]) {
      const input = { unitStatus: "sold" as const, dailyRentalEnabled: enabled };
      expect(getPrimaryDailyAction(input).allowed).toBe(enabled === true);
      expect(allowCreateBooking({ ...input, checkIn: "2026-10-03", checkOut: "2026-10-04", todayStr: "2026-10-03" }).allowed).toBe(enabled === true);
      expect(allowCheckIn({ ...input, booking: { status: "confirmed", checkout_mode: "fixed" }, prepaidAmount: 0 }).allowed).toBe(enabled === true);
    }
  });
  it("does not bypass maintenance, locks, leases, cleaning, occupancy or dates", () => {
    for (const operationalCondition of ["maintenance", "locked"] as const) {
      const blocked = { unitStatus: "sold" as const, dailyRentalEnabled: true, operationalCondition };
      expect(getPrimaryDailyAction(blocked).allowed).toBe(false);
      expect(allowCreateBooking({ ...blocked, checkIn: "2026-10-06", checkOut: "2026-10-07", todayStr: "2026-10-06" }).allowed).toBe(false);
      expect(allowCheckIn({ ...blocked, booking: { status: "confirmed", checkout_mode: "fixed" }, prepaidAmount: 0 }).allowed).toBe(false);
      expect(getPrimaryDailyAction({ ...blocked, bookingStatus: "checked_in" }).action).toBe("check_out");
    }
    for (const unitStatus of ["maintenance", "locked", "leased"] as const) {
      expect(getPrimaryDailyAction({ unitStatus, dailyRentalEnabled: true }).allowed).toBe(false);
    }
    const input = { unitStatus: "sold" as const, dailyRentalEnabled: true, booking: { status: "confirmed" as const, checkout_mode: "fixed" as const }, prepaidAmount: 0 };
    expect(allowCheckIn({ ...input, hasOpenCleaningTask: true }).allowed).toBe(false);
    expect(allowCheckIn({ ...input, otherCheckedInCount: 1 }).allowed).toBe(false);
    expect(allowCreateBooking({ ...input, checkIn: "2026-10-01", checkOut: "2026-10-04", todayStr: "2026-10-03" }).allowed).toBe(false);
  });
});
