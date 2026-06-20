import { describe, it, expect } from "vitest";
import { getDailyRoomStateForDate } from "../src/features/daily-rentals/room-status";
import type { UnitRow, DailyBookingRow } from "../src/types/database";

function unit(overrides: Partial<UnitRow> = {}): UnitRow {
  return {
    id: "u1", building_id: "b1", code: "SACSI-101", unit_no: "101",
    floor_label: "1F", kind: "apartment", status: "available",
    area_sqm: null, layout: null, furnishing: null, notes: null,
    created_at: "", updated_at: "",
    ...overrides,
  };
}

function booking(overrides: Partial<DailyBookingRow> = {}): DailyBookingRow {
  return {
    id: "b1", unit_id: "u1", customer_id: "c1",
    check_in: "2026-06-10", check_out: "2026-06-12",
    checkout_mode: "fixed", actual_check_out: null,
    nightly_price_xof: 40000, total_amount_xof: 80000,
    prepaid_amount_xof: 0, billing_status: "prepaid",
    manual_discount_amount_xof: 0, manual_discount_reason: null,
    final_amount_xof: null, status: "checked_in",
    ota_source: null, notes: null,
    created_at: "", updated_at: "",
    ...overrides,
  };
}

describe("getDailyRoomStateForDate", () => {
  describe("available", () => {
    it("empty room with no bookings is available", () => {
      const result = getDailyRoomStateForDate({
        unit: unit(), dateStr: "2026-06-10", bookings: [], cleaningTasks: [],
      });
      expect(result.status).toBe("available");
      expect(result.booking).toBeNull();
    });
  });

  describe("occupied / checked_in", () => {
    it("checked_in booking covering date returns occupied", () => {
      const result = getDailyRoomStateForDate({
        unit: unit(), dateStr: "2026-06-11",
        bookings: [booking({ check_in: "2026-06-10", check_out: "2026-06-12", status: "checked_in" })],
        cleaningTasks: [],
      });
      expect(result.status).toBe("occupied");
    });

    it("check-out day returns checking_out_today", () => {
      const result = getDailyRoomStateForDate({
        unit: unit(), dateStr: "2026-06-12",
        bookings: [booking({ check_in: "2026-06-10", check_out: "2026-06-12", status: "checked_in" })],
        cleaningTasks: [],
      });
      expect(result.status).toBe("checking_out_today");
      expect(result.isCheckoutDay).toBe(true);
    });

    it("open booking is occupied without specific check-out", () => {
      const result = getDailyRoomStateForDate({
        unit: unit(), dateStr: "2026-06-15",
        bookings: [booking({ checkout_mode: "open", check_out: null, status: "checked_in" })],
        cleaningTasks: [],
      });
      expect(result.status).toBe("occupied");
    });
  });

  describe("reserved", () => {
    it("confirmed booking on check-in day is reserved", () => {
      const result = getDailyRoomStateForDate({
        unit: unit(), dateStr: "2026-06-10",
        bookings: [booking({ check_in: "2026-06-10", check_out: "2026-06-12", status: "confirmed" })],
        cleaningTasks: [],
      });
      expect(result.status).toBe("reserved");
    });

    it("pending_review on check-in day is reserved", () => {
      const result = getDailyRoomStateForDate({
        unit: unit(), dateStr: "2026-06-10",
        bookings: [booking({ check_in: "2026-06-10", check_out: "2026-06-12", status: "pending_review" })],
        cleaningTasks: [],
      });
      expect(result.status).toBe("reserved");
    });

    it("confirmed booking is NOT reserved before check-in date", () => {
      const result = getDailyRoomStateForDate({
        unit: unit(), dateStr: "2026-06-09",
        bookings: [booking({ check_in: "2026-06-10", check_out: "2026-06-12", status: "confirmed" })],
        cleaningTasks: [],
      });
      expect(result.status).toBe("available");
    });
  });

  describe("cleaning", () => {
    it("unit with pending cleaning task shows cleaning", () => {
      const result = getDailyRoomStateForDate({
        unit: unit({ status: "cleaning_pending" }),
        dateStr: "2026-06-10", bookings: [], cleaningTasks: [],
      });
      expect(result.status).toBe("cleaning");
    });
  });

  describe("maintenance / locked", () => {
    it("maintenance shows when no active booking", () => {
      const result = getDailyRoomStateForDate({
        unit: unit({ status: "maintenance" }),
        dateStr: "2026-06-10", bookings: [], cleaningTasks: [],
      });
      expect(result.status).toBe("maintenance");
    });

    it("locked shows when no active booking", () => {
      const result = getDailyRoomStateForDate({
        unit: unit({ status: "locked" }),
        dateStr: "2026-06-10", bookings: [], cleaningTasks: [],
      });
      expect(result.status).toBe("locked");
    });

    it("checked_in takes priority over maintenance", () => {
      const result = getDailyRoomStateForDate({
        unit: unit({ status: "maintenance" }),
        dateStr: "2026-06-11",
        bookings: [booking({ check_in: "2026-06-10", check_out: "2026-06-12", status: "checked_in" })],
        cleaningTasks: [],
      });
      expect(result.status).toBe("occupied"); // checked_in wins
    });
  });

  describe("priority", () => {
    it("checked_in takes priority over cleaning", () => {
      const result = getDailyRoomStateForDate({
        unit: unit({ status: "cleaning_pending" }),
        dateStr: "2026-06-11",
        bookings: [booking({ check_in: "2026-06-10", check_out: "2026-06-12", status: "checked_in" })],
        cleaningTasks: [],
      });
      expect(result.status).toBe("occupied");
    });

    it("checked_out booking after checkout date shows available when no cleaning", () => {
      const result = getDailyRoomStateForDate({
        unit: unit(),
        dateStr: "2026-06-13",
        bookings: [booking({ check_in: "2026-06-10", check_out: "2026-06-12", status: "checked_out" })],
        cleaningTasks: [],
      });
      expect(result.status).toBe("available");
    });
  });
});
